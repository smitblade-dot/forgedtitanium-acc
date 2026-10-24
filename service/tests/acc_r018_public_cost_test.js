'use strict';
/* ACC-R018 tests: the proposed public cost projection. Synthetic events only; nothing leaves the machine. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const S = require('../server/acc_server.js');
const C = require('../server/public_cost.js');

const MASTER = '03AA-04_Master_Agent_TI_Ops_Director';
const BUILDER = '03AA-04_Country_Intelligence_Builder_TI';
const CONTROLLER = '03AA-04_Production_Controller_TI';
const NOW = Date.parse('2026-10-24T12:00:00Z');                     // 15:00 EEST on 24 Oct 2026
const ago = min => new Date(NOW - min * 60000).toISOString();
const SECRETS = ['SECRET-TASK-NAME', 'run-ref-9999', 'sk-secret-escalation', 'CONFIDENTIAL-REFERENCE', 'event-id-abc123', 'key_x', 'per_task', 'approved_by'];
function row(agent, status, minutesAgo, extra) {
  const raw = Object.assign({ agent_id: agent, status, timestamp: ago(minutesAgo), event_id: 'event-id-abc123-' + agent + minutesAgo, task: 'SECRET-TASK-NAME', run_ref: 'run-ref-9999',
    dry_run: false, approval_reference: 'CONFIDENTIAL-REFERENCE', escalation_reason: 'sk-secret-escalation' }, extra || {});
  return { schema_version: '1.1', raw_json: JSON.stringify(raw), key_id: 'key_x', received_at_utc: ago(minutesAgo) };
}
const priced = (eur, tier, basis) => ({ cost_eur: eur, model_tier: tier || 'haiku', cost_basis: basis || 'api' });
const agentOf = (doc, code) => doc.by_agent.find(a => a.agent_id === code);
const tierOf = (doc, t) => doc.by_model_tier.find(x => x.tier === t);

test('no cost data is never turned into zero: an empty store has no amounts at all', () => {
  const d = C.buildPublicCost([], NOW);
  for (const sc of [d.today, d.month, ...d.by_agent.flatMap(a => [a.today, a.month]), ...d.by_model_tier.flatMap(t => [t.today, t.month])]) {
    assert.equal(sc.api.state, 'no_cost_data'); assert.equal(sc.api.amount_eur, null);
    assert.equal(sc.subscription.amount_eur, null); assert.equal(sc.original_currency.amount, null);
  }
});

test('activity without a reported cost is not costed: start reports and completions that omit cost give no figure', () => {
  const d = C.buildPublicCost([row(MASTER, 'working', 20), row(MASTER, 'idle', 19), row(CONTROLLER, 'idle', 30)], NOW);
  assert.equal(d.today.api.state, 'no_cost_data');
  assert.equal(d.today.api.completion_reports, 2, 'the two completions are counted as reports that could carry a cost; the start report is not');
  assert.equal(d.today.api.costed_reports, 0);
});

test('an explicitly reported zero is recorded as a zero, with its coverage', () => {
  const d = C.buildPublicCost([row(MASTER, 'working', 20), row(MASTER, 'idle', 19, priced(0, 'code')), row(CONTROLLER, 'idle', 30, priced(0, 'code')), row(BUILDER, 'idle', 40)], NOW);
  assert.deepEqual([d.today.api.state, d.today.api.amount_eur, d.today.api.costed_reports, d.today.api.completion_reports], ['recorded', 0, 2, 3]);
  assert.equal(agentOf(d, BUILDER).today.api.state, 'no_cost_data', 'an agent with no costed report stays No cost data');
  assert.equal(tierOf(d, 'code').today.api.amount_eur, 0);
  assert.equal(tierOf(d, 'haiku').today.api.state, 'no_cost_data');
});

test('amounts are summed by period, agent and model tier; subscription is kept apart from API', () => {
  const d = C.buildPublicCost([
    row(MASTER, 'idle', 60, priced(0.0123, 'haiku')), row(MASTER, 'idle', 30, priced(0.0077, 'haiku')),
    row(BUILDER, 'idle', 45, priced(0.4, 'sonnet')), row(CONTROLLER, 'idle', 50, priced(12, 'opus', 'subscription'))], NOW);
  assert.equal(d.today.api.amount_eur, 0.42);
  assert.equal(agentOf(d, MASTER).today.api.amount_eur, 0.02);
  assert.equal(tierOf(d, 'haiku').today.api.amount_eur, 0.02);
  assert.equal(tierOf(d, 'sonnet').today.api.amount_eur, 0.4);
  assert.equal(d.today.subscription.amount_eur, 12, 'subscription usage is reported on its own');
  assert.equal(d.today.api.amount_eur, 0.42, 'and is not added to API cost');
  assert.equal(agentOf(d, CONTROLLER).today.api.state, 'no_cost_data');
});

test('today and month follow the Europe/Nicosia calendar, not UTC', () => {
  const nowLate = Date.parse('2026-10-24T09:00:00Z');
  const at = iso => ({ schema_version: '1.1', key_id: 'k', received_at_utc: iso, raw_json: JSON.stringify({ agent_id: MASTER, status: 'idle', timestamp: iso, event_id: 'e' + iso, dry_run: false, ...priced(1, 'haiku') }) });
  const d = C.buildPublicCost([at('2026-10-23T20:59:00.000Z'), at('2026-10-23T21:01:00.000Z'), at('2026-09-30T20:59:00.000Z'), at('2026-09-30T21:01:00.000Z')], nowLate);
  assert.equal(d.today.date, '2026-10-24');
  assert.equal(d.today.api.amount_eur, 1, '21:01Z on the 23rd is already 24 Oct in Cyprus (00:01 EEST); 20:59Z is still the 23rd');
  assert.equal(d.month.month, '2026-10');
  assert.equal(d.month.api.amount_eur, 3, '23 Oct 23:59, 24 Oct 00:01 and 1 Oct 00:01 (21:01Z on 30 Sep) count for October; 30 Sep 23:59 EEST does not');
});

test('original currency is shown where evidence exists and is never converted', () => {
  const d = C.buildPublicCost([row(MASTER, 'idle', 30, { cost_usd_estimated: 0.0123 }), row(MASTER, 'idle', 20, { cost_usd_estimated: 0.01 })], NOW);
  assert.deepEqual(d.today.original_currency, { state: 'recorded', currency: 'USD', amount: 0.0223, reports: 2, converted: false });
  assert.equal(d.today.api.state, 'no_cost_data', 'a USD estimate alone is not an EUR figure');
});

test('only verified registered agents are counted', () => {
  const d = C.buildPublicCost([row('ti-osint-discovery', 'idle', 10, priced(5)), row('sqe', 'idle', 10, priced(5))], NOW);
  assert.equal(d.today.api.state, 'no_cost_data');
  assert.equal(d.by_agent.length, 3);
});

test('nothing confidential is in the projection', () => {
  const d = C.buildPublicCost([row(MASTER, 'idle', 30, priced(0.5, 'sonnet')), row(MASTER, 'awaiting_approval', 20, { approval_request: { summary: 'CONFIDENTIAL-REFERENCE' }, ...priced(0.1) })], NOW);
  const text = JSON.stringify(d);
  for (const s of SECRETS) assert.equal(text.includes(s), false, 'must not contain ' + s);
  assert.doesNotMatch(text, /allowance|approval|run_ref|task|escalation|key_id|limit/i);
});

test('assertPublicCostSafe refuses anything outside the allowlist', () => {
  const good = () => JSON.parse(JSON.stringify(C.buildPublicCost([row(MASTER, 'idle', 30, priced(0.5, 'sonnet'))], NOW)));
  C.assertPublicCostSafe(good());
  const bad = [
    d => { d.allowance_eur = 5; }, d => { d.today.api.amount_eur = '0.5'; }, d => { d.today.api.amount_eur = -1; }, d => { d.today.api.state = 'no_cost_data'; },
    d => { d.by_agent[0].task = 'x'; }, d => { d.evidence.provider_confirmed = true; }, d => { d.today.original_currency.converted = true; }, d => { d.currency = 'USD'; },
    d => { d.by_model_tier[0].tier = 'gpt'; }, d => { d.by_agent[0].agent_id = 'evil<script>'; }, d => { d.today.date = 'today'; }, d => { d.today.api.amount_eur = null; }
  ];
  for (const fn of bad) { const d = good(); fn(d); assert.throws(() => C.assertPublicCostSafe(d), /not safe/); }
});

test('the server serves the cost projection only when it is switched on, with the same exposure rules as the status document', async () => {
  const get = (port, p, origin) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p, headers: origin ? { origin } : {} }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: b })); }).on('error', rej));
  for (const on of [false, true]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc18-'));
    const srv = S.createAccServer({ dataDir: dir, now: () => NOW, publicStatus: true, publicCost: on, publicOrigin: 'https://smitblade-dot.github.io', trustProxy: false });
    const a = await srv.listenIngest(0, '127.0.0.1');
    const r = await get(a.port, '/public/cost.json', 'https://smitblade-dot.github.io');
    assert.equal(r.status, on ? 200 : 404, 'switched ' + (on ? 'on' : 'off'));
    if (on) {
      const doc = JSON.parse(r.body); C.assertPublicCostSafe(doc);
      assert.equal(r.headers['access-control-allow-origin'], 'https://smitblade-dot.github.io');
      assert.equal(doc.today.api.state, 'no_cost_data');
    }
    assert.equal((await get(a.port, '/v1/summary')).status, 404, 'private paths stay closed');
    await srv.close();
  }
});
