'use strict';
/* ACC-R014 tests: the restricted public status view. Synthetic events only; nothing leaves the machine. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const S = require('../server/acc_server.js');
const P = require('../server/public_status.js');

const ROOT = path.join(__dirname, '..');
const MASTER = '03AA-04_Master_Agent_TI_Ops_Director';
const BUILDER = '03AA-04_Country_Intelligence_Builder_TI';
const CONTROLLER = '03AA-04_Production_Controller_TI';
const NOW = Date.parse('2026-10-23T12:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acc14-'));
const ago = min => new Date(NOW - min * 60000).toISOString();

const SECRETS = ['SECRET-TASK-NAME', 'run-ref-9999', 'sk-secret-escalation', 'approve-the-confidential-thing', 'CONFIDENTIAL-REFERENCE', 'event-id-abc123'];
function row(agent, status, minutesAgo, extra) {
  const raw = Object.assign({ agent_id: agent, status, timestamp: ago(minutesAgo), event_id: 'event-id-abc123-' + minutesAgo, task: 'SECRET-TASK-NAME', run_ref: 'run-ref-9999',
    dry_run: true, model_tier: 'haiku', cost_eur: 0.0042, cost_basis: 'api', approval_reference: 'CONFIDENTIAL-REFERENCE' }, extra || {});
  return { schema_version: '1.1', raw_json: JSON.stringify(raw), key_id: 'key_x', received_at_utc: ago(minutesAgo) };
}
const agentOf = (doc, code) => doc.agents.find(a => a.agent_id === code);

test('states: active, idle, failed, disconnected, awaiting approval, unknown are distinguished', () => {
  const doc = P.buildPublicStatus([
    row(MASTER, 'working', 10), row(BUILDER, 'failed', 30), row(CONTROLLER, 'idle', 5)], NOW);
  assert.equal(agentOf(doc, MASTER).state, 'active');
  assert.equal(agentOf(doc, BUILDER).state, 'failed');
  assert.equal(agentOf(doc, CONTROLLER).state, 'idle');
  for (const [status, want] of [['offline', 'disconnected'], ['awaiting_approval', 'awaiting_approval'], ['unknown', 'unknown']]) {
    const d = P.buildPublicStatus([row(MASTER, status, 5, status === 'awaiting_approval' ? { approval_request: { summary: 'approve-the-confidential-thing' } } : {})], NOW);
    assert.equal(agentOf(d, MASTER).state, want, status);
  }
});

test('unknown is never guessed: no report, stale report, unresolved start, provisional agents', () => {
  const none = P.buildPublicStatus([], NOW);
  assert.equal(agentOf(none, MASTER).state, 'unknown');
  assert.equal(agentOf(none, MASTER).state_reason, 'no_report');
  assert.equal(agentOf(none, MASTER).as_of_utc, null);
  const stale = P.buildPublicStatus([row(MASTER, 'idle', 25 * 60)], NOW);
  assert.equal(agentOf(stale, MASTER).state, 'unknown');
  assert.equal(agentOf(stale, MASTER).state_reason, 'stale');
  assert.equal(agentOf(stale, MASTER).last_report_utc, ago(25 * 60), 'the old report time is still shown honestly');
  const hung = P.buildPublicStatus([row(MASTER, 'working', 121)], NOW);
  assert.equal(agentOf(hung, MASTER).state, 'unknown');
  assert.equal(agentOf(hung, MASTER).state_reason, 'no_completion');
  const fresh = P.buildPublicStatus([row(MASTER, 'working', 119)], NOW);
  assert.equal(agentOf(fresh, MASTER).state, 'active');
  const prov = none.agents.filter(a => a.verification === 'provisional');
  assert.equal(prov.length, 5);
  for (const a of prov) { assert.equal(a.state, 'unknown'); assert.equal(a.agent_id, null); assert.deepEqual(a.history, []); }
});

test('a later completion resolves an earlier start; a later failure beats an earlier idle', () => {
  const done = agentOf(P.buildPublicStatus([row(MASTER, 'working', 200), row(MASTER, 'idle', 190)], NOW), MASTER);
  assert.equal(done.state, 'idle', 'the completion is the latest report, so the old start no longer matters');
  assert.deepEqual(done.history.map(h => h.state), ['idle', 'active'], 'both reports stay in the history');
  const worse = agentOf(P.buildPublicStatus([row(MASTER, 'idle', 300), row(MASTER, 'failed', 60)], NOW), MASTER);
  assert.equal(worse.state, 'failed');
  const recovered = agentOf(P.buildPublicStatus([row(MASTER, 'failed', 300), row(MASTER, 'idle', 60)], NOW), MASTER);
  assert.equal(recovered.state, 'idle', 'a later idle report replaces an earlier failure');
});

test('history: newest first, at most 10, public state names only', () => {
  const rows = []; for (let i = 0; i < 14; i++) rows.push(row(MASTER, i % 2 ? 'idle' : 'failed', 10 + i * 20));
  const a = agentOf(P.buildPublicStatus(rows, NOW), MASTER);
  assert.equal(a.history.length, 10);
  assert.deepEqual(a.history.map(h => h.at_utc), [...a.history.map(h => h.at_utc)].sort().reverse());
  assert.ok(a.history.every(h => P.STATES.includes(h.state)));
  assert.equal(a.reports_24h, 14);
});

test('redaction: no task, run ref, event id, cost, tier, approval text or key id can reach the public document', () => {
  const rows = [row(MASTER, 'awaiting_approval', 5, { approval_request: { summary: 'approve-the-confidential-thing', reference: 'CONFIDENTIAL-REFERENCE' }, escalation_reason: 'sk-secret-escalation', model_tier: 'sonnet' }),
    row(BUILDER, 'failed', 8), row(CONTROLLER, 'idle', 3)];
  const text = JSON.stringify(P.buildPublicStatus(rows, NOW));
  for (const s of SECRETS) assert.ok(!text.includes(s), 'leaked ' + s);
  assert.ok(!/cost|model|tier|task|run_ref|event_id|key_id|approval|escalation|flags|haiku|sonnet|0\.0042/i.test(text.replace(/awaiting_approval/g, '')), 'no operational field names or values');
});

test('assertPublicSafe rejects extra fields, bad values and markup', () => {
  const good = P.buildPublicStatus([row(MASTER, 'idle', 5)], NOW);
  assert.doesNotThrow(() => P.assertPublicSafe(JSON.parse(JSON.stringify(good))));
  const mut = fn => { const d = JSON.parse(JSON.stringify(good)); fn(d); return d; };
  const bad = [
    d => { d.agents[0].task = 'x'; },
    d => { d.extra = 1; },
    d => { d.agents[0].state = 'running'; },
    d => { d.agents[0].name = '<img src=x onerror=1>'; },
    d => { d.agents[0].last_report_utc = 'yesterday'; },
    d => { d.agents[0].agent_id = 'not-an-agent'; },
    d => { d.agents[0].history[0].note = 'free text'; },
    d => { d.agents[0].history[0].mode = 'paid'; },
    d => { delete d.agents[0].state_reason; },
    d => { d.agents[0].reports_24h = -1; }
  ];
  for (const fn of bad) assert.throws(() => P.assertPublicSafe(mut(fn)), /not safe/);
});

async function start(opts) {
  const dataDir = tmp();
  const s = S.createAccServer(Object.assign({ dataDir, staticDir: ROOT }, opts || {}));
  const p = await s.listen(0, '127.0.0.1');
  const i = await s.listenIngest(0, '127.0.0.1');
  return { s, dataDir, priv: 'http://127.0.0.1:' + p.port, ing: 'http://127.0.0.1:' + i.port };
}
const tsNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
async function post(base, key, events) {
  const body = Buffer.from(JSON.stringify({ version: '1.1', events }));
  const ts = tsNow(), n = crypto.randomBytes(16).toString('hex');
  const sig = S.sign(key.secret_b64url, 'POST', '/v1/events', ts, n, body);
  const r = await fetch(base + '/v1/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-ACC-Key-Id': key.key_id, 'X-ACC-Timestamp': ts, 'X-ACC-Nonce': n, 'X-ACC-Signature': sig } });
  return { status: r.status, body: await r.json() };
}
const evt = (agent, status, extra) => Object.assign({ agent_id: agent, status, timestamp: new Date(Date.now() - 1000).toISOString(), event_id: crypto.randomBytes(6).toString('hex'),
  task: 'SECRET-TASK-NAME', run_ref: 'run-ref-9999', dry_run: true, model_tier: 'code', cost_eur: 0 }, extra || {});

test('endpoint is OFF by default on both listeners', async () => {
  const { s, priv, ing } = await start();
  try {
    assert.equal((await fetch(ing + '/public/status.json')).status, 404);
    assert.equal((await fetch(priv + '/public/status.json')).status, 404);
  } finally { await s.close(); }
});

test('endpoint ON: redacted, unauthenticated, read-only, CORS only for the configured origin', async () => {
  const { s, ing } = await start({ publicStatus: true, publicOrigin: 'https://example.github.io' });
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    assert.equal((await post(ing, key, [evt(MASTER, 'idle')])).body.accepted, 1);
    const r = await fetch(ing + '/public/status.json');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://example.github.io');
    assert.match(r.headers.get('cache-control'), /max-age=30/);
    const doc = await r.json();
    assert.equal(P.assertPublicSafe(doc), doc);
    assert.equal(agentOf(doc, MASTER).state, 'idle');
    const text = JSON.stringify(doc);
    for (const x of SECRETS.concat([key.key_id, key.secret_b64url])) assert.ok(!text.includes(x), 'leaked ' + x);
    assert.equal((await fetch(ing + '/public/status.json', { method: 'POST', body: '{}' })).status, 404, 'no write method');
    for (const p of ['/v1/events', '/v1/summary', '/v1/audit', '/public/', '/public/status.json/../v1/audit']) assert.equal((await fetch(ing + p)).status, 404, p);
  } finally { await s.close(); }
});

test('endpoint ON without a configured origin sends no CORS header; a bad origin refuses to start', async () => {
  const { s, ing } = await start({ publicStatus: true });
  try { assert.equal((await fetch(ing + '/public/status.json')).headers.get('access-control-allow-origin'), null); } finally { await s.close(); }
  for (const bad of ['*', 'http://example.com', 'https://example.com/path', 'https://a.com, https://b.com', 'null']) {
    assert.throws(() => S.createAccServer({ dataDir: tmp(), publicStatus: true, publicOrigin: bad }), /one https origin/, bad);
  }
});

test('endpoint is rate limited per client address and cached', async () => {
  const { s, ing } = await start({ publicStatus: true, ratePerMin: 5 });
  try {
    const codes = []; for (let i = 0; i < 8; i++) codes.push((await fetch(ing + '/public/status.json')).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429, 429]);
  } finally { await s.close(); }
});

test('a signed agent event shows in the public status; a rejected or forged one does not', async () => {
  const { s, ing } = await start({ publicStatus: true });
  try {
    const key = S.issueAgentKey(s.ctx, CONTROLLER);
    const forged = await post(ing, key, [evt(MASTER, 'failed')]);
    assert.equal(forged.body.rejected, 1, 'an event for another agent is rejected');
    const ok = await post(ing, key, [evt(CONTROLLER, 'failed')]);
    assert.equal(ok.body.accepted, 1);
    const doc = await (await fetch(ing + '/public/status.json')).json();
    assert.equal(agentOf(doc, CONTROLLER).state, 'failed');
    assert.equal(agentOf(doc, MASTER).state, 'unknown');
  } finally { await s.close(); }
});

test('CLI publish-status writes a validated document and nothing secret', async () => {
  const { s, dataDir, ing } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, BUILDER);
    await post(ing, key, [evt(BUILDER, 'idle')]);
    const out = path.join(dataDir, 'status.json');
    const r = spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'server', 'acc_admin.js'), 'publish-status', out], { env: Object.assign({}, process.env, { ACC_DATA_DIR: dataDir }), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(P.assertPublicSafe(doc), doc);
    assert.equal(agentOf(doc, BUILDER).state, 'idle');
    assert.ok(!fs.readFileSync(out, 'utf8').includes(key.secret_b64url));
  } finally { await s.close(); }
});
