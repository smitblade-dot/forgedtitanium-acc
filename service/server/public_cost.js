/* FORGEDTITANIUM ACC-R018 proposed public cost projection (schema acc-public-cost/1).
   NOT ENABLED BY DEFAULT and not published: it is served only when ACC_PUBLIC_COST=1, which the owner must approve after reviewing
   the field list in docs/R018_PUBLIC_COST.md.

   What it counts: cost figures that an agent itself reported in an authenticated, validated execution record (cost_eur with its
   cost_basis, or a USD estimate). It never estimates spend from activity counts, never turns a missing figure into zero, and never
   adds subscription usage to API cost. Evidence is stated in the document: these are agent execution records, not provider invoices.

   NOT included, by construction (allowlist, not blocklist): spending allowances and limits, approval references and requests, task
   names, run references, event ids, key ids, model identifiers beyond the reported tier, flags, error text. Every document is checked by
   assertPublicCostSafe() before it is served or written. */
'use strict';
const ACC = require('../acc_core.js');

const SCHEMA = 'acc-public-cost/1';
const TIERS = ACC.MODEL_TIERS.slice();                    // code (no model call), haiku, sonnet, opus
const NOTE_EVIDENCE = 'Agent execution records, not provider invoices';
const NOTE_SUBSCRIPTION = 'Subscription usage is reported separately and is never added to API cost';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, MONTH_RE = /^\d{4}-\d{2}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const r4 = n => Math.round(n * 10000) / 10000;

function emptyAcc(){ return { completion: 0, apiN: 0, apiSum: 0, subN: 0, subSum: 0, usdN: 0, usdSum: 0 }; }
function add(a, e){
  if (e.status !== 'working') a.completion++;                    // a start report carries no cost by design; only completions are counted as reports that could carry one
  if (e.cost_eur !== null) { if (e.cost_basis === 'subscription') { a.subN++; a.subSum += e.cost_eur; } else { a.apiN++; a.apiSum += e.cost_eur; } }
  if (e.cost_usd_estimated !== null) { a.usdN++; a.usdSum += e.cost_usd_estimated; }
}
/* One scope (a period, optionally per agent or per tier). A figure exists only when at least one report carried it. */
function scopeOf(a){
  return {
    api: a.apiN ? { state: 'recorded', amount_eur: r4(a.apiSum), costed_reports: a.apiN, completion_reports: a.completion }
                : { state: 'no_cost_data', amount_eur: null, costed_reports: 0, completion_reports: a.completion },
    subscription: a.subN ? { state: 'recorded', amount_eur: r4(a.subSum), costed_reports: a.subN } : { state: 'no_cost_data', amount_eur: null, costed_reports: 0 },
    original_currency: a.usdN ? { state: 'recorded', currency: 'USD', amount: r4(a.usdSum), reports: a.usdN, converted: false } : { state: 'no_cost_data', currency: null, amount: null, reports: 0, converted: false }
  };
}

/* rows: validated rows of the private events table ({schema_version, raw_json, key_id, received_at_utc}). */
function buildPublicCost(rows, nowMs){
  const store = ACC.createStore();
  for (const r of rows) {
    try { ACC.ingestReport(store, { version: r.schema_version, events: [JSON.parse(r.raw_json)] }, nowMs, 'acc-server', { authenticated: true, key_id: r.key_id, received_at_utc: r.received_at_utc }); }
    catch { /* a row that no longer validates is not counted */ }
  }
  const today = ACC.nicosiaDateKey(nowMs), month = today.slice(0, 7);
  const verified = ACC.REGISTER.filter(a => a.code && a.verification === 'verified');
  const codes = new Set(verified.map(a => a.code));
  const mk = () => ({ t: emptyAcc(), m: emptyAcc() });
  const total = mk(), perAgent = new Map(verified.map(a => [a.code, mk()])), perTier = new Map(TIERS.map(t => [t, mk()]));
  for (const e of store.events) {
    if (!codes.has(e.agent_key)) continue;                                           // provisional agents cannot report; anything else is ignored
    const d = ACC.nicosiaDateKey(e.ms);
    const inMonth = d.slice(0, 7) === month, inToday = d === today;
    if (!inMonth) continue;
    const targets = [total, perAgent.get(e.agent_key)];
    if (e.cost_eur !== null && e.model_tier && perTier.has(e.model_tier)) targets.push(perTier.get(e.model_tier));
    for (const g of targets) { add(g.m, e); if (inToday) add(g.t, e); }
  }
  const doc = {
    schema: SCHEMA, generated_at_utc: new Date(nowMs).toISOString(), currency: 'EUR', time_zone: 'Europe/Nicosia',
    evidence: { kind: 'agent_execution_records', provider_confirmed: false, note: NOTE_EVIDENCE, subscription_note: NOTE_SUBSCRIPTION },
    today: Object.assign({ date: today }, scopeOf(total.t)),
    month: Object.assign({ month }, scopeOf(total.m)),
    by_agent: verified.map(a => ({ agent_id: a.code, name: a.name, today: scopeOf(perAgent.get(a.code).t), month: scopeOf(perAgent.get(a.code).m) })),
    by_model_tier: TIERS.map(t => ({ tier: t, today: scopeOf(perTier.get(t).t), month: scopeOf(perTier.get(t).m) }))
  };
  return assertPublicCostSafe(doc);
}

