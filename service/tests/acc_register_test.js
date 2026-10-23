'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../acc_core.js');

const NOW = Date.parse('2026-10-22T16:42:00Z');
const MASTER = '03AA-04_Master_Agent_TI_Ops_Director';
const BUILDER = '03AA-04_Country_Intelligence_Builder_TI';
const PC = '03AA-04_Production_Controller_TI';
const ago = m => new Date(NOW - m * 60000).toISOString();
const codes = ev => ev.flags.map(f => f.code);
const agent = code => A.REGISTER.find(a => a.code === code || a.interim_id === code);
function one(raw) { const s = A.createStore(); A.ingestReport(s, { version: '1.1', events: [raw] }, NOW); return s.events[0] || s.rejected[0]; }
function withAllowance(code, allowance, fn) {
  const a = agent(code), saved = a.controls.allowance_eur;
  a.controls.allowance_eur = Object.assign({}, saved, allowance);
  try { return fn(a); } finally { a.controls.allowance_eur = saved; }
}
const APPROVED = { per_task: 0.05, daily: 0.2, monthly: 2, approved_by: 'Owner', approved_at: '2026-10-23', approval_reference: 'TEST-ALLOWANCE-1' };

/* Priority 1: agent discovery */
test('discovery: exactly three verified TI agents, each with evidence, responsibilities and five stages', () => {
  const v = A.REGISTER.filter(a => a.verification === 'verified');
  assert.deepEqual(v.map(a => a.code), [MASTER, BUILDER, PC]);
  for (const a of v) {
    assert.ok(a.evidence.includes('EV-TI-01'), a.name);
    assert.ok(a.responsibilities.length >= 3, a.name);
    for (const k of ['built', 'tested', 'merged', 'configured', 'operational']) assert.ok(a.stages[k] && a.stages[k].length > 5, a.name + ' ' + k);
    assert.equal(a.home, '03AA-04');
  }
});
test('discovery: agents not found in the TI repository are kept, flagged not evidenced, with no code', () => {
  const ne = A.REGISTER.filter(a => a.verification === 'not_evidenced');
  assert.deepEqual(ne.map(a => a.name), ['Global OSINT Discovery Agent', 'Intelligence Analyst & Publisher']);
  for (const a of ne) assert.equal(a.code, null);
  assert.deepEqual(A.REGISTER.filter(a => a.verification === 'unverified').map(a => a.name), ['Agent SQE', 'Project Quality Agent (PQA)', 'Venture Engine Agent']);
});
test('discovery: verified codes follow the repository exactly and interim IDs are superseded', () => {
  for (const [interim, code] of [['ti-director', MASTER], ['ti-country-builder', BUILDER], ['ti-production-controller', PC]]) {
    const r = A.resolveAgent(interim);
    assert.equal(r.match, 'superseded');
    assert.equal(r.agent.code, code);
    assert.equal(A.resolveAgent(code).match, 'verified');
  }
  assert.equal(A.resolveAgent('03AA-04_Country_Intelligence_Builder').match, 'unknown');
});
/* Priority 2: organisational structure */
test('structure: 31 sub-streams, only 03AA-04 corroborated, the rest provisional', () => {
  const subs = A.STREAMS.slice(1).flatMap(s => s.sub);
  assert.equal(subs.length, 31);
  const c = subs.filter(x => x.status === 'corroborated');
  assert.equal(c.length, 1);
  assert.equal(c[0].code, '03AA-04');
  assert.equal(c[0].label, 'Intelligence Automation Agents');
  assert.ok(subs.filter(x => x.status !== 'corroborated').every(x => x.status === 'provisional'));
  assert.equal(A.STREAMS.find(s => s.id === '03').name_status, 'corroborated');
});

