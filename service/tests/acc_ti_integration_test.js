'use strict';
/* ACC-R009 end-to-end tests: the Travel Intelligence reporter (scripts/acc_report.py from the TI development
   branch, copied under integrations/) posting to a local ACC server. Outcome records come from the real agent
   code run against test harnesses, or are derived from them; all inputs are synthetic or recorded. Nothing
   connects to Travel Intelligence or GitHub. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const S = require('../server/acc_server.js');
const ACC = require('../acc_core.js');

const ROOT = path.join(__dirname, '..');
const REPORTER = path.join(ROOT, 'integrations/travel_intelligence/acc_report.py');
const FIX = path.join(__dirname, 'fixtures/ti_outcomes');
const MASTER = '03AA-04_Master_Agent_TI_Ops_Director';
const BUILDER = '03AA-04_Country_Intelligence_Builder_TI';
const PC = '03AA-04_Production_Controller_TI';

function reporter(args, env) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const c = spawn('python3', [REPORTER, ...args], { env: Object.assign({ PATH: process.env.PATH }, env) });
    let out = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    c.on('close', code => resolve({ code, out: out.trim(), ms: Date.now() - t0 }));
  });
}

async function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-int-'));
  const s = S.createAccServer({ dataDir, staticDir: ROOT });
  const addr = await s.listen(0, '127.0.0.1');
  const base = 'http://127.0.0.1:' + addr.port;
  const keys = { [MASTER]: S.issueAgentKey(s.ctx, MASTER), [BUILDER]: S.issueAgentKey(s.ctx, BUILDER), [PC]: S.issueAgentKey(s.ctx, PC) };
  const envFor = (agent, runId, keyAgent) => {
    const k = keys[keyAgent || agent];
    return { ACC_REPORT_URL: base, ACC_KEY_ID: k.key_id, ACC_AGENT_SECRET: k.secret_b64url, GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'schedule' };
  };
  const stored = () => s.db.prepare('SELECT agent_key, raw_json, flags_json FROM events ORDER BY id').all()
    .map(r => Object.assign({ agent_key: r.agent_key, flags: JSON.parse(r.flags_json).map(f => f.code) }, JSON.parse(r.raw_json)));
  return { s, base, keys, envFor, stored };
}

/* Representative executions: [label, agent, phase, fixture or null, step outcome, expected ACC status] */
const RUNS = [
  ['master start', MASTER, 'start', null, '', 'working'],
  ['master dry-run cycle (real record)', MASTER, 'end', 'monitor_dry_run', 'success', 'idle'],
  ['master gateway not configured', MASTER, 'end', 'monitor_not_configured', 'failure', 'failed'],
  ['master crash before outcome', MASTER, 'end', 'monitor_crash', 'failure', 'failed'],
  ['master no outcome, step failed', MASTER, 'end', 'missing', 'failure', 'failed'],
  ['builder start', BUILDER, 'start', null, '', 'working'],
  ['builder held exceptions need decision', BUILDER, 'end', 'builder_run', 'success', 'awaiting_approval'],
  ['builder publish run, nothing to decide', BUILDER, 'end', 'builder_publish_idle', 'success', 'idle'],
  ['builder configuration error', BUILDER, 'end', 'builder_config_error', 'failure', 'failed'],
  ['controller start', PC, 'start', null, '', 'working'],
  ['controller observe verdict', PC, 'end', 'controller_observe_ok', 'success', 'idle'],
  ['controller observe, failing verdict', PC, 'end', 'controller_observe_failing', 'success', 'idle'],
  ['controller active, exceptions need decision', PC, 'end', 'controller_active_needs_decision', 'failure', 'awaiting_approval'],
  ['controller no outcome, step succeeded', PC, 'end', 'missing', 'success', 'unknown']
];

