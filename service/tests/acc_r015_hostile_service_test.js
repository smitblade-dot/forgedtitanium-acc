'use strict';
/* ACC-R015: reporting failures never interrupt an agent. The real TI reporter is run against deliberately hostile
   "services". Whatever the service does, the reporter must exit 0 and finish within a bounded time. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const REPORTER = path.join(ROOT, 'integrations/travel_intelligence/acc_report.py');
const FIX = path.join(ROOT, 'tests/fixtures/ti_outcomes');
const CONTROLLER = '03AA-04_Production_Controller_TI';
const SECRET = crypto.randomBytes(32).toString('base64url');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'acc15h-'));

function run(args, env) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const c = spawn('python3', [REPORTER, ...args], { env: Object.assign({ PATH: process.env.PATH }, env) });
    let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    const kill = setTimeout(() => c.kill('SIGKILL'), 60000);
    c.on('close', code => { clearTimeout(kill); resolve({ code, out: out.trim(), ms: Date.now() - t0 }); });
  });
}
const envFor = url => ({ ACC_REPORT_URL: url, ACC_KEY_ID: 'key_test', ACC_AGENT_SECRET: SECRET, GITHUB_RUN_ID: String(Date.now()), GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'schedule' });

const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const behaviours = {
  'never answers (hang)': () => net.createServer(() => {}),
  'answers 500': () => http.createServer((q, r) => { r.writeHead(500); r.end('boom'); }),
  'answers 200 with garbage': () => http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end('<<<not json>>>'); }),
  'answers with a 10 MB body': () => http.createServer((q, r) => { r.writeHead(200); r.end(Buffer.alloc(10 * 1024 * 1024, 65)); }),
  'redirects to another host': () => http.createServer((q, r) => { r.writeHead(302, { Location: 'http://example.invalid/steal' }); r.end(); }),
  'closes the connection at once': () => net.createServer(s => s.destroy()),
  'speaks TLS-less garbage': () => net.createServer(s => { s.write('\x16\x03\x01garbage'); s.end(); }),
  'drips one byte at a time forever': () => net.createServer(s => { s.write('HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\n\r\n'); const t = setInterval(() => { if (s.destroyed) return clearInterval(t); s.write('x'); }, 300); s.on('error', () => clearInterval(t)); s.on('close', () => clearInterval(t)); }),
};

for (const [name, make] of Object.entries(behaviours)) {
  test('hostile service that ' + name + ': the reporter exits 0 in bounded time and never blocks the agent', async () => {
    const srv = make(); const port = await listen(srv);
    try {
      const url = 'http://127.0.0.1:' + port;
      const f = path.join(work, crypto.randomBytes(4).toString('hex'));
      const start = await run(['start', '--agent', CONTROLLER, '--pending-file', f + '.pending'], envFor(url));
      assert.equal(start.code, 0, 'start: ' + start.out);
      assert.ok(start.ms < 8000, 'start took ' + start.ms + ' ms');
      const end = await run(['end', '--agent', CONTROLLER, '--outcome-file', path.join(FIX, 'controller_observe_ok.json'), '--step-outcome', 'success', '--outbox-file', f + '.outbox', '--pending-file', f + '.pending'], envFor(url));
      assert.equal(end.code, 0, 'end: ' + end.out);
      assert.ok(end.ms < 20000, 'end took ' + end.ms + ' ms');
      assert.ok(!envFor(url).ACC_AGENT_SECRET || !(start.out + end.out).includes(SECRET), 'the secret is never printed');
    } finally { srv.close(); if (srv.closeAllConnections) srv.closeAllConnections(); }
  });
}

test('misconfigured or unsafe settings skip quietly with exit 0: no URL, plain http to a remote host, bad secret', async () => {
  const f = path.join(work, 'cfg');
  for (const env of [{}, { ACC_REPORT_URL: 'http://example.com', ACC_KEY_ID: 'k', ACC_AGENT_SECRET: SECRET }, { ACC_REPORT_URL: 'https://example.invalid', ACC_KEY_ID: 'k', ACC_AGENT_SECRET: '!!!not-base64!!!' }, { ACC_REPORT_URL: 'file:///etc/passwd', ACC_KEY_ID: 'k', ACC_AGENT_SECRET: SECRET }]) {
    const r = await run(['start', '--agent', CONTROLLER, '--pending-file', f], Object.assign({ GITHUB_RUN_ID: '1' }, env));
    assert.equal(r.code, 0, JSON.stringify(env));
    assert.match(r.out, /SKIPPED/, JSON.stringify(env));
    assert.ok(r.ms < 5000);
  }
});

test('an unreachable service leaves the agent run untouched and the events buffered for the next run', async () => {
  const f = path.join(work, 'down');
  const env = envFor('http://127.0.0.1:9');   // nothing listens on the discard port
  await run(['start', '--agent', CONTROLLER, '--pending-file', f + '.pending'], env);
  const r = await run(['end', '--agent', CONTROLLER, '--outcome-file', path.join(FIX, 'controller_observe_ok.json'), '--step-outcome', 'success', '--outbox-file', f + '.outbox', '--pending-file', f + '.pending'], env);
  assert.equal(r.code, 0);
  assert.ok(fs.existsSync(f + '.outbox') && fs.statSync(f + '.outbox').size > 50, 'events kept for the next run');
  assert.ok(!fs.readFileSync(f + '.outbox', 'utf8').includes(SECRET), 'the buffer never contains the secret');
});