/* Strict allowlist check. Throws on any unexpected key, type or value. */
function assertPublicCostSafe(doc){
  const fail = m => { throw new Error('public cost not safe: ' + m); };
  const keys = (o, allowed, where) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) fail(where + ' must be an object');
    for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(where + ' has unexpected field "' + k + '"');
    for (const k of allowed) if (!(k in o)) fail(where + ' is missing "' + k + '"');
  };
  const amount = (v, where) => { if (v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e7)) fail(where + ' must be null or a non-negative number'); };
  const count = (v, where) => { if (!Number.isInteger(v) || v < 0 || v > 1e6) fail(where + ' must be a count'); };
  const scope = (s, where, extra) => {
    keys(s, (extra || []).concat(['api', 'subscription', 'original_currency']), where);
    keys(s.api, ['state', 'amount_eur', 'costed_reports', 'completion_reports'], where + '.api');
    if (!['recorded', 'no_cost_data'].includes(s.api.state)) fail(where + '.api.state');
    amount(s.api.amount_eur, where + '.api.amount_eur'); count(s.api.costed_reports, where); count(s.api.completion_reports, where);
    if ((s.api.state === 'recorded') !== (s.api.amount_eur !== null) || (s.api.state === 'recorded') !== (s.api.costed_reports > 0)) fail(where + '.api is inconsistent: a figure exists only with costed reports');
    keys(s.subscription, ['state', 'amount_eur', 'costed_reports'], where + '.subscription');
    if (!['recorded', 'no_cost_data'].includes(s.subscription.state)) fail(where + '.subscription.state');
    amount(s.subscription.amount_eur, where + '.subscription.amount_eur'); count(s.subscription.costed_reports, where);
    if ((s.subscription.state === 'recorded') !== (s.subscription.amount_eur !== null)) fail(where + '.subscription is inconsistent');
    keys(s.original_currency, ['state', 'currency', 'amount', 'reports', 'converted'], where + '.original_currency');
    if (!['recorded', 'no_cost_data'].includes(s.original_currency.state) || s.original_currency.converted !== false) fail(where + '.original_currency');
    if (s.original_currency.state === 'recorded' ? s.original_currency.currency !== 'USD' : s.original_currency.currency !== null) fail(where + '.original_currency.currency');
    amount(s.original_currency.amount, where + '.original_currency.amount'); count(s.original_currency.reports, where);
  };
  keys(doc, ['schema', 'generated_at_utc', 'currency', 'time_zone', 'evidence', 'today', 'month', 'by_agent', 'by_model_tier'], 'document');
  if (doc.schema !== SCHEMA || doc.currency !== 'EUR' || doc.time_zone !== 'Europe/Nicosia' || !TS_RE.test(doc.generated_at_utc)) fail('header');
  keys(doc.evidence, ['kind', 'provider_confirmed', 'note', 'subscription_note'], 'evidence');
  if (doc.evidence.kind !== 'agent_execution_records' || doc.evidence.provider_confirmed !== false || doc.evidence.note !== NOTE_EVIDENCE || doc.evidence.subscription_note !== NOTE_SUBSCRIPTION) fail('evidence');
  scope(doc.today, 'today', ['date']); if (!DATE_RE.test(doc.today.date)) fail('today.date');
  scope(doc.month, 'month', ['month']); if (!MONTH_RE.test(doc.month.month)) fail('month.month');
  if (!Array.isArray(doc.by_agent) || doc.by_agent.length > 50) fail('by_agent');
  for (const a of doc.by_agent) {
    keys(a, ['agent_id', 'name', 'today', 'month'], 'agent');
    if (!/^03AA-[0-9]{2}_[A-Za-z0-9_]{1,80}$/.test(a.agent_id)) fail('agent_id');
    if (typeof a.name !== 'string' || a.name.length > 80 || /[<>]/.test(a.name)) fail('agent name');
    scope(a.today, 'agent.today'); scope(a.month, 'agent.month');
  }
  if (!Array.isArray(doc.by_model_tier) || doc.by_model_tier.length !== TIERS.length) fail('by_model_tier');
  doc.by_model_tier.forEach((t, i) => { keys(t, ['tier', 'today', 'month'], 'tier'); if (t.tier !== TIERS[i]) fail('tier'); scope(t.today, 'tier.today'); scope(t.month, 'tier.month'); });
  return doc;
}

module.exports = { SCHEMA, TIERS, NOTE_EVIDENCE, NOTE_SUBSCRIPTION, buildPublicCost, assertPublicCostSafe };