test('integration: representative runs for all three verified agents are authenticated, stored and mapped', async () => {
  const { s, envFor, stored, base } = await setup();
  try {
    let runId = 9000;
    for (const [label, agent, phase, fixture, step, want] of RUNS) {
      runId++;
      const args = [phase, '--agent', agent];
      if (phase === 'end') args.push('--outcome-file', fixture === 'missing' ? path.join(os.tmpdir(), 'no-such-outcome.json') : path.join(FIX, fixture + '.json'), '--step-outcome', step);
      const r = await reporter(args, envFor(agent, runId));
      assert.equal(r.code, 0, label);
      assert.match(r.out, new RegExp('^ACC_REPORT ACCEPTED ' + agent + ' ' + want), label + ': ' + r.out);
    }
    const ev = stored();
    assert.equal(ev.length, RUNS.length);
    RUNS.forEach(([label, agent, , , , want], i) => {
      assert.equal(ev[i].agent_id, agent, label);
      assert.equal(ev[i].status, want, label);
      assert.match(ev[i].event_id, /^gh-run-\d+-1-(start|end)$/, label);
    });
    assert.deepEqual([...new Set(ev.map(e => e.status))].sort(), ['awaiting_approval', 'failed', 'idle', 'unknown', 'working']);

    // Field mapping on real records
    const dry = ev[1];
    assert.equal(dry.dry_run, true); assert.equal(dry.model_tier, 'code'); assert.equal(dry.cost_eur, 0);
    assert.ok(!('cost_usd_estimated' in dry), 'the monitor\u2019s would-cost estimate is not reported as spend');
    assert.match(ev[6].approval_request.summary, /held exception\(s\) need .*decision/);
    assert.equal(ev[7].dry_run, false); assert.equal(ev[7].model_tier, 'code');
    assert.equal(ev[12].dry_run, false); assert.match(ev[12].approval_request.summary, /production exception\(s\) need a decision/);
    assert.equal(ev[10].dry_run, true);

    // No false violations: code-only live runs (publishing, active controller) are not paid execution
    for (const e of ev) assert.ok(!e.flags.includes('NO_ALLOWANCE_CONFIGURED'), e.task + ' ' + e.flags);
    for (const e of ev) assert.ok(!e.flags.some(f => ['ID_UNVERIFIED', 'ID_SUPERSEDED'].includes(f)), 'reports use verified codes');

    // Audit: one report_received per run, attributed to the agent; chain intact
    const audit = s.db.prepare("SELECT actor FROM audit WHERE action = 'report_received'").all();
    assert.equal(audit.length, RUNS.length);
    assert.equal(S.verifyAudit(s.db).intact, true);

    // Dashboard summary through the viewer API
    const v = S.issueViewerToken(s.ctx, 'int');
    const sum = await (await fetch(base + '/v1/summary', { headers: { Authorization: 'Bearer ' + v.token } })).json();
    assert.equal(sum.reporting, 3);
    assert.equal(sum.violations, 0);
    // Current state per agent is its latest report (the end event of its last run)
    const store = ACC.createStore();
    for (const e of ev) ACC.ingestReport(store, { version: '1.1', events: [Object.fromEntries(Object.entries(e).filter(([k]) => !['agent_key', 'flags'].includes(k)))] }, Date.now());
    const cur = Object.fromEntries(ACC.REGISTER.filter(a => a.code).map(a => [a.code, ACC.currentEvent(store, a, Date.now()).status]));
    assert.deepEqual(cur, { [MASTER]: 'failed', [BUILDER]: 'failed', [PC]: 'unknown' });
  } finally { await s.close(); }
});

