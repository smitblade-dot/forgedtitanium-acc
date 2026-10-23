'use strict';
/* ACC-R010 tests. Synthetic events only; nothing leaves the machine. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const S = require('../server/acc_server.js');
const A = require('../acc_core.js');

const ROOT = path.join(__dirname, '..');
const MASTER = '03AA-04_Master_Agent_TI_Ops_Director';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acc10-'));
const tsNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

async function start(opts) {
  const dataDir = tmp();
  const s = S.createAccServer(Object.assign({ dataDir, staticDir: ROOT }, opts || {}));
  const p = await s.listen(0, '127.0.0.1');
  const i = await s.listenIngest(0, '127.0.0.1');
  return { s, dataDir, priv: 'http://127.0.0.1:' + p.port, ing: 'http://127.0.0.1:' + i.port };
}
async function post(base, key, events, headers) {
  const body = Buffer.from(JSON.stringify({ version: '1.1', events }));
  const ts = tsNow(), n = crypto.randomBytes(16).toString('hex');
  const r = await fetch(base + '/v1/events', { method: 'POST', body, headers: Object.assign({ 'Content-Type': 'application/json', 'X-ACC-Key-Id': key.key_id, 'X-ACC-Timestamp': ts, 'X-ACC-Nonce': n, 'X-ACC-Signature': S.sign(key.secret_b64url, 'POST', '/v1/events', ts, n, body) }, headers || {}) });
  return { status: r.status, body: await r.json() };
}
const ev = extra => Object.assign({ agent_id: MASTER, status: 'idle', timestamp: new Date(Date.now() - 1000).toISOString(), event_id: crypto.randomBytes(4).toString('hex'), task: 'SYNTHETIC', dry_run: true, model_tier: 'code', cost_eur: 0 }, extra || {});

test('ingest listener: accepts signed reports and nothing else', async () => {
  const { s, priv, ing } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    const v = S.issueViewerToken(s.ctx, 't');
    assert.equal((await post(ing, key, [ev()])).body.accepted, 1);
    const auth = { headers: { Authorization: 'Bearer ' + v.token } };
    for (const p of ['/', '/index.html', '/acc_register.js', '/v1/events', '/v1/summary', '/v1/audit', '/v1/audit/verify', '/v1/rejections']) {
      assert.equal((await fetch(ing + p, auth)).status, 404, 'ingest must not serve ' + p);
      assert.notEqual((await fetch(priv + p, auth)).status, 404, 'private serves ' + p);
    }
    assert.deepEqual(await (await fetch(ing + '/v1/health')).json(), { ok: true }, 'public health reveals nothing');
    assert.equal((await (await fetch(priv + '/v1/health')).json()).release, 'ACC-R011');
    const bad = await fetch(ing + '/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(bad.status, 401);
  } finally { await s.close(); }
});

test('ingest listener: refuses a non-local bind', async () => {
  const s = S.createAccServer({ dataDir: tmp() });
  try { assert.throws(() => s.listenIngest(0, '0.0.0.0'), /local only/); } finally { await s.close(); }
});

test('proxy: client address recorded from forwarding headers only when trusted and from loopback', async () => {
  for (const [trust, xff, want] of [[true, '203.0.113.5, 198.51.100.9', '203.0.113.5 (via proxy)'], [false, '203.0.113.5', '127.0.0.1'], [true, 'not-an-ip<script>', '127.0.0.1']]) {
    const { s, ing } = await start({ trustProxy: trust });
    try {
      const r = await fetch(ing + '/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff }, body: '{}' });
      assert.equal(r.status, 401);
      const d = JSON.parse(s.db.prepare("SELECT detail_json FROM audit WHERE action = 'auth_failed' ORDER BY seq DESC LIMIT 1").get().detail_json);
      assert.equal(d.remote.replace('::ffff:', ''), want, xff);
    } finally { await s.close(); }
  }
});

test('backup: consistent copy with manifest, verified, audited, keys excluded', async () => {
  const { s, ing } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    await post(ing, key, [ev(), ev({ status: 'working' })]);
    const dir = tmp();
    const b = S.backupDb(s.ctx, dir, 'test');
    assert.equal(b.events, 2);
    assert.equal(b.audit_intact, true);
    assert.equal(fs.statSync(b.path).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(dir).sort(), [path.basename(b.path), path.basename(b.path) + '.manifest.json']);
    assert.ok(!fs.readFileSync(b.path).includes(Buffer.from(key.secret_b64url)), 'no key secret in the backup');
    assert.deepEqual(S.verifyBackup(b.path).ok, true);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM audit WHERE action = 'backup_created'").get().n, 1);
    // The live database keeps working after a backup
    assert.equal((await post(ing, key, [ev()])).body.accepted, 1);
    // Restore check: the copy opens as a working ACC data directory
    const restore = tmp();
    fs.copyFileSync(b.path, path.join(restore, 'acc_events.sqlite3'));
    const r2 = S.createAccServer({ dataDir: restore });
    try { assert.equal(S.dbStats(r2.db).events, 2); assert.equal(S.verifyAudit(r2.db).intact, true); } finally { await r2.close(); }
    // Tampering is detected
    const m = JSON.parse(fs.readFileSync(b.path + '.manifest.json', 'utf8'));
    fs.writeFileSync(b.path + '.manifest.json', JSON.stringify(Object.assign({}, m, { events: 99 })));
    assert.equal(S.verifyBackup(b.path).reason, 'content differs from manifest');
    fs.appendFileSync(b.path, Buffer.from([0]));
    assert.equal(S.verifyBackup(b.path).reason, 'checksum mismatch');
  } finally { await s.close(); }
});

test('audit export: re-verifiable off-site, tampering detected', async () => {
  const { s, ing } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    await post(ing, key, [ev()]);
    const f = path.join(tmp(), 'audit.jsonl');
    const r = S.exportAudit(s.ctx, f, 'test');
    const v = S.verifyAuditExport(f);
    assert.equal(v.intact, true);
    assert.equal(v.entries, r.entries);
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    const x = JSON.parse(lines[1]); x.action = 'edited';
    lines[1] = JSON.stringify(x);
    fs.writeFileSync(f, lines.join('\n') + '\n');
    assert.equal(S.verifyAuditExport(f).intact, false);
  } finally { await s.close(); }
});

test('admin CLI: stats, backup and verify-backup', () => {
  const dataDir = tmp(), backups = tmp();
  const env = Object.assign({}, process.env, { ACC_DATA_DIR: dataDir, NODE_NO_WARNINGS: '1' });
  const run = (...a) => spawnSync('node', [path.join(ROOT, 'server/acc_admin.js'), ...a], { env, encoding: 'utf8' });
  assert.equal(run('issue-agent-key', MASTER).status, 0);
  const st = JSON.parse(run('stats').stdout);
  assert.equal(st.audit_intact, true);
  const b = run('backup', backups);
  assert.equal(b.status, 0, b.stderr);
  const file = JSON.parse(b.stdout).path;
  assert.equal(run('verify-backup', file).status, 0);
  fs.appendFileSync(file, 'x');
  assert.equal(run('verify-backup', file).status, 1);
});
