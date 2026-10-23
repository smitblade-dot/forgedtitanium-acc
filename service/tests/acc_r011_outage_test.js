'use strict';
/* ACC-R011 end-to-end reliability tests: the TI reporter (with its outage buffer) against a real local ACC
   server that is stopped, restarted, proxied and misconfigured. Synthetic events only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const S = require('../server/acc_server.js');
const A = require('../acc_core.js');

const ROOT = path.join(__dirname, '..');
const REPORTER = path.join(ROOT, 'integrations/travel_intelligence/acc_report.py');
const FIX = path.join(__dirname, 'fixtures/ti_outcomes');
const PC = '03AA-04_Production_Controller_TI';
const BUILDER = '03AA-04_Country_Intelligence_Builder_TI';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acc11-'));
function freePort() { return new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }
function py(args, env) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const c = spawn('python3', [REPORTER, ...args], { env: Object.assign({ PATH: process.env.PATH }, env) });
    let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    c.on('close', code => resolve({ code, out: out.trim(), ms: Date.now() - t0 }));
  });
}

/* One agent run, as the workflow does it: start (pending file), agent, restore buffer, end (one attempt), save. */
async function run(ctx, runId, opts) {
  const o = opts || {};
  const env = { ACC_REPORT_URL: o.url || ctx.url, ACC_KEY_ID: ctx.key.key_id, ACC_AGENT_SECRET: o.secret || ctx.key.secret_b64url,
    GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'schedule', GITHUB_OUTPUT: path.join(ctx.dir, 'gh_out_' + runId) };
  const pending = path.join(ctx.dir, 'pending_' + runId + '.json');
  const start = await py(['start', '--agent', ctx.agent, '--pending-file', pending], env);
  const end = await py(['end', '--agent', ctx.agent, '--outcome-file', path.join(FIX, o.fixture || 'controller_observe_ok.json'), '--step-outcome', 'success',
    '--outbox-file', ctx.outbox, '--pending-file', pending], env);
  const ghout = fs.existsSync(env.GITHUB_OUTPUT) ? fs.readFileSync(env.GITHUB_OUTPUT, 'utf8') : '';
  return { start, end, saved: ghout.includes('outbox_save=true') };
}
function outboxEntries(ctx) { return fs.existsSync(ctx.outbox) ? JSON.parse(fs.readFileSync(ctx.outbox, 'utf8')).entries : []; }
function seal(ctx, entries) {
  const code = `import sys; sys.path.insert(0, ${JSON.stringify(path.dirname(REPORTER))}); import acc_report, json
acc_report.save_outbox(${JSON.stringify(ctx.outbox)}, ${JSON.stringify(ctx.agent)}, ${JSON.stringify(ctx.key.secret_b64url)}, json.loads(sys.stdin.read()), 0)`;
  const r = spawnSync('python3', ['-c', code], { input: JSON.stringify(entries), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}
const isoS = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

async function bring(dataDir, port) {
  const s = S.createAccServer({ dataDir, staticDir: ROOT });
  await s.listenIngest(port, '127.0.0.1');
  return s;
}
async function setup(agent) {
  const dataDir = tmp(), port = await freePort();
  const s = await bring(dataDir, port);
  const key = S.issueAgentKey(s.ctx, agent || PC);
  const dir = tmp();
  return { s, dataDir, port, key, dir, agent: agent || PC, url: 'http://127.0.0.1:' + port, outbox: path.join(dir, 'acc_outbox', 'outbox.json') };
}
const rows = s => s.db.prepare('SELECT raw_json, received_at_utc, flags_json FROM events ORDER BY id').all()
  .map(r => Object.assign(JSON.parse(r.raw_json), { received_at_utc: r.received_at_utc, flags: JSON.parse(r.flags_json).map(f => f.code) }));

test('outage: ACC unavailable for three runs, then recovers; every event delivered once with its original time', async () => {
  const ctx = await setup();
  await ctx.s.close();                                   // ACC down
  for (const id of [1, 2, 3]) {
    const r = await run(ctx, id);
    assert.equal(r.start.code, 0); assert.equal(r.end.code, 0);
    assert.match(r.start.out, /^ACC_REPORT QUEUED_UNREACHABLE/);
    assert.match(r.end.out, new RegExp('^ACC_REPORT QUEUED .*queued=' + id * 2));
    assert.ok(r.start.ms < 3000, 'refused connection fails fast: ' + r.start.ms + ' ms');
    assert.ok(r.saved);
  }
  const queued = Object.fromEntries(outboxEntries(ctx).map(e => [e.event.event_id, e.event.timestamp]));
  ctx.s = await bring(ctx.dataDir, ctx.port);            // ACC back
  try {
    const r4 = await run(ctx, 4);
    assert.match(r4.end.out, /^ACC_REPORT ACCEPTED .*delivered=7 queued=0/);
    const ev = rows(ctx.s);
    assert.deepEqual(ev.map(e => e.event_id).sort(), ['gh-run-1-1-end', 'gh-run-1-1-start', 'gh-run-2-1-end', 'gh-run-2-1-start', 'gh-run-3-1-end', 'gh-run-3-1-start', 'gh-run-4-1-end', 'gh-run-4-1-start']);
    for (const e of ev.filter(e => queued[e.event_id])) {
      assert.equal(e.timestamp, queued[e.event_id], 'original event time kept');
      assert.ok(e.delivery.attempts >= 2 && e.delivery.queued_at_utc);
      assert.ok(Date.parse(e.received_at_utc) > Date.parse(e.timestamp), 'delivery time recorded separately');
    }
    await run(ctx, 5);
    assert.equal(rows(ctx.s).length, 10, 'next run sends only its own two events');
    assert.equal(outboxEntries(ctx).length, 0);
    // Current state is the latest run, not a late arrival
    const store = A.createStore();
    for (const e of rows(ctx.s)) A.ingestReport(store, { version: '1.1', events: [Object.fromEntries(Object.entries(e).filter(([k]) => !['received_at_utc', 'flags'].includes(k)))] }, Date.now(), 'x', { received_at_utc: e.received_at_utc });
    assert.equal(A.currentEvent(store, A.REGISTER.find(a => a.code === PC), Date.now()).event_id, 'gh-run-5-1-end');
    assert.equal(S.verifyAudit(ctx.s.db).intact, true);
  } finally { await ctx.s.close(); }
});

test('delayed delivery: a report two hours old is accepted, marked late and keeps its event time', async () => {
  const ctx = await setup();
  try {
    const t = isoS(Date.now() - 2 * 3600e3);
    seal(ctx, [{ event: { agent_id: PC, event_id: 'gh-run-50-1-end', run_ref: 'gh-run-50-1', status: 'idle', timestamp: t, task: 'SYNTHETIC', dry_run: true, model_tier: 'code', cost_eur: 0, cost_basis: 'api' }, queued_at_utc: t, attempts: 5 }]);
    await run(ctx, 51);
    const late = rows(ctx.s).find(e => e.event_id === 'gh-run-50-1-end');
    assert.equal(late.timestamp, t);
    assert.ok(late.flags.includes('DELIVERED_LATE'));
    assert.equal(late.delivery.attempts, 6);
    const a = JSON.parse(ctx.s.db.prepare("SELECT detail_json FROM audit WHERE action = 'report_received' ORDER BY seq DESC LIMIT 1").get().detail_json);
    assert.equal(a.late, 1);
  } finally { await ctx.s.close(); }
});

test('duplicates: response lost after the ACC stored the events; the resend is recognised and nothing is doubled', async () => {
  const ctx = await setup();
  const port = await freePort();
  const lossy = http.createServer((req, res) => {     // forwards to the ACC, then drops the reply
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const up = http.request({ host: '127.0.0.1', port: ctx.port, path: req.url, method: req.method, headers: req.headers }, r => { r.resume(); r.on('end', () => res.socket.destroy()); });
      up.end(Buffer.concat(chunks));
    });
  }).listen(port, '127.0.0.1');
  try {
    const r1 = await run(ctx, 60, { url: 'http://127.0.0.1:' + port });
    assert.match(r1.end.out, /QUEUED/);
    assert.equal(rows(ctx.s).length, 2, 'the ACC did store run 60');
    assert.equal(outboxEntries(ctx).length, 2, 'but the agent could not know, so it kept them');
    await run(ctx, 61);
    const ids = rows(ctx.s).map(e => e.event_id);
    assert.deepEqual(ids, ['gh-run-60-1-start', 'gh-run-60-1-end', 'gh-run-61-1-start', 'gh-run-61-1-end']);
    assert.equal(outboxEntries(ctx).length, 0);
    const a = JSON.parse(ctx.s.db.prepare("SELECT detail_json FROM audit WHERE action = 'report_received' ORDER BY seq DESC LIMIT 1").get().detail_json);
    assert.equal(a.duplicates, 2);
  } finally { lossy.close(); await ctx.s.close(); }
});