test('integration: retries are idempotent, keys are bound to one agent, bad secrets are refused', async () => {
  const { s, envFor, keys, stored } = await setup();
  try {
    const args = ['end', '--agent', PC, '--outcome-file', path.join(FIX, 'controller_observe_ok.json'), '--step-outcome', 'success'];
    assert.match((await reporter(args, envFor(PC, 77))).out, /^ACC_REPORT ACCEPTED/);
    assert.match((await reporter(args, envFor(PC, 77))).out, /^ACC_REPORT DUPLICATE/, 'same run and phase is not double counted');
    const mismatch = await reporter(['start', '--agent', MASTER], envFor(MASTER, 78, BUILDER));
    assert.equal(mismatch.code, 0);
    assert.match(mismatch.out, /^ACC_REPORT REJECTED/);
    assert.equal(s.db.prepare("SELECT code FROM rejections ORDER BY id DESC LIMIT 1").get().code, 'AGENT_KEY_MISMATCH');
    const bad = await reporter(['start', '--agent', PC], Object.assign(envFor(PC, 79), { ACC_AGENT_SECRET: crypto.randomBytes(32).toString('base64url') }));
    assert.equal(bad.code, 0);
    assert.match(bad.out, /^ACC_REPORT HTTP_401/);
    assert.ok(!bad.out.includes(keys[PC].secret_b64url));
    S.revoke(s.ctx, keys[BUILDER].key_id);
    assert.match((await reporter(['start', '--agent', BUILDER], envFor(BUILDER, 80))).out, /^ACC_REPORT HTTP_401/);
    assert.equal(stored().length, 1);
  } finally { await s.close(); }
});

test('integration: only verified agent activity can be reported', async () => {
  const { s, envFor, stored } = await setup();
  try {
    for (const notAgent of ['daily-data-refresh', 'baseline-population', 'sqe', 'ti-country-builder', 'Global OSINT Discovery Agent']) {
      const r = await reporter(['start', '--agent', notAgent], envFor(PC, 81));
      assert.equal(r.code, 0);
      assert.match(r.out, /^ACC_REPORT ERROR ValueError/, notAgent);
    }
    assert.equal(stored().length, 0);
    for (const a of ACC.REGISTER.filter(x => x.verification !== 'verified')) {
      assert.equal(a.integration.state, 'none', a.name);
      assert.throws(() => S.issueAgentKey(s.ctx, a.code || a.interim_id), /verified agent codes/);
    }
  } finally { await s.close(); }
});

test('integration: reporting off or ACC unreachable never blocks or fails a run', async () => {
  const off = await reporter(['start', '--agent', MASTER], {});
  assert.equal(off.code, 0);
  assert.match(off.out, /^ACC_REPORT SKIPPED_NOT_CONFIGURED/);
  const down = await reporter(['end', '--agent', BUILDER, '--outcome-file', path.join(FIX, 'builder_run.json'), '--step-outcome', 'success'],
    { ACC_REPORT_URL: 'http://127.0.0.1:9', ACC_KEY_ID: 'k_x', ACC_AGENT_SECRET: crypto.randomBytes(32).toString('base64url') });
  assert.equal(down.code, 0);
  assert.match(down.out, /^ACC_REPORT UNREACHABLE_/);
  assert.ok(down.ms < 10000, 'bounded by the reporter timeout');
  const insecure = await reporter(['start', '--agent', PC], { ACC_REPORT_URL: 'http://acc.example.com', ACC_KEY_ID: 'k', ACC_AGENT_SECRET: 'x' });
  assert.match(insecure.out, /^ACC_REPORT SKIPPED_INSECURE_URL/);
  const badSecret = await reporter(['start', '--agent', PC], { ACC_REPORT_URL: 'http://127.0.0.1:9', ACC_KEY_ID: 'k', ACC_AGENT_SECRET: 'x' });
  assert.equal(badSecret.code, 0);
  assert.match(badSecret.out, /^ACC_REPORT SKIPPED_BAD_SECRET/);
});

test('integration: vendored reporter matches the recorded TI PR #44 version and fixtures name their source', () => {
  const src = fs.readFileSync(path.join(ROOT, 'integrations/travel_intelligence/SOURCE.txt'), 'utf8');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(REPORTER)).digest('hex');
  assert.ok(src.includes(sha), 'integrations copy differs from the recorded TI branch version');
  for (const f of fs.readdirSync(FIX)) assert.ok(JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'))._fixture.source, f);
});
