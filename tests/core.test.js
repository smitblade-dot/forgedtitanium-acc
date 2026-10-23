'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../site/acc_core.js');

const NOW = Date.parse('2026-10-22T16:42:00Z'); // 19:42 EEST, 22 Oct 2026
const MASTER = '03AA-04_Master_Agent_TI_Ops_Director';
const iso = ms => new Date(ms).toISOString();
const ago = min => iso(NOW - min * 60000);
const codes = ev => ev.flags.map(f => f.code);
function ingest(events, version = '1.1', store = A.createStore(), now = NOW) {
  const r = A.ingestReport(store, { version, events }, now, 'test.json');
  return { store, r };
}
function one(raw, version = '1.1') {
  const { store, r } = ingest([raw], version);
  return { store, r, ev: store.events[0], rej: store.rejected[0] };
}
const base = (o = {}) => Object.assign({ agent_id: MASTER, status: 'working', timestamp: ago(5), dry_run: true, model_tier: 'haiku' }, o);

/* 1. Unknown status */
test('unknown: no reports means every agent is unknown and no figures are produced', () => {
  const store = A.createStore();
  const s = A.summarise(store, NOW);
  assert.equal(s.hasData, false);
  assert.equal(s.reportingCount, 0);
  assert.equal(s.cost.hasApi, false);
  for (const a of A.REGISTER) assert.equal(A.currentEvent(store, a, NOW), null);
});
test('unknown: an explicit "unknown" status is retained and shown as reported unknown', () => {
  const { ev, store } = one(base({ status: 'unknown' }));
  assert.equal(ev.status, 'unknown');
  assert.equal(A.currentEvent(store, A.REGISTER[0], NOW).status, 'unknown');
});
test('unknown: an unrecognised status value is rejected, not coerced', () => {
  const { rej, r } = one(base({ status: 'running' }));
  assert.equal(r.rejected, 1);
  assert.equal(rej.code, 'STATUS_INVALID');
});

/* 2. Missing data */
test('missing: v1.1 record without dry_run or model_tier is retained and flagged', () => {
  const { ev } = one({ agent_id: MASTER, status: 'idle', timestamp: ago(1) });
  assert.ok(codes(ev).includes('DRY_RUN_MISSING'));
  assert.ok(codes(ev).includes('MODEL_TIER_MISSING'));
  assert.equal(ev.dry_run, null);
  assert.equal(ev.model_tier, null);
  assert.equal(ev.cost_eur, null);
});
test('missing: v1.0 records are accepted and marked as pre-v1.1, without v1.1 data flags', () => {
  const { ev } = one({ agent_id: MASTER, status: 'idle', timestamp: ago(1) }, '1.0');
  assert.ok(codes(ev).includes('PRE_V1_1'));
  assert.ok(!codes(ev).includes('DRY_RUN_MISSING'));
});
test('missing: records without agent_id or timestamp cannot be attributed and are rejected with reasons', () => {
  const { store } = ingest([{ status: 'idle', timestamp: ago(1) }, { agent_id: MASTER, status: 'idle' }, { agent_id: MASTER, status: 'idle', timestamp: '2026-10-22T16:00:00' }, 'junk']);
  assert.deepEqual(store.rejected.map(r => r.code), ['AGENT_ID_MISSING', 'TIMESTAMP_MISSING', 'TIMESTAMP_FORMAT', 'NOT_AN_OBJECT']);
  assert.equal(store.events.length, 0);
});
test('missing: report without version or events array is refused as a whole', () => {
  const s = A.createStore();
  assert.throws(() => A.ingestReport(s, { events: [] }, NOW), /version/);
  assert.throws(() => A.ingestReport(s, { version: '2.0', events: [] }, NOW), /version/);
  assert.throws(() => A.ingestReport(s, { version: '1.1' }, NOW), /events array/);
  assert.throws(() => A.ingestReport(s, [], NOW), /object/);
});
test('missing: one bad record does not discard the valid records in the same report', () => {
  const { store, r } = ingest([base(), { agent_id: 'nope', status: 'idle', timestamp: ago(1) }, base({ agent_id: 'sqe', status: 'idle' })]);
  assert.equal(r.accepted, 2);
  assert.equal(r.rejected, 1);
  assert.equal(store.events.length, 2);
});