test('invalid signature: refused and audited; events kept under the wrong key are discarded, never forged through', async () => {
  const ctx = await setup();
  try {
    const wrong = crypto.randomBytes(32).toString('base64url');
    const r = await run(ctx, 70, { secret: wrong });
    assert.match(r.start.out, /QUEUED_HTTP_401/);
    assert.match(r.end.out, /QUEUED .*delivery=HTTP_401/);
    assert.equal(rows(ctx.s).length, 0);
    assert.equal(ctx.s.db.prepare("SELECT COUNT(*) n FROM audit WHERE action = 'auth_failed'").get().n, 2);
    const r2 = await run(ctx, 71);                      // secret corrected
    assert.match(r2.end.out, /note=outbox_discarded_integrity/);
    assert.deepEqual(rows(ctx.s).map(e => e.event_id), ['gh-run-71-1-start', 'gh-run-71-1-end']);
  } finally { await ctx.s.close(); }
});

test('expired reports: older than 7 days are rejected by the ACC and removed from the buffer (no endless resend)', async () => {
  const ctx = await setup();
  try {
    const old = isoS(Date.now() - 8 * 86400e3), q = isoS(Date.now() - 3600e3);
    seal(ctx, [{ event: { agent_id: PC, event_id: 'gh-run-80-1-end', status: 'idle', timestamp: old, dry_run: true, model_tier: 'code' }, queued_at_utc: q, attempts: 1 }]);
    const r = await run(ctx, 81);
    assert.match(r.end.out, /queued=0/);
    assert.equal(ctx.s.db.prepare("SELECT code FROM rejections ORDER BY id DESC LIMIT 1").get().code, 'TIMESTAMP_EXPIRED');
    assert.equal(outboxEntries(ctx).length, 0);
    assert.ok(!rows(ctx.s).some(e => e.event_id === 'gh-run-80-1-end'));
  } finally { await ctx.s.close(); }
});

