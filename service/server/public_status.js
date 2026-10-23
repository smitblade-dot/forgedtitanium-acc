/* FORGEDTITANIUM ACC-R014 restricted public status.
   Turns the private event store into the only data the public Command Centre may see: for each registered
   agent, a derived state, the time of its last report and a short history of status changes. Nothing else.

   NOT included, by construction (allowlist, not blocklist): task names, run references, event ids, key ids,
   costs, model tiers, approval requests, escalation reasons, flags, error text, delivery attempts, anything an
   agent wrote as free text. Every document is checked by assertPublicSafe() before it is served or written, so a
   future field added to the private store cannot reach the public view without a deliberate change here.

   States (what the public sees):
     active              the agent's latest report in the last 24 hours is "working" and is recent
     idle                latest report is "idle"
     failed              latest report is "failed"
     disconnected        latest report is "offline"
     awaiting_approval   latest report is "awaiting_approval"
     unknown             no report in 24 hours, no report ever, or a "working" start with no completion for
                         WORKING_TIMEOUT_MS (a start is not proof the agent is still running)
   Provisional agents (no verified code) can never report and are always unknown. */
'use strict';
const ACC = require('../acc_core.js');

const SCHEMA = 'acc-public-status/1';
const WINDOW_MS = ACC.STALE_AFTER_MS;                 // 24 h: older reports are not current status
const WORKING_TIMEOUT_MS = 2 * 60 * 60 * 1000;        // a "working" start unresolved for 2 h is Unknown
const HISTORY_MAX = 10;
const STATES = ['active', 'idle', 'failed', 'disconnected', 'awaiting_approval', 'unknown'];
const STATUS_TO_STATE = { working: 'active', idle: 'idle', failed: 'failed', offline: 'disconnected', awaiting_approval: 'awaiting_approval', unknown: 'unknown' };
const REASONS = ['reported', 'no_report', 'stale', 'no_completion', 'provisional'];
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function iso(ms) { return new Date(ms).toISOString(); }

/* Build the public document from validated rows of the private events table
   ({schema_version, raw_json, key_id, received_at_utc}). */
function buildPublicStatus(rows, nowMs) {
  const store = ACC.createStore();
  for (const r of rows) {
    try {
      ACC.ingestReport(store, { version: r.schema_version, events: [JSON.parse(r.raw_json)] }, nowMs, 'acc-server',
        { authenticated: true, key_id: r.key_id, received_at_utc: r.received_at_utc });
    } catch { /* a row that no longer validates is not shown */ }
  }
  const agents = ACC.REGISTER.map(a => {
    const base = { agent_id: a.code || null, name: a.name, verification: a.verification === 'verified' ? 'verified' : 'provisional' };
    if (!a.code) return Object.assign(base, { state: 'unknown', state_reason: 'provisional', as_of_utc: null, last_report_utc: null, reports_24h: 0, history: [] });
    const evs = ACC.eventsFor(store, a);                       // newest first
    const latest = evs[0] || null;
    let state = 'unknown', reason = 'no_report', asOf = null;
    if (latest) {
      asOf = latest.timestamp_utc;
      if (nowMs - latest.ms > WINDOW_MS) { state = 'unknown'; reason = 'stale'; }
      else if (latest.status === 'working' && nowMs - latest.ms > WORKING_TIMEOUT_MS) { state = 'unknown'; reason = 'no_completion'; }
      else { state = STATUS_TO_STATE[latest.status]; reason = 'reported'; }
    }
    const history = evs.slice(0, HISTORY_MAX).map(e => ({
      at_utc: e.timestamp_utc,
      state: STATUS_TO_STATE[e.status],
      mode: e.dry_run === true ? 'dry_run' : e.dry_run === false ? 'live' : null,
      delivered_late: !!(e.flags && e.flags.some(f => f.code === 'DELIVERED_LATE'))
    }));
    return Object.assign(base, { state, state_reason: reason, as_of_utc: asOf, last_report_utc: latest ? latest.timestamp_utc : null,
      reports_24h: evs.filter(e => nowMs - e.ms <= WINDOW_MS).length, history });
  });
  const doc = { schema: SCHEMA, generated_at_utc: iso(nowMs), window_hours: WINDOW_MS / 3600000, working_timeout_minutes: WORKING_TIMEOUT_MS / 60000, agents };
  return assertPublicSafe(doc);
}

/* Strict allowlist check. Throws on any unexpected key, type, value or free text. */
function assertPublicSafe(doc) {
  const fail = m => { throw new Error('public status not safe: ' + m); };
  const keys = (o, allowed, where) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) fail(where + ' must be an object');
    for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(where + ' has unexpected field "' + k + '"');
    for (const k of allowed) if (!(k in o)) fail(where + ' is missing "' + k + '"');
  };
  keys(doc, ['schema', 'generated_at_utc', 'window_hours', 'working_timeout_minutes', 'agents'], 'document');
  if (doc.schema !== SCHEMA) fail('schema');
  if (!TS_RE.test(doc.generated_at_utc)) fail('generated_at_utc');
  if (!Number.isInteger(doc.window_hours) || !Number.isInteger(doc.working_timeout_minutes)) fail('window numbers');
  if (!Array.isArray(doc.agents) || doc.agents.length > 50) fail('agents');
  for (const a of doc.agents) {
    keys(a, ['agent_id', 'name', 'verification', 'state', 'state_reason', 'as_of_utc', 'last_report_utc', 'reports_24h', 'history'], 'agent');
    if (a.agent_id !== null && !/^03AA-[0-9]{2}_[A-Za-z0-9_]{1,80}$/.test(a.agent_id)) fail('agent_id');
    if (typeof a.name !== 'string' || a.name.length > 80 || /[<>]/.test(a.name)) fail('name');
    if (!['verified', 'provisional'].includes(a.verification)) fail('verification');
    if (!STATES.includes(a.state)) fail('state');
    if (!REASONS.includes(a.state_reason)) fail('state_reason');
    for (const k of ['as_of_utc', 'last_report_utc']) if (a[k] !== null && !TS_RE.test(a[k])) fail(k);
    if (!Number.isInteger(a.reports_24h) || a.reports_24h < 0 || a.reports_24h > 100000) fail('reports_24h');
    if (!Array.isArray(a.history) || a.history.length > HISTORY_MAX) fail('history');
    for (const h of a.history) {
      keys(h, ['at_utc', 'state', 'mode', 'delivered_late'], 'history entry');
      if (!TS_RE.test(h.at_utc) || !STATES.includes(h.state) || ![null, 'dry_run', 'live'].includes(h.mode) || typeof h.delivered_late !== 'boolean') fail('history entry values');
    }
  }
  return doc;
}

module.exports = { SCHEMA, STATES, REASONS, WINDOW_MS, WORKING_TIMEOUT_MS, HISTORY_MAX, buildPublicStatus, assertPublicSafe };