/* 3. Agent identifiers */
test('ids: verified code resolves with no identifier flag', () => {
  const { ev } = one(base());
  assert.equal(ev.id_match, 'verified');
  assert.equal(ev.agent_key, MASTER);
  assert.ok(!ev.flags.some(f => f.severity === 'identifier'));
});
test('ids: superseded interim id for the Master Agent maps to the verified code and is flagged', () => {
  const { ev } = one(base({ agent_id: 'ti-director' }));
  assert.equal(ev.id_match, 'superseded');
  assert.equal(ev.agent_key, MASTER);
  assert.ok(codes(ev).includes('ID_SUPERSEDED'));
});
test('ids: agents without a verified code resolve on their R006 interim id and are flagged for reconciliation', () => {
  for (const a of A.REGISTER.filter(a => !a.code)) {
    const { ev } = one(base({ agent_id: a.interim_id }));
    assert.equal(ev.id_match, 'unverified', a.name);
    assert.ok(codes(ev).includes('ID_UNVERIFIED'));
  }
});
test('ids: invalid, near-miss and artwork-only identifiers are rejected (no fuzzy matching)', () => {
  for (const bad of ['TI-DIRECTOR', '03AA-04_Master_Agent', '03aa-04_master_agent_ti_ops_director', 'forge-agent', 'Finance Agent', ' sqe', 42]) {
    const { rej } = one(base({ agent_id: bad }));
    assert.ok(rej, String(bad));
    assert.ok(['AGENT_ID_UNKNOWN', 'AGENT_ID_MISSING'].includes(rej.code), String(bad));
  }
});
test('ids: register names are unchanged from R006 and only evidenced codes are recorded', () => {
  assert.deepEqual(A.REGISTER.map(a => a.name), ['TI Operations Director (Master Agent)', 'Country Intelligence Builder', 'Global OSINT Discovery Agent', 'Intelligence Analyst & Publisher', 'Production Controller TI', 'Agent SQE', 'Project Quality Agent (PQA)', 'Venture Engine Agent']);
  assert.deepEqual(A.REGISTER.filter(a => a.code).map(a => a.code), [MASTER, '03AA-04_Country_Intelligence_Builder_TI', '03AA-04_Production_Controller_TI']);
  for (const a of A.REGISTER) assert.equal(!!a.code, a.verification === 'verified', a.name);
});

/* 4. Dry runs */
test('dry run: dry run with no cost carries no review flags', () => {
  const { ev } = one(base({ cost_eur: 0 }));
  assert.equal(ev.dry_run, true);
  assert.ok(!ev.flags.some(f => f.severity === 'review' || f.severity === 'violation'));
});
test('dry run: dry run reporting API cost is flagged for review', () => {
  const { ev } = one(base({ cost_eur: 0.12 }));
  assert.ok(codes(ev).includes('DRY_RUN_WITH_COST'));
});
test('dry run: subscription usage on a dry run is not treated as paid API spend', () => {
  const { ev } = one(base({ cost_eur: 0.5, cost_basis: 'subscription' }));
  assert.ok(!codes(ev).includes('DRY_RUN_WITH_COST'));
});
test('dry run: non-dry-run execution without an approved allowance is retained as a violation', () => {
  const { ev, r } = one(base({ dry_run: false, cost_eur: 0.3 }));
  assert.equal(r.accepted, 1);
  assert.ok(codes(ev).includes('NO_ALLOWANCE_CONFIGURED'));
  assert.equal(ev.flags.find(f => f.code === 'NO_ALLOWANCE_CONFIGURED').severity, 'violation');
});
test('dry run: non-boolean dry_run is a data flag and mode is left unknown', () => {
  const { ev } = one(base({ dry_run: 'yes' }));
  assert.equal(ev.dry_run, null);
  assert.ok(codes(ev).includes('DRY_RUN_INVALID'));
});
test('dry run: performance counts dry and live runs separately', () => {
  const { store } = ingest([base({ timestamp: ago(3) }), base({ dry_run: false, timestamp: ago(2) }), base({ dry_run: undefined, timestamp: ago(1) })]);
  const p = A.agentPerformance(store, A.REGISTER[0]);
  assert.equal(p.dryRuns, 1);
  assert.equal(p.liveRuns, 1);
  assert.equal(p.total, 3);
});