test('buffer limits: entries beyond 72 hours are dropped and the count reaches the ACC as a flag', async () => {
  const ctx = await setup(BUILDER);
  try {
    const old = isoS(Date.now() - 73 * 3600e3), ok = isoS(Date.now() - 3600e3);
    seal(ctx, [
      { event: { agent_id: BUILDER, event_id: 'old-1', status: 'idle', timestamp: old }, queued_at_utc: old, attempts: 2 },
      { event: { agent_id: BUILDER, event_id: 'ok-1', status: 'idle', timestamp: ok, dry_run: true, model_tier: 'code' }, queued_at_utc: ok, attempts: 2 }]);
    await run(ctx, 90, { fixture: 'builder_publish_idle.json' });
    const ev = rows(ctx.s);
    assert.ok(!ev.some(e => e.event_id === 'old-1'));
    const first = ev.find(e => e.event_id === 'ok-1');
    assert.equal(first.delivery.dropped_before, 1);
    assert.ok(first.flags.includes('BUFFER_DROPPED'));
  } finally { await ctx.s.close(); }
});

test('agent never delayed: a hanging ACC costs the start step at most about 3 seconds', async () => {
  const port = await freePort();
  const hang = net.createServer(sock => { sock.on('error', () => {}); }).listen(port, '127.0.0.1');
  const ctx = { agent: PC, key: { key_id: 'k_x', secret_b64url: crypto.randomBytes(32).toString('base64url') }, dir: tmp(), url: 'http://127.0.0.1:' + port };
  ctx.outbox = path.join(ctx.dir, 'acc_outbox', 'outbox.json');
  try {
    const t0 = Date.now();
    const r = await py(['start', '--agent', PC, '--pending-file', path.join(ctx.dir, 'p.json')], { ACC_REPORT_URL: ctx.url, ACC_KEY_ID: 'k_x', ACC_AGENT_SECRET: ctx.key.secret_b64url, GITHUB_RUN_ID: '99' });
    assert.equal(r.code, 0);
    assert.match(r.out, /QUEUED_UNREACHABLE/);
    assert.ok(Date.now() - t0 < 5000, 'bounded: ' + (Date.now() - t0) + ' ms');
  } finally { hang.close(); }
});

test('server: unauthenticated floods are limited and summarised, not written to the audit log one by one', async () => {
  const dataDir = tmp();
  const s = S.createAccServer({ dataDir, failLimitPerMin: 5 });
  const a = await s.listenIngest(0, '127.0.0.1');
  try {
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await fetch('http://127.0.0.1:' + a.port + '/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status);
    assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429, 429, 429, 429, 429, 429]);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM audit WHERE action = 'auth_failed'").get().n, 5);
  } finally { await s.close(); }
});