/* Priority 3: cost controls */
test('controls: no allowance is configured for any agent and nothing is authorised by default', () => {
  for (const a of A.REGISTER) {
    const st = A.allowanceStatus(a);
    assert.equal(st.configured, false, a.name);
    assert.equal(st.state, 'not_configured', a.name);
  }
  assert.deepEqual(A.registerIssues(), []);
});
test('controls: allowance values without approval are not treated as configured', () => {
  withAllowance(MASTER, { per_task: 0.05, daily: 0.2, monthly: 2 }, a => assert.equal(A.allowanceStatus(a).state, 'unapproved'));
  withAllowance(MASTER, { per_task: 0.05, daily: null, monthly: 2, approved_by: 'Owner', approved_at: 'x', approval_reference: 'y' }, a => assert.equal(A.allowanceStatus(a).state, 'invalid'));
  withAllowance(MASTER, { per_task: -1, daily: 1, monthly: 2, approved_by: 'Owner', approved_at: 'x', approval_reference: 'y' }, a => assert.equal(A.allowanceStatus(a).state, 'invalid'));
  withAllowance(MASTER, { per_task: 0.05, daily: 0.2, monthly: 2 }, () => assert.equal(A.registerIssues().length, 1));
  withAllowance(MASTER, APPROVED, a => assert.equal(A.allowanceStatus(a).configured, true));
});
test('controls: paid execution without allowance is a retained violation', () => {
  const ev = one({ agent_id: MASTER, status: 'working', timestamp: ago(1), dry_run: false, model_tier: 'haiku', cost_eur: 0.004 });
  assert.ok(codes(ev).includes('NO_ALLOWANCE_CONFIGURED'));
  const dry = one({ agent_id: MASTER, status: 'working', timestamp: ago(1), dry_run: true, model_tier: 'haiku', cost_eur: 0 });
  assert.ok(!codes(dry).includes('NO_ALLOWANCE_CONFIGURED'));
});
test('controls: within an approved allowance live runs are informational; per-task excess is a violation', () => {
  withAllowance(MASTER, APPROVED, () => {
    const ok = one({ agent_id: MASTER, status: 'working', timestamp: ago(1), dry_run: false, model_tier: 'haiku', cost_eur: 0.01 });
    assert.ok(codes(ok).includes('LIVE_WITHIN_ALLOWANCE'));
    assert.ok(!ok.flags.some(f => f.severity === 'violation'));
    const big = one({ agent_id: MASTER, status: 'working', timestamp: ago(1), dry_run: false, model_tier: 'haiku', cost_eur: 0.06 });
    assert.ok(codes(big).includes('ALLOWANCE_PER_TASK_EXCEEDED'));
  });
});
test('controls: daily and monthly allowance breaches are detected from reported API cost only', () => {
  withAllowance(MASTER, APPROVED, a => {
    const s = A.createStore();
    const evs = [];
    for (let i = 0; i < 5; i++) evs.push({ agent_id: MASTER, status: 'idle', timestamp: ago(10 + i), event_id: 'd' + i, dry_run: false, model_tier: 'haiku', cost_eur: 0.05 });
    evs.push({ agent_id: MASTER, status: 'idle', timestamp: ago(20), event_id: 'sub', dry_run: false, model_tier: 'haiku', cost_eur: 5, cost_basis: 'subscription' });
    A.ingestReport(s, { version: '1.1', events: evs }, NOW);
    const u = A.allowanceUsage(s, a, NOW);
    assert.equal(u.todayEur, 0.25);
    assert.deepEqual(u.breaches.map(b => b.kind), ['daily']);
    const sum = A.summarise(s, NOW);
    assert.equal(sum.allowances.find(x => x.agent.code === MASTER).usage.breaches.length, 1);
  });
});
test('controls: model permissions are enforced per agent', () => {
  const pc = one({ agent_id: PC, status: 'working', timestamp: ago(1), dry_run: true, model_tier: 'haiku' });
  assert.ok(codes(pc).includes('MODEL_NOT_PERMITTED'));
  const pcCode = one({ agent_id: PC, status: 'working', timestamp: ago(1), dry_run: true, model_tier: 'code' });
  assert.ok(!codes(pcCode).includes('MODEL_NOT_PERMITTED'));
  assert.equal(A.modelPermission(agent(MASTER), 'opus'), 'approval_required');
  assert.equal(A.modelPermission(agent(MASTER), 'sonnet'), 'escalation_with_reason');
});
test('controls: Opus approval references are checked against recorded approvals, never auto-approved', () => {
  const ev = one({ agent_id: MASTER, status: 'working', timestamp: ago(1), dry_run: true, model_tier: 'opus', approval_reference: '03AA-04-haiku-eval-2026-10-21' });
  const f = ev.flags.find(x => x.code === 'OPUS_REVIEW');
  assert.equal(f.severity, 'review');
  assert.match(f.message, /not found in recorded approvals/);
  A.APPROVALS.push({ id: 'TEST-OPUS-1', agent_code: MASTER, model_tier: 'opus', cap_eur: 1, approved_by: 'Owner', approved_at: '2026-10-23', scope: 'test', status: 'active', source: 'test' });
  try {
    const ok = one({ agent_id: MASTER, status: 'working', timestamp: ago(1), dry_run: true, model_tier: 'opus', approval_reference: 'TEST-OPUS-1' });
    const g = ok.flags.find(x => x.code === 'OPUS_REVIEW');
    assert.equal(g.severity, 'review');
    assert.match(g.message, /matches a recorded approval/);
  } finally { A.APPROVALS.pop(); }
});
/* ACC-R009 */
test('R009: a live run using ordinary code only is not paid execution', () => {
  for (const code of [BUILDER, PC]) {
    const ev = one({ agent_id: code, status: 'idle', timestamp: ago(1), dry_run: false, model_tier: 'code', cost_eur: 0 });
    assert.ok(!codes(ev).includes('NO_ALLOWANCE_CONFIGURED'), code);
  }
  const haiku = one({ agent_id: MASTER, status: 'idle', timestamp: ago(1), dry_run: false, model_tier: 'haiku' });
  assert.ok(codes(haiku).includes('NO_ALLOWANCE_CONFIGURED'));
  const untiered = one({ agent_id: MASTER, status: 'idle', timestamp: ago(1), dry_run: false });
  assert.ok(codes(untiered).includes('NO_ALLOWANCE_CONFIGURED'), 'unknown tier on a live run is treated as paid');
});
test('R009: a USD spend estimate without conversion is flagged and counts as paid, not as EUR', () => {
  const ev = one({ agent_id: MASTER, status: 'idle', timestamp: ago(1), dry_run: false, model_tier: 'haiku', cost_usd_estimated: 0.0039 });
  assert.ok(codes(ev).includes('COST_NOT_CONVERTED'));
  assert.ok(codes(ev).includes('NO_ALLOWANCE_CONFIGURED'));
  assert.equal(ev.cost_eur, null);
  assert.equal(ev.cost_usd_estimated, 0.0039);
});
test('R009: run reference is kept and clipped', () => {
  const ev = one({ agent_id: PC, status: 'idle', timestamp: ago(1), dry_run: true, model_tier: 'code', run_ref: 'gh-run-1-1' + 'x'.repeat(200) });
  assert.equal(ev.run_ref.length, 80);
});