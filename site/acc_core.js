/* FORGEDTITANIUM ACC-R011 core logic.
   Register data, event schema v1.1 validation, routing-rule flags and
   Europe/Nicosia time handling. No network access, no invented data.
   Usable in the browser (window.ACC) and in Node (module.exports). */
(function (root) {
  'use strict';

  const RELEASE = 'ACC-R011';
  const TIME_ZONE = 'Europe/Nicosia';
  const SUPPORTED_VERSIONS = ['1.0', '1.1'];
  const STATUSES = ['working', 'idle', 'awaiting_approval', 'failed', 'offline', 'unknown'];
  const MODEL_TIERS = ['code', 'haiku', 'sonnet', 'opus'];
  const COST_BASES = ['api', 'subscription'];
  const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
  const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
  const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // reports older than this on receipt are expired
  const LATE_AFTER_MS = 10 * 60 * 1000;                // received this long after the event = delivered late
  const TASK_MAX = 160;
  const TEXT_MAX = 300;

  /* Register, streams, approvals and reconciliation come from acc_register.js. */
  const CONFIG = (typeof module !== 'undefined' && module.exports) ? require('./acc_register.js') : root.ACC_REGISTER;
  if (!CONFIG) throw new Error('acc_register.js must be loaded before acc_core.js');
  const STREAMS = CONFIG.STREAMS;
  const REGISTER = CONFIG.AGENTS;
  const APPROVALS = CONFIG.APPROVALS;
  const RECONCILIATION = CONFIG.RECONCILIATION;
  const EVIDENCE = CONFIG.EVIDENCE;
  const PERMISSION_STATES = ['permitted', 'permitted_within_allowance', 'escalation_with_reason', 'approval_required', 'not_permitted'];

  /* ---------- Cost controls ---------- */
  function allowanceStatus(agent) {
    const a = (agent.controls && agent.controls.allowance_eur) || {};
    const nums = ['per_task', 'daily', 'monthly'].map(k => a[k]);
    const anySet = nums.some(v => v !== null && v !== undefined);
    const allValid = nums.every(v => typeof v === 'number' && Number.isFinite(v) && v > 0);
    const approved = ['approved_by', 'approved_at', 'approval_reference'].every(k => typeof a[k] === 'string' && a[k].trim() !== '');
    if (!anySet) return { configured: false, state: 'not_configured', message: 'No EUR allowance configured. Paid execution not authorised.' };
    if (!allValid) return { configured: false, state: 'invalid', message: 'Allowance incomplete or invalid (per_task, daily and monthly must all be positive EUR). Treated as not configured.' };
    if (!approved) return { configured: false, state: 'unapproved', message: 'Allowance values present without approved_by, approved_at and approval_reference. Treated as not configured.' };
    return { configured: true, state: 'configured', per_task: a.per_task, daily: a.daily, monthly: a.monthly, tz: a.period_time_zone || 'Europe/Nicosia', reference: a.approval_reference, message: 'Approved allowance ' + a.approval_reference + '.' };
  }

  function modelPermission(agent, tier) {
    const p = agent.controls && agent.controls.model_permissions;
    const v = p && p[tier];
    return PERMISSION_STATES.includes(v) ? v : 'not_permitted';
  }

  function findApproval(agent, ref, tier) {
    if (!ref) return null;
    return APPROVALS.find(x => x.id === ref && x.agent_code === agent.code && (!tier || x.model_tier === tier)) || null;
  }

  function registerIssues() {
    const out = [];
    for (const a of REGISTER) {
      const st = allowanceStatus(a);
      if (st.state === 'invalid' || st.state === 'unapproved') out.push({ agent: a.name, issue: st.message });
      const p = (a.controls && a.controls.model_permissions) || {};
      for (const t of MODEL_TIERS) if (!PERMISSION_STATES.includes(p[t])) out.push({ agent: a.name, issue: 'Model permission for ' + t + ' missing or invalid; treated as not_permitted.' });
    }
    return out;
  }

  /* ---------- Europe/Nicosia time handling ---------- */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const partsFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });

  function nicosiaParts(ms) {
    const p = {};
    for (const part of partsFormatter.formatToParts(new Date(ms))) p[part.type] = part.value;
    const y = +p.year, mo = +p.month, d = +p.day, h = +p.hour % 24, mi = +p.minute, s = +p.second;
    const wall = Date.UTC(y, mo - 1, d, h, mi, s);
    const offsetMin = Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000);
    return { year: y, month: mo, day: d, hour: h, minute: mi, second: s, offsetMin, weekday: DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()] };
  }

  function tzLabel(ms) {
    const off = nicosiaParts(ms).offsetMin;
    if (off === 120) return 'EET';
    if (off === 180) return 'EEST';
    const sign = off < 0 ? '-' : '+';
    const a = Math.abs(off);
    return 'UTC' + sign + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
  }

  const pad = n => String(n).padStart(2, '0');

  /* style: 'datetime' (22 Oct 2026, 19:42 EEST), 'time' (19:42 EEST),
     'clock' (19:42:18), 'date' (Thu 22 Oct 2026) */
  function formatNicosia(ms, style) {
    const p = nicosiaParts(ms), label = tzLabel(ms);
    switch (style || 'datetime') {
      case 'time': return pad(p.hour) + ':' + pad(p.minute) + ' ' + label;
      case 'clock': return pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second);
      case 'date': return p.weekday + ' ' + p.day + ' ' + MONTHS[p.month - 1] + ' ' + p.year;
      case 'full': return p.day + ' ' + MONTHS[p.month - 1] + ' ' + p.year + ', ' + pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second) + ' ' + label;
      default: return p.day + ' ' + MONTHS[p.month - 1] + ' ' + p.year + ', ' + pad(p.hour) + ':' + pad(p.minute) + ' ' + label;
    }
  }

  function nicosiaDateKey(ms) {
    const p = nicosiaParts(ms);
    return p.year + '-' + pad(p.month) + '-' + pad(p.day);
  }

  /* ---------- Identifier resolution ---------- */
  function resolveAgent(agentId) {
    if (typeof agentId !== 'string' || agentId === '') return { agent: null, match: 'missing' };
    for (const a of REGISTER) if (a.code && a.code === agentId) return { agent: a, match: 'verified' };
    for (const a of REGISTER) if (a.interim_id === agentId) return { agent: a, match: a.code ? 'superseded' : 'unverified' };
    return { agent: null, match: 'unknown' };
  }

  function agentKey(a) { return a.code || a.interim_id; }

  /* ---------- Event validation ---------- */
  const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

  function flag(code, severity, message) { return { code, severity, message }; }
  function clip(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }

  /* Returns {ok:false, code, reason} for records that cannot be attributed
     or placed in time, or {ok:true, event} for retained records. Routing and
     data-quality problems never cause rejection; they are recorded as flags. */
  /* receivedMs: when the report reached the ACC (defaults to nowMs). Expiry, clock-skew and lateness are judged
     at receipt, so a stored report keeps its verdict when it is reloaded later. */
  function validateEvent(raw, version, nowMs, receivedMs) {
    const recvMs = Number.isFinite(receivedMs) ? receivedMs : nowMs;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'NOT_AN_OBJECT', reason: 'Event is not an object' };
    const res = resolveAgent(raw.agent_id);
    if (res.match === 'missing') return { ok: false, code: 'AGENT_ID_MISSING', reason: 'agent_id missing or empty' };
    if (res.match === 'unknown') return { ok: false, code: 'AGENT_ID_UNKNOWN', reason: 'agent_id "' + clip(raw.agent_id, 80) + '" is not a registered agent code or interim identifier' };
    if (!STATUSES.includes(raw.status)) return { ok: false, code: 'STATUS_INVALID', reason: 'status "' + clip(String(raw.status), 40) + '" is not one of ' + STATUSES.join(', ') };
    if (typeof raw.timestamp !== 'string' || raw.timestamp === '') return { ok: false, code: 'TIMESTAMP_MISSING', reason: 'timestamp missing' };
    if (!TS_RE.test(raw.timestamp)) return { ok: false, code: 'TIMESTAMP_FORMAT', reason: 'timestamp must be ISO 8601 with Z or an explicit UTC offset' };
    const ms = Date.parse(raw.timestamp);
    if (!Number.isFinite(ms)) return { ok: false, code: 'TIMESTAMP_INVALID', reason: 'timestamp cannot be parsed' };
    if (ms - recvMs > FUTURE_TOLERANCE_MS) return { ok: false, code: 'TIMESTAMP_FUTURE', reason: 'timestamp more than 5 minutes in the future (check agent clock)' };
    if (recvMs - ms > MAX_EVENT_AGE_MS) return { ok: false, code: 'TIMESTAMP_EXPIRED', reason: 'report older than 7 days when received; not accepted' };

    const flags = [];
    const a = res.agent;
    if (res.match === 'unverified') flags.push(flag('ID_UNVERIFIED', 'identifier', 'Reported under R006 interim identifier; no verified agent code. Reconciliation required.'));
    if (res.match === 'superseded') flags.push(flag('ID_SUPERSEDED', 'identifier', 'Reported under R006 interim identifier; verified code ' + a.code + ' should be used.'));

    const ev = {
      agent_key: agentKey(a),
      agent_id_reported: raw.agent_id,
      id_match: res.match,
      status: raw.status,
      timestamp_utc: new Date(ms).toISOString(),
      ms,
      imported_at_utc: new Date(nowMs).toISOString(),
      received_at_utc: new Date(recvMs).toISOString(),
      delivery: null,
      schema_version: version,
      event_id: typeof raw.event_id === 'string' ? clip(raw.event_id, 120) : null,
      task: clip(raw.task, TASK_MAX),
      dry_run: null,
      model_tier: null,
      escalation_reason: null,
      approval_reference: null,
      cost_eur: null,
      cost_basis: null,
      approval_request: null,
      run_ref: typeof raw.run_ref === 'string' ? clip(raw.run_ref, 80) : null,
      cost_usd_estimated: (typeof raw.cost_usd_estimated === 'number' && Number.isFinite(raw.cost_usd_estimated) && raw.cost_usd_estimated >= 0) ? raw.cost_usd_estimated : null,
      flags
    };

    // delivery metadata from an agent's outage buffer: original time is kept, delivery time recorded separately
    if (raw.delivery && typeof raw.delivery === 'object' && !Array.isArray(raw.delivery)) {
      const d = raw.delivery, q = typeof d.queued_at_utc === 'string' && TS_RE.test(d.queued_at_utc) ? d.queued_at_utc : null;
      ev.delivery = { queued_at_utc: q, attempts: Number.isInteger(d.attempts) && d.attempts > 0 ? Math.min(d.attempts, 1000) : null,
        dropped_before: Number.isInteger(d.dropped_before) && d.dropped_before > 0 ? Math.min(d.dropped_before, 100000) : 0 };
      if (ev.delivery.dropped_before) flags.push(flag('BUFFER_DROPPED', 'data', ev.delivery.dropped_before + ' earlier report(s) from this agent were dropped by its outage buffer (size, age or attempt limit) and will not arrive.'));
    }
    if (recvMs - ms > LATE_AFTER_MS) flags.push(flag('DELIVERED_LATE', 'info', 'Received ' + Math.round((recvMs - ms) / 60000) + ' min after the event' + (ev.delivery && ev.delivery.attempts ? ' (attempt ' + ev.delivery.attempts + ')' : '') + '. Event time unchanged.'));
    if (nowMs - ms > STALE_AFTER_MS) flags.push(flag('STALE', 'info', 'Older than 24 hours. Kept in history; not used as current status.'));

    const v11 = version === '1.1';
    if (!v11) flags.push(flag('PRE_V1_1', 'info', 'Schema 1.0 record: routing, cost and approval fields not supplied.'));

    // dry_run
    if ('dry_run' in raw) {
      if (typeof raw.dry_run === 'boolean') ev.dry_run = raw.dry_run;
      else flags.push(flag('DRY_RUN_INVALID', 'data', 'dry_run must be true or false.'));
    } else if (v11) flags.push(flag('DRY_RUN_MISSING', 'data', 'dry_run not stated; execution mode unknown.'));

    // model tier and escalation
    if ('model_tier' in raw) {
      if (MODEL_TIERS.includes(raw.model_tier)) ev.model_tier = raw.model_tier;
      else flags.push(flag('MODEL_TIER_INVALID', 'data', 'model_tier "' + clip(String(raw.model_tier), 40) + '" is not one of ' + MODEL_TIERS.join(', ') + '.'));
    } else if (v11) flags.push(flag('MODEL_TIER_MISSING', 'data', 'model_tier not stated; routing cannot be checked.'));

    if (typeof raw.escalation_reason === 'string' && raw.escalation_reason.trim() !== '') ev.escalation_reason = clip(raw.escalation_reason.trim(), TEXT_MAX);
    if (typeof raw.approval_reference === 'string' && raw.approval_reference.trim() !== '') ev.approval_reference = clip(raw.approval_reference.trim(), 120);

    // cost
    if ('cost_eur' in raw) {
      if (typeof raw.cost_eur === 'number' && Number.isFinite(raw.cost_eur) && raw.cost_eur >= 0) ev.cost_eur = Math.round(raw.cost_eur * 10000) / 10000;
      else flags.push(flag('COST_INVALID', 'data', 'cost_eur must be a non-negative number; value excluded from totals.'));
    }
    if ('cost_basis' in raw) {
      if (COST_BASES.includes(raw.cost_basis)) ev.cost_basis = raw.cost_basis;
      else flags.push(flag('COST_BASIS_INVALID', 'data', 'cost_basis must be api or subscription; treated as api.'));
    }
    if (ev.cost_eur !== null && ev.cost_basis === null) ev.cost_basis = 'api';
    if (ev.dry_run === true && ev.cost_eur !== null && ev.cost_eur > 0 && ev.cost_basis === 'api') {
      flags.push(flag('DRY_RUN_WITH_COST', 'review', 'Dry run reported API cost; check whether paid calls were made.'));
    }

    // cost controls from the register (the ACC compares; it never authorises)
    const tier = ev.model_tier;
    if (tier) {
      const perm = modelPermission(a, tier);
      if (perm === 'not_permitted') flags.push(flag('MODEL_NOT_PERMITTED', 'violation', tier + ' is not permitted for this agent. Basis: ' + ((a.controls && a.controls.permissions_basis) || 'register') ));
      if (tier === 'sonnet' && perm !== 'not_permitted' && !ev.escalation_reason) {
        flags.push(flag('ROUTING_SONNET_NO_REASON', 'violation', 'Sonnet used without a recorded escalation reason (routing rule: Sonnet only with recorded reason).'));
      }
      if (tier === 'opus') {
        const appr = findApproval(a, ev.approval_reference, 'opus');
        const bits = ['Opus execution: review against approved task and allowance.'];
        if (!ev.approval_reference) bits.push('No approval reference supplied.');
        else if (appr) bits.push('Approval reference ' + ev.approval_reference + ' matches a recorded approval (status ' + appr.status + ').');
        else bits.push('Approval reference ' + ev.approval_reference + ' not found in recorded approvals.');
        bits.push(ev.escalation_reason ? 'Escalation reason recorded.' : 'No escalation reason recorded.');
        flags.push(flag('OPUS_REVIEW', 'review', bits.join(' ')));
      } else if (perm === 'approval_required') {
        flags.push(flag('MODEL_APPROVAL_REQUIRED', 'review', tier + ' requires approval for this agent; check the approval reference.'));
      }
    }
    /* Paid execution: reported API cost, a USD spend estimate, or a live run on a model tier. A live run that
       uses ordinary code only (for example publishing, or the production controller in active mode) is not paid. */
    if (ev.cost_usd_estimated !== null && ev.cost_usd_estimated > 0 && ev.cost_eur === null) flags.push(flag('COST_NOT_CONVERTED', 'data', 'Model spend reported only as a USD estimate (' + ev.cost_usd_estimated + '); no EUR conversion supplied, so it is not in EUR totals.'));
    const paid = (ev.cost_eur !== null && ev.cost_eur > 0 && ev.cost_basis === 'api')
      || (ev.cost_usd_estimated !== null && ev.cost_usd_estimated > 0)
      || (ev.dry_run === false && ev.model_tier !== null && ev.model_tier !== 'code')
      || (ev.dry_run === false && ev.model_tier === null);
    if (paid) {
      const al = allowanceStatus(a);
      if (!al.configured) {
        flags.push(flag('NO_ALLOWANCE_CONFIGURED', 'violation', 'Paid or live execution reported, but this agent has no approved EUR allowance (' + al.state + '). Rule: no paid execution without an explicitly configured allowance.'));
      } else {
        if (ev.cost_eur !== null && ev.cost_basis === 'api' && ev.cost_eur > al.per_task) flags.push(flag('ALLOWANCE_PER_TASK_EXCEEDED', 'violation', 'Reported cost EUR ' + ev.cost_eur + ' exceeds the per-task allowance EUR ' + al.per_task + ' (' + al.reference + ').'));
        if (ev.dry_run === false) flags.push(flag('LIVE_WITHIN_ALLOWANCE', 'info', 'Live execution under approved allowance ' + al.reference + '.'));
      }
    }

    // approval request
    if ('approval_request' in raw && raw.approval_request !== null) {
      const ar = raw.approval_request;
      if (ar && typeof ar === 'object' && !Array.isArray(ar) && typeof ar.summary === 'string' && ar.summary.trim() !== '') {
        ev.approval_request = { summary: clip(ar.summary.trim(), TEXT_MAX), reference: typeof ar.reference === 'string' ? clip(ar.reference, 120) : null };
      } else flags.push(flag('APPROVAL_REQUEST_INVALID', 'data', 'approval_request must be an object with a summary.'));
    }
    if (ev.status === 'awaiting_approval' && !ev.approval_request) flags.push(flag('APPROVAL_DETAIL_MISSING', 'data', 'Awaiting approval but no request details supplied.'));
    if (ev.approval_request && ev.status !== 'awaiting_approval') flags.push(flag('APPROVAL_STATUS_MISMATCH', 'data', 'Approval request supplied but status is not awaiting_approval; not counted as pending.'));

    return { ok: true, event: ev };
  }

  /* ---------- Store ---------- */
  function createStore() { return { events: [], rejected: [], keys: new Set(), seq: 0 }; }

  function dedupeKey(ev) {
    return ev.event_id ? 'id:' + ev.agent_key + ':' + ev.event_id : 'k:' + [ev.agent_key, ev.timestamp_utc, ev.status, ev.task].join('|');
  }

  function ingestReport(store, obj, nowMs, sourceName, opts) {
    const o = opts || {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Report must be a JSON object');
    const version = obj.version === undefined ? null : String(obj.version);
    if (!SUPPORTED_VERSIONS.includes(version)) throw new Error('Unsupported or missing schema version (expected 1.0 or 1.1)');
    if (!Array.isArray(obj.events)) throw new Error('Expected an events array');
    const out = { accepted: 0, duplicates: 0, rejected: 0, flagged: 0 };
    obj.events.forEach((raw, i) => {
      const r = validateEvent(raw, version, nowMs, o.received_at_utc ? Date.parse(o.received_at_utc) : nowMs);
      if (!r.ok) {
        out.rejected++;
        store.rejected.push({ index: i, source: sourceName || null, code: r.code, reason: r.reason, imported_at_utc: new Date(nowMs).toISOString() });
        return;
      }
      const key = dedupeKey(r.event);
      if (store.keys.has(key)) { out.duplicates++; return; }
      store.keys.add(key);
      r.event.seq = ++store.seq;
      r.event.source = sourceName || null;
      r.event.authenticated = !!o.authenticated;
      r.event.key_id = o.key_id || null;
      if (o.received_at_utc) r.event.received_at_utc = o.received_at_utc;
      store.events.push(r.event);
      out.accepted++;
      if (r.event.flags.some(f => f.severity !== 'info')) out.flagged++;
    });
    // Newest first; for identical timestamps the later-received report wins.
    store.events.sort((a, b) => (b.ms - a.ms) || ((b.seq || 0) - (a.seq || 0)));
    return out;
  }

  /* ---------- Derived views (only from retained events) ---------- */
  function eventsFor(store, agent) { const k = agentKey(agent); return store.events.filter(e => e.agent_key === k); }

  function currentEvent(store, agent, nowMs) {
    return eventsFor(store, agent).find(e => nowMs - e.ms <= STALE_AFTER_MS) || null;
  }

  function summarise(store, nowMs) {
    const today = nicosiaDateKey(nowMs);
    const agents = REGISTER.map(a => ({ agent: a, current: currentEvent(store, a, nowMs) }));
    const reporting = agents.filter(x => x.current);
    const working = reporting.filter(x => x.current.status === 'working');
    const approvals = reporting.filter(x => x.current.status === 'awaiting_approval')
      .map(x => ({ agent: x.agent, event: x.current, detail: x.current.approval_request }));
    const todays = store.events.filter(e => nicosiaDateKey(e.ms) === today);
    const costed = todays.filter(e => e.cost_eur !== null);
    const apiCost = costed.filter(e => e.cost_basis === 'api').reduce((s, e) => s + e.cost_eur, 0);
    const subCost = costed.filter(e => e.cost_basis === 'subscription').reduce((s, e) => s + e.cost_eur, 0);
    const exceptions = store.events.filter(e => e.flags.some(f => f.severity === 'violation' || f.severity === 'review' || f.severity === 'data'));
    return {
      today,
      hasData: store.events.length > 0,
      registered: REGISTER.length,
      reportingCount: reporting.length,
      workingCount: working.length,
      approvals,
      cost: {
        eventsToday: todays.length,
        costedToday: costed.length,
        apiEur: Math.round(apiCost * 100) / 100,
        subscriptionEur: Math.round(subCost * 100) / 100,
        hasApi: costed.some(e => e.cost_basis === 'api'),
        hasSubscription: costed.some(e => e.cost_basis === 'subscription')
      },
      agents,
      exceptions,
      verifiedCount: REGISTER.filter(a => a.verification === 'verified').length,
      allowances: REGISTER.map(a => ({ agent: a, usage: allowanceUsage(store, a, nowMs) })),
      violations: store.events.filter(e => e.flags.some(f => f.severity === 'violation')).length,
      reviews: store.events.filter(e => e.flags.some(f => f.severity === 'review')).length,
      rejected: store.rejected.length,
      streams: STREAMS.slice(1).map(s => {
        const ops = agents.filter(x => x.agent.stream === s.id);
        const homed = s.id === '03' ? agents.length : 0;
        return { stream: s, operating: ops.length, homed, reporting: ops.filter(x => x.current).length,
          statuses: ops.filter(x => x.current).map(x => x.current.status) };
      })
    };
  }

  function periodKey(ms, tz) {
    return tz === 'UTC' ? new Date(ms).toISOString().slice(0, 10) : nicosiaDateKey(ms);
  }

  /* Reported API spend against an approved allowance. Only API-basis costs count;
     subscription usage is reported separately and never charged to an allowance. */
  function allowanceUsage(store, agent, nowMs) {
    const st = allowanceStatus(agent);
    const evs = eventsFor(store, agent).filter(e => e.cost_eur !== null && e.cost_basis === 'api');
    const tz = st.configured ? st.tz : 'Europe/Nicosia';
    const byDay = {}, byMonth = {};
    for (const e of evs) {
      const d = periodKey(e.ms, tz), m = d.slice(0, 7);
      byDay[d] = (byDay[d] || 0) + e.cost_eur;
      byMonth[m] = (byMonth[m] || 0) + e.cost_eur;
    }
    const today = periodKey(nowMs, tz), month = today.slice(0, 7);
    const r2 = n => Math.round(n * 10000) / 10000;
    const breaches = [];
    if (st.configured) {
      for (const [d, v] of Object.entries(byDay)) if (v > st.daily) breaches.push({ kind: 'daily', period: d, total: r2(v), limit: st.daily });
      for (const [m, v] of Object.entries(byMonth)) if (v > st.monthly) breaches.push({ kind: 'monthly', period: m, total: r2(v), limit: st.monthly });
    }
    return { status: st, today, month, todayEur: r2(byDay[today] || 0), monthEur: r2(byMonth[month] || 0), reportedEur: r2(evs.reduce((s, e) => s + e.cost_eur, 0)), costedReports: evs.length, breaches };
  }

  function agentPerformance(store, agent) {
    const evs = eventsFor(store, agent);
    const byTier = {};
    for (const t of MODEL_TIERS) byTier[t] = 0;
    let untiered = 0, api = 0, sub = 0, costed = 0;
    for (const e of evs) {
      if (e.model_tier) byTier[e.model_tier]++; else untiered++;
      if (e.cost_eur !== null) { costed++; if (e.cost_basis === 'subscription') sub += e.cost_eur; else api += e.cost_eur; }
    }
    return { total: evs.length, byTier, untiered, costed, apiEur: Math.round(api * 100) / 100, subscriptionEur: Math.round(sub * 100) / 100,
      dryRuns: evs.filter(e => e.dry_run === true).length, liveRuns: evs.filter(e => e.dry_run === false).length,
      failed: evs.filter(e => e.status === 'failed').length };
  }

  function auditExport(store, nowMs) {
    return {
      release: RELEASE,
      exported_at_utc: new Date(nowMs).toISOString(),
      display_time_zone: TIME_ZONE,
      note: 'Session export of imported agent reports. Source authenticity not verified.',
      events: store.events.map(e => { const c = Object.assign({}, e); delete c.ms; return c; }),
      rejected: store.rejected.slice()
    };
  }

  const ACC = { RELEASE, TIME_ZONE, STATUSES, MODEL_TIERS, COST_BASES, STALE_AFTER_MS, STREAMS, REGISTER, RECONCILIATION,
    CONFIG, APPROVALS, EVIDENCE, PERMISSION_STATES, allowanceStatus, modelPermission, findApproval, registerIssues, allowanceUsage, dedupeKey,
    nicosiaParts, tzLabel, formatNicosia, nicosiaDateKey, resolveAgent, agentKey, validateEvent, createStore,
    ingestReport, eventsFor, currentEvent, summarise, agentPerformance, auditExport };

  if (typeof module !== 'undefined' && module.exports) module.exports = ACC;
  else root.ACC = ACC;
})(typeof window !== 'undefined' ? window : this);
