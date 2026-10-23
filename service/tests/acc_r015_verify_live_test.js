'use strict';
/* ACC-R015: the post-deployment verifier passes against a correct service and FAILS against a leaky or broken one. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const S = require('../server/acc_server.js');

const ROOT = path.join(__dirname, '..');
const MASTER = '03AA-04_Master_Agent_TI_Ops_Director', BUILDER = '03AA-04_Country_Intelligence_Builder_TI', CONTROLLER = '03AA-04_Production_Controller_TI';
const tsNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function verify(env, extra) {
  return new Promise(resolve => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'acc15v-'));
    const c = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'scripts/verify_live.mjs'), '--allow-http-localhost', ...(extra || [])], { env: Object.assign({ PATH: process.env.PATH, OUT: out, ORIGIN: 'none' }, env) });
    let text = ''; c.stdout.on('data', d => text += d); c.stderr.on('data', d => text += d);
    c.on('close', code => resolve({ code, text, out }));
  });
}
async function service(withEvents) {
  const s = S.createAccServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'acc15v-d-')), staticDir: ROOT, publicStatus: true });
  const i = await s.listenIngest(0, '127.0.0.1');
  const base = 'http://127.0.0.1:' + i.port;
  if (withEvents) for (const [agent, status] of [[MASTER, 'idle'], [BUILDER, 'failed'], [CONTROLLER, 'idle']]) {
    const key = S.issueAgentKey(s.ctx, agent);
    const body = Buffer.from(JSON.stringify({ version: '1.1', events: [{ agent_id: agent, status, timestamp: new Date(Date.now() - 1000).toISOString(), event_id: crypto.randomBytes(6).toString('hex'), task: 'SECRET-TASK', dry_run: true }] }));
    const ts = tsNow(), n = crypto.randomBytes(16).toString('hex');
    const r = await fetch(base + '/v1/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-ACC-Key-Id': key.key_id, 'X-ACC-Timestamp': ts, 'X-ACC-Nonce': n, 'X-ACC-Signature': S.sign(key.secret_b64url, 'POST', '/v1/events', ts, n, body) } });
    assert.equal((await r.json()).accepted, 1);
  }
  return { s, base };
}

test('verifier passes against a correct service with genuine reports from all three agents', async () => {
  const { s, base } = await service(true);
  try {
    const r = await verify({ SERVICE_URL: base, EXPECT_AGENTS: [MASTER, BUILDER, CONTROLLER].join(',') }, ['--expect-live']);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /agent has genuine recent reports: 03AA-04_Master_Agent_TI_Ops_Director/);
    assert.match(r.text, /verification checks passed/);
    const j = JSON.parse(fs.readFileSync(path.join(r.out, 'live_verification.json'), 'utf8'));
    assert.equal(j.failed, 0);
  } finally { await s.close(); }
});

test('verifier with --expect-live fails when an agent has no genuine report yet (honest about unconnected agents)', async () => {
  const { s, base } = await service(false);
  try {
    const r = await verify({ SERVICE_URL: base, EXPECT_AGENTS: MASTER }, ['--expect-live']);
    assert.equal(r.code, 1);
    assert.match(r.text, /FAIL agent has genuine recent reports: 03AA-04_Master/);
    const info = await verify({ SERVICE_URL: base, EXPECT_AGENTS: MASTER });
    assert.equal(info.code, 0, 'without --expect-live an unconnected agent is information, not a failure');
  } finally { await s.close(); }
});

test('verifier FAILS against a service that leaks the audit log, task data, or accepts unsigned writes', async () => {
  const good = await service(true);
  const leak = http.createServer(async (q, r) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/v1/audit') { r.writeHead(200); return r.end('{"entries":[]}'); }
    if (u.pathname === '/v1/events' && q.method === 'POST') { r.writeHead(200); return r.end('{"accepted":0}'); }
    if (u.pathname === '/public/status.json') {
      const d = await (await fetch(good.base + '/public/status.json')).json();
      d.agents[0].task = 'SECRET-TASK';
      r.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }); return r.end(JSON.stringify(d));
    }
    const p = await fetch(good.base + u.pathname + u.search); r.writeHead(p.status); r.end(await p.text());
  });
  await new Promise(r => leak.listen(0, '127.0.0.1', r));
  try {
    const r = await verify({ SERVICE_URL: 'http://127.0.0.1:' + leak.address().port });
    assert.equal(r.code, 1);
    assert.match(r.text, /FAIL public status passes the strict allowlist/);
    assert.match(r.text, /FAIL private path is not reachable: \/v1\/audit/);
    assert.match(r.text, /FAIL an unauthenticated write is refused/);
  } finally { leak.close(); await good.s.close(); }
});

test('verifier refuses a plain-http service address unless it is local and explicitly allowed', async () => {
  const c = await new Promise(resolve => {
    const p = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'scripts/verify_live.mjs')], { env: { PATH: process.env.PATH, OUT: fs.mkdtempSync(path.join(os.tmpdir(), 'acc15v-')), SERVICE_URL: 'http://127.0.0.1:9', ORIGIN: 'none' } });
    let t = ''; p.stdout.on('data', d => t += d); p.on('close', code => resolve({ code, t }));
  });
  assert.equal(c.code, 1);
  assert.match(c.t, /FAIL service address is https/);
});