/* 5. Model escalation */
test('routing: code and haiku need no escalation', () => {
  for (const t of ['code', 'haiku']) assert.ok(!one(base({ model_tier: t })).ev.flags.some(f => f.severity === 'violation' || f.severity === 'review'));
});
test('routing: sonnet without a reason is a violation but the record is kept', () => {
  const { ev, r, store } = one(base({ model_tier: 'sonnet' }));
  assert.equal(r.accepted, 1);
  assert.equal(r.rejected, 0);
  assert.ok(codes(ev).includes('ROUTING_SONNET_NO_REASON'));
  assert.equal(A.summarise(store, NOW).violations, 1);
});
test('routing: whitespace-only escalation reason does not count', () => {
  assert.ok(codes(one(base({ model_tier: 'sonnet', escalation_reason: '   ' })).ev).includes('ROUTING_SONNET_NO_REASON'));
});
test('routing: sonnet with a recorded reason passes', () => {
  const { ev } = one(base({ model_tier: 'sonnet', escalation_reason: 'Haiku failed structured extraction twice' }));
  assert.ok(!codes(ev).includes('ROUTING_SONNET_NO_REASON'));
  assert.equal(ev.escalation_reason, 'Haiku failed structured extraction twice');
});
test('routing: every Opus execution is flagged for review, not as a violation and not rejected', () => {
  const approved = one(base({ model_tier: 'opus', escalation_reason: 'Defined task', approval_reference: 'MARC-OPUS-001' })).ev;
  const bare = one(base({ model_tier: 'opus' })).ev;
  for (const ev of [approved, bare]) {
    assert.ok(codes(ev).includes('OPUS_REVIEW'));
    assert.ok(!ev.flags.some(f => f.severity === 'violation'));
  }
  assert.match(approved.flags.find(f => f.code === 'OPUS_REVIEW').message, /MARC-OPUS-001/);
  assert.match(bare.flags.find(f => f.code === 'OPUS_REVIEW').message, /No approval reference/);
});
test('routing: unrecognised model tier is a data flag, record retained', () => {
  const { ev } = one(base({ model_tier: 'gpt-5' }));
  assert.equal(ev.model_tier, null);
  assert.ok(codes(ev).includes('MODEL_TIER_INVALID'));
});

/* 6. Cost reporting */
test('cost: today\u2019s API cost sums only valid API costs for the Nicosia calendar day', () => {
  const { store } = ingest([
    base({ cost_eur: 0.12, timestamp: ago(10) }),
    base({ agent_id: 'sqe', cost_eur: 0.3, timestamp: ago(20) }),
    base({ agent_id: 'pqa', cost_eur: 2, cost_basis: 'subscription', timestamp: ago(30) }),
    base({ agent_id: 'pqa', cost_eur: -1, timestamp: ago(31) }),
    base({ agent_id: 'pqa', cost_eur: '0.50', timestamp: ago(32) }),
    base({ agent_id: 'ti-country-builder', timestamp: ago(33) }),
    base({ agent_id: 'sqe', cost_eur: 5, timestamp: '2026-10-21T20:59:00Z' }) // 23:59 EEST on 21 Oct: yesterday
  ]);
  const s = A.summarise(store, NOW);
  assert.equal(s.cost.apiEur, 0.42);
  assert.equal(s.cost.subscriptionEur, 2);
  assert.equal(s.cost.eventsToday, 6);
  assert.equal(s.cost.costedToday, 3);
  const bad = store.events.filter(e => codes(e).includes('COST_INVALID'));
  assert.equal(bad.length, 2);
  assert.ok(bad.every(e => e.cost_eur === null));
});
test('cost: basis defaults to api and invalid basis is flagged', () => {
  assert.equal(one(base({ cost_eur: 0.1 })).ev.cost_basis, 'api');
  const ev = one(base({ cost_eur: 0.1, cost_basis: 'card' })).ev;
  assert.ok(codes(ev).includes('COST_BASIS_INVALID'));
  assert.equal(ev.cost_basis, 'api');
});
test('cost: no costed reports means no cost figure is produced', () => {
  const s = A.summarise(ingest([base()]).store, NOW);
  assert.equal(s.cost.hasApi, false);
});

