'use strict';
/* ACC-R015 tests: the public status feed cannot expose unrestricted backend data; proxy-aware limits; progressive
   agent-by-agent connection with the real reporter. Synthetic events only; nothing leaves the machine. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const S = require('../server/acc_server.js');
const P = require('../server/public_status.js');

const ROOT = path.join(__dirname, '..');
const REPORTER = path.join(ROOT, 'integrations/travel_intelligence/acc_report.py');
const MASTER = '03AA-04_Master_Agent_TI_Ops_Director';
const BUILDER = '03AA-04_Country_Intelligence_Builder_TI';
const CONTROLLER = '03AA-04_Production_Controller_TI';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acc15-'));
const tsNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

async function start(opts) {
  const dataDir = tmp();
  const s = S.createAccServer(Object.assign({ dataDir, staticDir: ROOT, publicStatus: true }, opts || {}));
  const i = await s.listenIngest(0, '127.0.0.1');
  return { s, dataDir, ing: 'http://127.0.0.1:' + i.port };
}
async function post(base, key, events) {
  const body = Buffer.from(JSON.stringify({ version: '1.1', events }));
  const ts = tsNow(), n = crypto.randomBytes(16).toString('hex');
  const sig = S.sign(key.secret_b64url, 'POST', '/v1/events', ts, n, body);
  const r = await fetch(base + '/v1/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-ACC-Key-Id': key.key_id, 'X-ACC-Timestamp': ts, 'X-ACC-Nonce': n, 'X-ACC-Signature': sig } });
  return { status: r.status, body: await r.json() };
}

test('every field an agent can send is kept out of the public document, including unknown extras', async () => {
  const { s, ing } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    const M = i => 'SENTINEL_' + i + '_' + crypto.randomBytes(5).toString('hex');
    const marks = {};
    const ev = {
      agent_id: MASTER, status: 'awaiting_approval', timestamp: new Date(Date.now() - 2000).toISOString(),
      event_id: (marks.event_id = M('event_id')), task: (marks.task = M('task')), run_ref: (marks.run_ref = M('run_ref')),
      dry_run: false, model_tier: 'sonnet', escalation_reason: (marks.esc = M('escalation')), approval_reference: (marks.appr = M('approval_ref')),
      cost_eur: 12.3456, cost_basis: 'api', cost_usd_estimated: 99.9,
      approval_request: { summary: (marks.sum = M('summary')), reference: (marks.ref = M('reference')) },
      delivery: { queued_at_utc: new Date(Date.now() - 60000).toISOString(), attempts: 7, dropped_before: 3 },
      internal_note: (marks.note = M('internal_note')), secret: (marks.secret = M('secret')), nested: { deep: (marks.deep = M('deep')) }, list: [(marks.list = M('list'))]
    };
    const res = await post(ing, key, [ev]);
    assert.equal(res.body.accepted, 1, JSON.stringify(res.body));
    const doc = await (await fetch(ing + '/public/status.json')).json();
    P.assertPublicSafe(doc);
    const text = JSON.stringify(doc);
    for (const [k, v] of Object.entries(marks)) assert.ok(!text.includes(v), 'leaked ' + k);
    for (const v of ['12.3456', '99.9', 'sonnet', 'attempts', 'queued_at', key.key_id, key.secret_b64url]) assert.ok(!text.includes(v), 'leaked value ' + v);
    const m = doc.agents.find(a => a.agent_id === MASTER);
    assert.equal(m.state, 'awaiting_approval');
    assert.deepEqual(Object.keys(m).sort(), ['agent_id', 'as_of_utc', 'history', 'last_report_utc', 'name', 'reports_24h', 'state', 'state_reason', 'verification']);
    assert.deepEqual(Object.keys(m.history[0]).sort(), ['at_utc', 'delivered_late', 'mode', 'state']);
  } finally { await s.close(); }
});

test('HTTP surface: only three paths answer on the public listener, whatever the path, query, method or encoding', async () => {
  const { s, ing, dataDir } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, CONTROLLER);
    await post(ing, key, [{ agent_id: CONTROLLER, status: 'idle', timestamp: new Date(Date.now() - 1000).toISOString(), event_id: 'e1', task: 'SENTINEL_TASK' }]);
    const privateMarks = [key.key_id, key.secret_b64url, dataDir, 'acc_keys', 'SENTINEL_TASK', 'nonce', 'audit_hash', 'prev_hash', 'viewer', 'sha256', 'detail_json'];
    const bad = ['/v1/events', '/v1/events?limit=1', '/v1/audit', '/v1/audit/verify', '/v1/summary', '/v1/rejections', '/index.html', '/', '/acc_core.js', '/acc_register.js',
      '/.env', '/acc_data/acc_keys.json', '/server/acc_server.js', '/package.json', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc/passwd', '/public/../v1/audit',
      '/public/%2e%2e/v1/events', '//public/status.json', '/public/status.json/', '/public/status.json/..', '/PUBLIC/STATUS.JSON', '/public/status.json%00', '/public/status.jsonx',
      '/public', '/public/', '/public/status', '/public/index.json', '/v1/health/../events'];
    for (const p of bad) {
      const r = await fetch(ing + p, { redirect: 'manual' });
      const t = await r.text();
      assert.equal(r.status === 404 || r.status === 400, true, p + ' -> ' + r.status);
      for (const m of privateMarks) assert.ok(!t.includes(m), p + ' leaked ' + m);
    }
    for (const method of ['HEAD', 'OPTIONS', 'PUT', 'DELETE', 'PATCH', 'POST', 'TRACE']) {
      for (const p of ['/public/status.json', '/v1/health', '/v1/audit']) {
        if (method === 'POST' && p === '/v1/health') continue;
        const r = await fetch(ing + p, { method, body: ['PUT', 'DELETE', 'PATCH', 'POST'].includes(method) ? '{}' : undefined, headers: { 'Content-Type': 'application/json' } }).catch(() => null);
        if (!r) continue;
        assert.notEqual(r.status, 200, method + ' ' + p);
      }
    }
    const plain = await (await fetch(ing + '/public/status.json')).text();
    for (const q of ['?limit=5000', '?since=2000-01-01', '?agent=*', '?debug=1', '?format=raw', '?callback=x', '?include=audit,keys,events']) {
      const t = await (await fetch(ing + '/public/status.json' + q)).text();
      const strip = x => JSON.stringify(JSON.parse(x), (k, v) => k === 'generated_at_utc' ? undefined : v);
      assert.equal(strip(t), strip(plain), 'query ' + q + ' must not change the document');
    }
    assert.deepEqual(await (await fetch(ing + '/v1/health')).json(), { ok: true });
    for (const m of privateMarks) assert.ok(!plain.includes(m), 'public document leaked ' + m);
  } finally { await s.close(); }
});

test('the public document is bounded: size and shape stay small however much is stored', async () => {
  const { s, ing } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, MASTER);
    const events = []; for (let i = 0; i < 400; i++) events.push({ agent_id: MASTER, status: i % 2 ? 'idle' : 'working', timestamp: new Date(Date.now() - 1000 - i * 1000).toISOString(), event_id: 'b' + i, task: 'X'.repeat(500) });
    assert.equal((await post(ing, key, events)).body.accepted, 400);
    const r = await fetch(ing + '/public/status.json');
    const t = await r.text();
    assert.ok(t.length < 20000, 'document is ' + t.length + ' bytes');
    const doc = JSON.parse(t);
    assert.equal(doc.agents.find(a => a.agent_id === MASTER).history.length, P.HISTORY_MAX);
    assert.equal(doc.agents.find(a => a.agent_id === MASTER).reports_24h, 400, 'counts are numbers only');
  } finally { await s.close(); }
});

test('behind a managed host: visitors are rate limited per client address, not as one shared proxy address', async () => {
  const hit = async (base, ip) => (await fetch(base + '/public/status.json', { headers: ip ? { 'Fly-Client-IP': ip } : {} })).status;
  { // private-proxy mode: separate buckets per forwarded client address
    const { s, ing } = await start({ trustProxy: 'private', ratePerMin: 3 });
    try {
      for (const ip of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) for (let i = 0; i < 3; i++) assert.equal(await hit(ing, ip), 200, ip);
      assert.equal(await hit(ing, '203.0.113.1'), 429, 'the same client is limited');
      assert.equal(await hit(ing, '203.0.113.4'), 200, 'a different client is unaffected');
      assert.equal(await hit(ing, 'not-an-ip<script>'), 200, 'a malformed header falls back safely');
    } finally { await s.close(); }
  }
  { // header ignored when proxy trust is off: an attacker cannot rotate addresses to dodge the limit
    const { s, ing } = await start({ trustProxy: false, ratePerMin: 3 });
    try {
      const codes = []; for (let i = 0; i < 5; i++) codes.push(await hit(ing, '198.51.100.' + i));
      assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    } finally { await s.close(); }
  }
  { // loopback-only trust (a tunnel on the same host) does not read Fly-Client-IP
    const { s, ing } = await start({ trustProxy: true, ratePerMin: 3 });
    try {
      const codes = []; for (let i = 0; i < 5; i++) codes.push(await hit(ing, '198.51.100.' + i));
      assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    } finally { await s.close(); }
  }
});

function reporter(args, env) {
  return new Promise(resolve => {
    const c = spawn('python3', [REPORTER, ...args], { env: Object.assign({ PATH: process.env.PATH }, env) });
    let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    c.on('close', code => resolve({ code, out: out.trim() }));
  });
}

test('progressive connection: with only one agent configured, the others skip harmlessly and only that agent appears', async () => {
  const { s, ing } = await start();
  const work = tmp();
  try {
    const key = S.issueAgentKey(s.ctx, CONTROLLER);
    const cfg = { ACC_REPORT_URL: ing, ACC_KEY_ID: key.key_id, ACC_AGENT_SECRET: key.secret_b64url, GITHUB_RUN_ID: '9001', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'schedule' };
    // The other two agents have no key settings yet (as in production before they are connected).
    for (const agent of [MASTER, BUILDER]) {
      const r = await reporter(['start', '--agent', agent, '--pending-file', path.join(work, agent + '.pending')], { GITHUB_RUN_ID: '9001' });
      assert.equal(r.code, 0, agent + ' must never fail the run');
      assert.match(r.out, /SKIPPED_NOT_CONFIGURED/, agent);
    }
    let r = await reporter(['start', '--agent', CONTROLLER, '--pending-file', path.join(work, 'c.pending')], cfg);
    assert.match(r.out, /ACCEPTED/);
    r = await reporter(['end', '--agent', CONTROLLER, '--outcome-file', path.join(ROOT, 'tests/fixtures/ti_outcomes/controller_observe_ok.json'), '--step-outcome', 'success', '--outbox-file', path.join(work, 'c.outbox'), '--pending-file', path.join(work, 'c.pending')], cfg);
    assert.match(r.out, /ACCEPTED/);
    const doc = await (await fetch(ing + '/public/status.json')).json();
    const by = c => doc.agents.find(a => a.agent_id === c);
    assert.equal(by(CONTROLLER).state, 'idle');
    assert.equal(by(MASTER).state, 'unknown'); assert.equal(by(MASTER).state_reason, 'no_report');
    assert.equal(by(BUILDER).state, 'unknown');
    assert.equal(S.verifyAudit(s.db).intact, true);
  } finally { await s.close(); }
});

test('a key issued for one agent can never write another agent\'s status', async () => {
  const { s, ing } = await start();
  try {
    const key = S.issueAgentKey(s.ctx, CONTROLLER);
    const r = await post(ing, key, [{ agent_id: MASTER, status: 'failed', timestamp: new Date(Date.now() - 1000).toISOString(), event_id: 'forge1' }]);
    assert.equal(r.body.rejected, 1);
    const doc = await (await fetch(ing + '/public/status.json')).json();
    assert.equal(doc.agents.find(a => a.agent_id === MASTER).state, 'unknown');
  } finally { await s.close(); }
});
