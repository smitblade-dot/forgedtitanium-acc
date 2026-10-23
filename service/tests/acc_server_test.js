'use strict';
/* ACC-R009 server tests. All events are synthetic. No Travel Intelligence system is contacted. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const S = require('../server/acc_server.js');

const MASTER = '03AA-04_Master_Agent_TI_Ops_Director';
const BUILDER = '03AA-04_Country_Intelligence_Builder_TI';
const ROOT = path.join(__dirname, '..');

async function start(opts) {
  const dataDir = (opts && opts.dataDir) || fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
  const s = S.createAccServer(Object.assign({ dataDir, staticDir: ROOT }, opts || {}));
  const addr = await s.listen(0, '127.0.0.1');
  return { s, dataDir, base: 'http://127.0.0.1:' + addr.port };
}
const nonce = () => crypto.randomBytes(16).toString('hex');
const tsNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
function synth(agentId, extra) {
  return Object.assign({ agent_id: agentId, status: 'working', timestamp: new Date(Date.now() - 60000).toISOString(), task: 'SYNTHETIC TEST EVENT', dry_run: true, model_tier: 'haiku', cost_eur: 0 }, extra || {});
}
async function post(base, key, report, o) {
  const opt = o || {};
  const body = Buffer.from(opt.rawBody !== undefined ? opt.rawBody : JSON.stringify(report));
  const ts = opt.ts || tsNow(), n = opt.nonce || nonce();
  const sig = opt.sig || S.sign(opt.secret || key.secret_b64url, 'POST', '/v1/events', ts, n, body);
  const headers = { 'Content-Type': opt.contentType || 'application/json', 'X-ACC-Key-Id': opt.keyId || key.key_id, 'X-ACC-Timestamp': ts, 'X-ACC-Nonce': n, 'X-ACC-Signature': sig };
  if (opt.omit) delete headers[opt.omit];
  const r = await fetch(base + '/v1/events', { method: 'POST', headers, body });
  return { status: r.status, body: await r.json() };
}
async function get(base, p, token) {
  const r = await fetch(base + p, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  return { status: r.status, body: r.headers.get('content-type').includes('json') ? await r.json() : await r.text() };
}
function lastAudit(s, action) { return s.db.prepare('SELECT * FROM audit WHERE action = ? ORDER BY seq DESC LIMIT 1').get(action); }

test('server: health is public and minimal; dashboard files are served', async () => {
  const { s, base } = await start();
  try {
    const h = await get(base, '/v1/health');
    assert.equal(h.status, 200);
    assert.equal(h.body.release, 'ACC-R011');
    assert.equal(h.body.audit_chain, 'intact');
    assert.equal((await get(base, '/')).status, 200);
    assert.equal((await get(base, '/acc_register.js')).status, 200);
    assert.equal((await get(base, '/../package.json')).status, 404);
    assert.equal((await get(base, '/server/acc_server.js')).status, 404);
  } finally { await s.close(); }
});

test('server: keys are issued only for verified agent codes', async () => {
  const { s } = await start();
  try {
    for (const bad of ['sqe', 'ti-country-builder', '03AA-01', 'Global OSINT Discovery Agent', '']) assert.throws(() => S.issueAgentKey(s.ctx, bad), /verified agent codes/);
    const k = S.issueAgentKey(s.ctx, BUILDER);
    assert.match(k.key_id, /^k_[0-9a-f]{12}$/);
    const raw = fs.readFileSync(s.ctx.keysFile, 'utf8');
    assert.equal(fs.statSync(s.ctx.keysFile).mode & 0o777, 0o600);
    assert.ok(raw.includes(k.secret_b64url));
    const audit = s.db.prepare('SELECT detail_json FROM audit').all().map(r => r.detail_json).join('\n');
    assert.ok(!audit.includes(k.secret_b64url), 'secret never written to the audit log');
  } finally { await s.close(); }
});

test('server: signed synthetic report is accepted, flagged, stored and audited', async () => {
  const { s, base } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    const r = await post(base, key, { version: '1.1', events: [synth(MASTER), synth(MASTER, { timestamp: new Date(Date.now() - 120000).toISOString(), model_tier: 'sonnet', dry_run: false, cost_eur: 0.02 })] });
    assert.equal(r.status, 200);
    assert.equal(r.body.accepted, 2);
    assert.ok(r.body.results[1].flags.includes('ROUTING_SONNET_NO_REASON'));
    assert.ok(r.body.results[1].flags.includes('NO_ALLOWANCE_CONFIGURED'));
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM events').get().n, 2);
    const a = lastAudit(s, 'report_received');
    assert.match(a.actor, new RegExp(MASTER));
    assert.ok(JSON.parse(a.detail_json).flags.includes('NO_ALLOWANCE_CONFIGURED'));
  } finally { await s.close(); }
});

test('server: a key may only report for its own agent; interim IDs are refused', async () => {
  const { s, base } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    const r = await post(base, key, { version: '1.1', events: [synth(BUILDER), synth('ti-director'), synth(MASTER)] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.results.map(x => x.outcome), ['rejected', 'rejected', 'accepted']);
    assert.equal(r.body.results[0].code, 'AGENT_KEY_MISMATCH');
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM rejections').get().n, 2);
  } finally { await s.close(); }
});

test('server: authentication failures are refused and audited without detail leakage', async () => {
  const { s, base } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    const rep = { version: '1.1', events: [synth(MASTER)] };
    const cases = [
      [{ sig: 'a'.repeat(64) }, 'bad signature'],
      [{ secret: crypto.randomBytes(32).toString('base64url') }, 'bad signature'],
      [{ keyId: 'k_000000000000' }, 'unknown key'],
      [{ ts: new Date(Date.now() - 10 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z') }, 'timestamp'],
      [{ ts: '2026-10-23T10:00:00+03:00' }, 'timestamp'],
      [{ nonce: 'short' }, 'malformed nonce'],
      [{ omit: 'X-ACC-Signature' }, 'missing authentication headers']
    ];
    for (const [o, reason] of cases) {
      const r = await post(base, key, rep, o);
      assert.equal(r.status, 401, reason);
      assert.deepEqual(r.body, { error: 'authentication_failed' });
      assert.match(JSON.parse(lastAudit(s, 'auth_failed').detail_json).reason, new RegExp(reason));
    }
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM events').get().n, 0);
  } finally { await s.close(); }
});

test('server: replayed request is refused', async () => {
  const { s, base } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    const o = { ts: tsNow(), nonce: nonce() };
    const rep = { version: '1.1', events: [synth(MASTER)] };
    assert.equal((await post(base, key, rep, o)).status, 200);
    const again = await post(base, key, rep, o);
    assert.equal(again.status, 401);
    assert.match(JSON.parse(lastAudit(s, 'auth_failed').detail_json).reason, /replayed/);
  } finally { await s.close(); }
});

test('server: revoked key is refused', async () => {
  const { s, base } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    S.revoke(s.ctx, key.key_id);
    assert.equal((await post(base, key, { version: '1.1', events: [synth(MASTER)] })).status, 401);
    assert.match(JSON.parse(lastAudit(s, 'auth_failed').detail_json).reason, /revoked/);
  } finally { await s.close(); }
});

test('server: malformed requests are refused with clear codes', async () => {
  const { s, base } = await start({ maxBody: 4096, maxEvents: 3 });
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    assert.equal((await post(base, key, {}, { contentType: 'text/plain', rawBody: 'x' })).status, 415);
    assert.equal((await post(base, key, null, { rawBody: 'x'.repeat(5000) })).status, 413);
    assert.equal((await post(base, key, null, { rawBody: '{not json' })).status, 400);
    assert.equal((await post(base, key, { version: '9', events: [] })).status, 400);
    assert.equal((await post(base, key, { version: '1.1', events: [1, 2, 3, 4] })).status, 413);
  } finally { await s.close(); }
});

test('server: duplicates are idempotent', async () => {
  const { s, base } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    const rep = { version: '1.1', events: [synth(MASTER, { event_id: 'syn-1' })] };
    assert.equal((await post(base, key, rep)).body.accepted, 1);
    const r = await post(base, key, rep);
    assert.equal(r.body.duplicates, 1);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM events').get().n, 1);
  } finally { await s.close(); }
});

test('server: rate limit per key', async () => {
  const { s, base } = await start({ ratePerMin: 2 });
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    const rep = () => ({ version: '1.1', events: [synth(MASTER, { event_id: nonce() })] });
    assert.equal((await post(base, key, rep())).status, 200);
    assert.equal((await post(base, key, rep())).status, 200);
    assert.equal((await post(base, key, rep())).status, 429);
  } finally { await s.close(); }
});

test('server: viewer token required for reads; revocation works', async () => {
  const { s, base } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    await post(base, key, { version: '1.1', events: [synth(MASTER)] });
    assert.equal((await get(base, '/v1/events')).status, 401);
    assert.equal((await get(base, '/v1/events', 'x'.repeat(43))).status, 401);
    const v = S.issueViewerToken(s.ctx, 'test');
    const r = await get(base, '/v1/events', v.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.records.length, 1);
    assert.equal(r.body.records[0].key_id, key.key_id);
    assert.ok(!JSON.stringify(S.readKeys(s.ctx.keysFile).viewer_tokens).includes(v.token), 'only the token hash is stored');
    S.revoke(s.ctx, v.token_id);
    assert.equal((await get(base, '/v1/events', v.token)).status, 401);
  } finally { await s.close(); }
});

test('server: storage persists across restart', async () => {
  const first = await start();
  const key = S.issueAgentKey(first.s.ctx, MASTER);
  await post(first.base, key, { version: '1.1', events: [synth(MASTER, { event_id: 'persist-1' })] });
  await first.s.close();
  const second = await start({ dataDir: first.dataDir });
  try {
    const v = S.issueViewerToken(second.s.ctx, 'test');
    const r = await get(second.base, '/v1/events', v.token);
    assert.equal(r.body.records.length, 1);
    assert.equal(r.body.records[0].raw.event_id, 'persist-1');
    assert.equal((await get(second.base, '/v1/audit/verify', v.token)).body.intact, true);
  } finally { await second.s.close(); }
});

test('server: audit log and events are append-only; tampering is detected', async () => {
  const { s, base } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    await post(base, key, { version: '1.1', events: [synth(MASTER)] });
    assert.throws(() => s.db.exec("UPDATE audit SET action = 'x' WHERE seq = 1"), /append-only/);
    assert.throws(() => s.db.exec('DELETE FROM audit'), /append-only/);
    assert.throws(() => s.db.exec("UPDATE events SET agent_key = 'x'"), /append-only/);
    assert.equal(S.verifyAudit(s.db).intact, true);
    s.db.exec('DROP TRIGGER audit_no_update');
    s.db.exec("UPDATE audit SET detail_json = '{}' WHERE seq = 2");
    const v = S.verifyAudit(s.db);
    assert.equal(v.intact, false);
    assert.equal(v.broken_at, 2);
    assert.equal((await get(base, '/v1/health')).body.audit_chain, 'broken');
  } finally { await s.close(); }
});

test('server: summary reflects stored synthetic reports only', async () => {
  const { s, base } = await start();
  try {
    const v = S.issueViewerToken(s.ctx, 'test');
    let r = await get(base, '/v1/summary', v.token);
    assert.equal(r.body.reporting, 0);
    assert.equal(r.body.api_cost_today_eur, null);
    assert.equal(r.body.verified, 3);
    const key = S.issueAgentKey(s.ctx, BUILDER);
    await post(base, key, { version: '1.1', events: [synth(BUILDER, { status: 'awaiting_approval', approval_request: { summary: 'SYNTHETIC approval' }, dry_run: false, cost_eur: 0.03 })] });
    r = await get(base, '/v1/summary', v.token);
    assert.equal(r.body.reporting, 1);
    assert.equal(r.body.approvals_pending, 1);
    assert.equal(r.body.violations, 1);
    assert.equal(r.body.api_cost_today_eur, 0.03);
  } finally { await s.close(); }
});

test('server: refuses to bind to a non-local address', () => {
  const s = S.createAccServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'acc-')) });
  assert.throws(() => s.listen(0, '0.0.0.0'), /local only/);
  s.db.close();
});

test('client: Python reference client signs requests the server accepts', async () => {
  const { s, base } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, BUILDER);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acc-')), 'r.json');
    fs.writeFileSync(file, JSON.stringify({ version: '1.1', events: [synth(BUILDER, { event_id: 'py-1' })] }));
    const p = await new Promise(resolve => {
      const { spawn } = require('node:child_process');
      const c = spawn('python3', [path.join(ROOT, 'clients/acc_report_client.py'), '--url', base, '--key-id', key.key_id, '--file', file], { env: Object.assign({}, process.env, { ACC_AGENT_SECRET: key.secret_b64url }) });
      let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
      c.on('close', code => resolve({ code, out }));
    });
    assert.equal(p.code, 0, p.out);
    assert.match(p.out, /^200 /);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM events').get().n, 1);
    const noSecret = spawnSync('python3', [path.join(ROOT, 'clients/acc_report_client.py'), '--url', base, '--key-id', key.key_id, '--file', file], { env: { PATH: process.env.PATH } });
    assert.notEqual(noSecret.status, 0);
  } finally { await s.close(); }
});