/* 7. Approval requests */
test('approvals: awaiting_approval with request details is listed as pending', () => {
  const { store } = ingest([base({ status: 'awaiting_approval', approval_request: { summary: 'Publish Ghana country brief', reference: 'TI-PR-12' } })]);
  const s = A.summarise(store, NOW);
  assert.equal(s.approvals.length, 1);
  assert.equal(s.approvals[0].detail.summary, 'Publish Ghana country brief');
  assert.equal(s.approvals[0].detail.reference, 'TI-PR-12');
});
test('approvals: awaiting_approval without details is still pending and flagged', () => {
  const { store } = ingest([base({ status: 'awaiting_approval' })]);
  const s = A.summarise(store, NOW);
  assert.equal(s.approvals.length, 1);
  assert.equal(s.approvals[0].detail, null);
  assert.ok(codes(store.events[0]).includes('APPROVAL_DETAIL_MISSING'));
});
test('approvals: request with a non-awaiting status is flagged and not counted', () => {
  const { store } = ingest([base({ status: 'idle', approval_request: { summary: 'x' } })]);
  assert.equal(A.summarise(store, NOW).approvals.length, 0);
  assert.ok(codes(store.events[0]).includes('APPROVAL_STATUS_MISMATCH'));
});
test('approvals: malformed request is flagged', () => {
  assert.ok(codes(one(base({ status: 'awaiting_approval', approval_request: 'please' })).ev).includes('APPROVAL_REQUEST_INVALID'));
  assert.ok(codes(one(base({ status: 'awaiting_approval', approval_request: { summary: '' } })).ev).includes('APPROVAL_REQUEST_INVALID'));
});
test('approvals: a later report supersedes an earlier pending approval', () => {
  const { store } = ingest([base({ status: 'awaiting_approval', approval_request: { summary: 'x' }, timestamp: ago(10) }), base({ status: 'working', timestamp: ago(2) })]);
  assert.equal(A.summarise(store, NOW).approvals.length, 0);
});

/* 8. Timezone */
test('tz: summer is EEST (UTC+3), winter is EET (UTC+2)', () => {
  assert.equal(A.tzLabel(Date.parse('2026-07-01T12:00:00Z')), 'EEST');
  assert.equal(A.tzLabel(Date.parse('2026-12-01T12:00:00Z')), 'EET');
  assert.equal(A.formatNicosia(NOW, 'time'), '19:42 EEST');
});
test('tz: autumn change on 25 Oct 2026 at 01:00 UTC', () => {
  assert.equal(A.formatNicosia(Date.parse('2026-10-25T00:59:59Z'), 'full'), '25 Oct 2026, 03:59:59 EEST');
  assert.equal(A.formatNicosia(Date.parse('2026-10-25T01:00:00Z'), 'full'), '25 Oct 2026, 03:00:00 EET');
});
test('tz: repeated local hour at fall-back is disambiguated by label', () => {
  const a = A.formatNicosia(Date.parse('2026-10-25T00:30:00Z'), 'time');
  const b = A.formatNicosia(Date.parse('2026-10-25T01:30:00Z'), 'time');
  assert.equal(a, '03:30 EEST');
  assert.equal(b, '03:30 EET');
});
test('tz: spring change on 29 Mar 2026 at 01:00 UTC', () => {
  assert.equal(A.formatNicosia(Date.parse('2026-03-29T00:59:00Z'), 'time'), '02:59 EET');
  assert.equal(A.formatNicosia(Date.parse('2026-03-29T01:00:00Z'), 'time'), '04:00 EEST');
});
test('tz: calendar day follows Nicosia, not UTC', () => {
  assert.equal(A.nicosiaDateKey(Date.parse('2026-10-22T21:30:00Z')), '2026-10-23');
  assert.equal(A.nicosiaDateKey(Date.parse('2026-12-31T22:30:00Z')), '2027-01-01');
  assert.equal(A.nicosiaDateKey(Date.parse('2026-12-31T21:59:00Z')), '2026-12-31');
});
test('tz: offset timestamps are stored as UTC', () => {
  const { ev } = one(base({ timestamp: '2026-10-22T19:30:00+03:00' }));
  assert.equal(ev.timestamp_utc, '2026-10-22T16:30:00.000Z');
});
test('tz: cost "today" rolls over at Nicosia midnight across the DST change', () => {
  const now = Date.parse('2026-10-25T22:30:00Z'); // 00:30 EET on 26 Oct
  const { store } = ingest([
    base({ cost_eur: 1, timestamp: '2026-10-25T21:59:00Z' }), // 23:59 EET 25 Oct
    base({ agent_id: 'sqe', cost_eur: 2, timestamp: '2026-10-25T22:01:00Z' }) // 00:01 EET 26 Oct
  ], '1.1', A.createStore(), now);
  assert.equal(A.summarise(store, now).cost.apiEur, 2);
});

/* 9. Time window, staleness, duplicates, export */
test('time: reports older than 24 hours are kept in history but not used as current status', () => {
  const { ev, store } = one(base({ timestamp: ago(25 * 60) }));
  assert.ok(codes(ev).includes('STALE'));
  assert.equal(A.currentEvent(store, A.REGISTER[0], NOW), null);
  assert.equal(A.eventsFor(store, A.REGISTER[0]).length, 1);
});
test('time: a current status goes stale as the clock advances', () => {
  const { store } = ingest([base()]);
  assert.ok(A.currentEvent(store, A.REGISTER[0], NOW));
  assert.equal(A.currentEvent(store, A.REGISTER[0], NOW + 25 * 3600000), null);
});
test('time: more than 5 minutes in the future is rejected, within tolerance accepted', () => {
  assert.equal(one(base({ timestamp: iso(NOW + 6 * 60000) })).rej.code, 'TIMESTAMP_FUTURE');
  assert.equal(one(base({ timestamp: iso(NOW + 4 * 60000) })).r.accepted, 1);
});
test('duplicates are skipped by event_id or by content', () => {
  const e1 = base({ event_id: 'run-1' });
  const { store, r } = ingest([e1, Object.assign({}, e1, { task: 'changed' }), base({ timestamp: ago(9) }), base({ timestamp: ago(9) })]);
  assert.equal(r.accepted, 2);
  assert.equal(r.duplicates, 2);
  assert.equal(A.ingestReport(store, { version: '1.1', events: [e1] }, NOW).duplicates, 1);
});
test('latest report per agent wins regardless of order in file', () => {
  const { store } = ingest([base({ status: 'idle', timestamp: ago(1) }), base({ status: 'failed', timestamp: ago(30) })]);
  assert.equal(A.currentEvent(store, A.REGISTER[0], NOW).status, 'idle');
});
test('audit export retains flagged and rejected records', () => {
  const { store } = ingest([base({ model_tier: 'sonnet' }), { agent_id: 'x', status: 'idle', timestamp: ago(1) }]);
  const out = A.auditExport(store, NOW);
  assert.equal(out.events.length, 1);
  assert.equal(out.rejected.length, 1);
  assert.ok(out.events[0].flags.some(f => f.code === 'ROUTING_SONNET_NO_REASON'));
  assert.equal('ms' in out.events[0], false);
  assert.equal(out.display_time_zone, 'Europe/Nicosia');
});
test('long text fields are clipped', () => {
  const { ev } = one(base({ task: 'x'.repeat(500), escalation_reason: 'y'.repeat(900) }));
  assert.equal(ev.task.length, 160);
  assert.equal(ev.escalation_reason.length, 300);
});
test('ordering: for identical timestamps the later-received report is current', () => {
  const t = ago(1);
  const { store } = ingest([base({ status: 'working', timestamp: t, event_id: 's' }), base({ status: 'idle', timestamp: t, event_id: 'e' })]);
  assert.equal(A.currentEvent(store, A.REGISTER[0], NOW).status, 'idle');
});
