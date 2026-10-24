'use strict';
// Visual restoration: the futuristic layer shows only what the register and the restricted public status document evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SITE = path.join(__dirname, '..', 'site');
const INDEX = path.join(SITE, 'index.html');
const NOW = Date.parse('2026-10-23T12:00:00Z');
const MASTER = '03AA-04_Master_Agent_TI_Ops_Director', BUILDER = '03AA-04_Country_Intelligence_Builder_TI', CONTROLLER = '03AA-04_Production_Controller_TI';
const ago = m => new Date(NOW - m * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');

const opened = [];
test.after(() => opened.forEach(d => d.window.close()));
async function load() {
  const dom = await JSDOM.fromFile(INDEX, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) { w.fetch = () => Promise.resolve({ ok: false, json: async () => null }); } });
  opened.push(dom);
  await new Promise(r => dom.window.addEventListener('load', r));
  dom.window.ACC_APP.setClock(() => NOW);
  return dom;
}
const entry = (agent, name, state, minutes) => ({ agent_id: agent, name, verification: 'verified', state, state_reason: 'reported', as_of_utc: ago(minutes), last_report_utc: ago(minutes), reports_24h: 1,
  history: [{ at_utc: ago(minutes), state, mode: 'dry_run', delivered_late: false }] });
const doc = agents => ({ schema: 'acc-public-status/1', generated_at_utc: ago(1), window_hours: 24, working_timeout_minutes: 120, agents });

test('the orbit keeps the approved fixed stream positions: 01 at 12, 02 at 2, 03 at 4, 04 at 6, 05 at 8, 06 at 10 o\'clock', async () => {
  const d = (await load()).window.document;
  const c = (id) => { const g = d.querySelector('#node' + id + ' .ring'); return { x: +g.getAttribute('cx'), y: +g.getAttribute('cy') }; };
  const core = { x: 600, y: 400 };
  const clock = id => { const p = c(id); const a = Math.atan2(p.x - core.x, -(p.y - core.y)) * 180 / Math.PI; return Math.round(((a + 360) % 360) / 30) % 12 || 12; };
  assert.deepEqual(['01', '02', '03', '04', '05', '06'].map(clock), [12, 2, 4, 6, 8, 10]);
});

test('every registered agent with an operating stream has exactly one orb beside that stream, and nothing else does', async () => {
  const d = (await load()).window.document;
  const REG = require(path.join(SITE, 'acc_register.js'));
  const reg = REG.AGENTS || REG.REGISTER || [];
  const expected = reg.filter(a => ['01', '02', '03', '04', '05', '06'].includes(a.stream));
  const sats = [...d.querySelectorAll('#satLayer .sat')];
  assert.equal(sats.length, expected.length);
  assert.ok(sats.length >= 8);
  assert.deepEqual(new Set(sats.map(s => s.dataset.agent)).size, sats.length, 'one orb per agent');
});

test('orbs and the register reflect only reported state: unreported agents stay dashed and Unknown', async () => {
  const dom = await load(), w = dom.window, d = w.document;
  w.ACC_APP.applyPublicStatus(doc([entry(CONTROLLER, 'Production Controller TI', 'active', 3), entry(BUILDER, 'Country Intelligence Builder', 'idle', 90)]));
  const st = k => d.querySelector('#satLayer .sat[data-agent="' + k + '"]').dataset.s;
  assert.equal(st(CONTROLLER), 'working');
  assert.equal(st(BUILDER), 'idle');
  assert.equal(st(MASTER), 'none');
  assert.equal(d.querySelector('#satLayer .sat[data-agent="' + MASTER + '"] .satring').getAttribute('stroke-dasharray'), '3 3');
  assert.match(d.querySelector('#satLayer .sat[data-agent="' + MASTER + '"] title').textContent, /no report \(Unknown\)/);
  const card = n => [...d.querySelectorAll('#agentGrid .agent')].find(b => b.querySelector('b').textContent === n);
  assert.match(card('Production Controller TI').textContent, /Reported 3 min ago/);
  assert.match(card('Country Intelligence Builder').textContent, /Reported 1 h 30 min ago/);
  assert.match(card('TI Operations Director (Master Agent)').textContent, /No report received/);
  assert.equal(card('TI Operations Director (Master Agent)').dataset.s, 'none');
});

test('no agent-to-agent communication is drawn, and the page says so', async () => {
  const dom = await load(), w = dom.window, d = w.document;
  w.ACC_APP.applyPublicStatus(doc([entry(CONTROLLER, 'Production Controller TI', 'active', 3), entry(BUILDER, 'Country Intelligence Builder', 'active', 4), entry(MASTER, 'TI Operations Director (Master Agent)', 'active', 5)]));
  assert.match(d.querySelector('#orbitLegend').textContent, /No agent-to-agent message is evidenced, so none is drawn/);
  assert.equal(d.querySelectorAll('#satLayer line, #satLayer path[marker-end]').length, 0, 'no link joins two agent orbs');
});

test('stream status rings count the real registered agents of each stream', async () => {
  const d = (await load()).window.document;
  const rings = [...d.querySelectorAll('#streamStatus .sring')];
  assert.equal(rings.length, 6);
  assert.equal(rings[0].querySelectorAll('path').length, 5, 'stream 01 has five registered agents');
  assert.equal(rings[1].querySelectorAll('path').length, 2);
  assert.equal(rings[3].querySelectorAll('path').length, 0, 'stream 04 has none, drawn as an empty dashed ring');
});

test('the Earth mask is real geography at 2 degrees and the visual module is decorative only', () => {
  const src = fs.readFileSync(path.join(SITE, 'acc_visual.js'), 'utf8');
  const b64 = /LAND_B64 = '([A-Za-z0-9+/=]+)'/.exec(src)[1];
  const bytes = Buffer.from(b64, 'base64');
  assert.equal(bytes.length, Math.ceil(180 * 90 / 8));
  let land = 0; for (const b of bytes) for (let i = 0; i < 8; i++) land += (b >> i) & 1;
  assert.ok(land > 4800 && land < 6000, 'about a third of cells are land: ' + land);
  const cell = (lon, lat) => { const x = Math.floor((lon + 180) / 2), y = Math.floor((90 - lat) / 2), i = y * 180 + x; return (bytes[i >> 3] >> (i & 7)) & 1; };
  assert.equal(cell(10, 50), 1, 'Europe is land');
  assert.equal(cell(-30, 0), 0, 'the mid Atlantic is ocean');
  assert.equal(cell(33, 35), 0 | cell(33, 35), 'sanity');
  for (const re of [/\bfetch\b/, /XMLHttpRequest/, /WebSocket/, /localStorage/, /sessionStorage/, /document\.cookie/, /https?:\/\//]) assert.doesNotMatch(src, re, 'acc_visual.js must not match ' + re);
});

test('age text is plain and honest', async () => {
  const w = (await load()).window;
  const f = w.ACC_FX.ageText;
  assert.deepEqual([f(20000), f(5 * 60000), f(59 * 60000), f(90 * 60000), f(5 * 3600000), f(30 * 3600000), f(-1)], ['just now', '5 min ago', '59 min ago', '1 h 30 min ago', '5 h ago', '1 d ago', 'time unknown']);
});

test('the status feed still decides everything: an empty feed leaves all agents Unknown and every orb dashed', async () => {
  const d = (await load()).window.document;
  assert.ok([...d.querySelectorAll('#satLayer .sat')].every(s => s.dataset.s === 'none'));
  assert.ok([...d.querySelectorAll('#agentGrid .agent')].every(b => /No report received/.test(b.textContent)));
});

test('layout hooks for the camera exist: a stage, a canvas for the Earth and the backdrop, and a computed viewBox', async () => {
  const d = (await load()).window.document;
  assert.ok(d.querySelector('#stage') && d.querySelector('canvas#earth') && d.querySelector('canvas#fxBg'));
  assert.match(d.querySelector('#orbit').getAttribute('viewBox'), /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/);
});

const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const shapesOf = (d, key) => [...d.querySelectorAll('#agentGrid .agent[data-agent="' + key + '"] .glyph')].map(g => g.dataset.shape);

test('every reported state has its own shape and label, never colour alone', async () => {
  const dom = await load(), w = dom.window, d = w.document;
  w.ACC_APP.applyPublicStatus(doc([entry(MASTER, 'TI Operations Director (Master Agent)', 'active', 3), entry(BUILDER, 'Country Intelligence Builder', 'awaiting_approval', 4), entry(CONTROLLER, 'Production Controller TI', 'failed', 5)]));
  assert.deepEqual([shapesOf(d, MASTER)[0], shapesOf(d, BUILDER)[0], shapesOf(d, CONTROLLER)[0]], ['working', 'awaiting_approval', 'failed']);
  const w2 = (await load()).window; w2.ACC_APP.applyPublicStatus(doc([entry(MASTER, 'TI Operations Director (Master Agent)', 'disconnected', 4), entry(BUILDER, 'Country Intelligence Builder', 'idle', 4)]));
  const d2 = w2.document;
  assert.deepEqual([shapesOf(d2, MASTER)[0], shapesOf(d2, BUILDER)[0]], ['offline', 'idle']);
  assert.equal(shapesOf(d2, CONTROLLER)[0], 'none', 'an agent with no report is drawn as unknown');
  // provisional agents are a different silhouette (hexagon) from verified agents without a report
  const prov = d2.querySelector('#agentGrid .agent[data-agent="sqe"] .glyph polygon'), ver = d2.querySelector('#agentGrid .agent[data-agent="' + CONTROLLER + '"] .glyph polygon');
  assert.ok(prov && !ver, 'provisional = hexagon, verified unknown = ring');
  // the console names the state in words as well
  click(w, [...d.querySelectorAll('#agentGrid .agent')].find(b => b.querySelector('b').textContent === 'Production Controller TI'));
  assert.match(d.querySelector('#detailState').textContent, /Failed/);
  assert.equal(d.querySelector('#coreSvg .core').dataset.s, 'failed');
});

test('Level 2 labels and the stream agents are revealed only for the selected stream', async () => {
  const dom = await load(), w = dom.window, d = w.document;
  const on = () => [...d.querySelectorAll('#satLayer .reveal.on')].map(r => r.dataset.stream);
  assert.deepEqual(on(), [], 'nothing is revealed at rest');
  assert.equal(d.querySelectorAll('#orbit .sublink').length, 31, 'all 31 register labels exist and are reachable once revealed');
  click(w, d.querySelector('#node03'));
  assert.deepEqual(on(), ['03']);
  assert.ok(d.querySelector('.stagewrap').classList.contains('focus'), 'instruments step back while a stream is selected');
  click(w, d.querySelector('#node01'));
  assert.deepEqual(on(), ['01']);
  assert.equal(d.querySelectorAll('#satLayer .reveal[data-stream="01"] .sat').length, 5, 'stream 01 reveals its five registered agents');
  click(w, d.querySelector('#panelClose'));
  assert.deepEqual(on(), []);
  assert.ok(!d.querySelector('.stagewrap').classList.contains('focus'));
});

test('the agent console has a clear return path to the stream and the company views', async () => {
  const dom = await load(), w = dom.window, d = w.document;
  click(w, [...d.querySelectorAll('#agentGrid .agent')].find(b => b.querySelector('b').textContent === 'TI Operations Director (Master Agent)'));
  assert.ok(d.querySelector('#agentModal').classList.contains('open'));
  assert.equal(d.querySelector('#crumbCompany').textContent, '00 Company');
  assert.equal(d.querySelector('#crumbStream').textContent, '01 Travel Intelligence');
  click(w, d.querySelector('#crumbStream'));
  assert.ok(!d.querySelector('#agentModal').classList.contains('open'));
  assert.ok(d.querySelector('#panel').classList.contains('show'), 'back at the stream view');
  assert.match(d.querySelector('#panelTitle').textContent, /01 Travel Intelligence/);
  click(w, [...d.querySelectorAll('#agentGrid .agent')].find(b => b.querySelector('b').textContent === 'Agent SQE'));
  click(w, d.querySelector('#crumbCompany'));
  assert.ok(!d.querySelector('#agentModal').classList.contains('open') && !d.querySelector('#panel').classList.contains('show'), 'back at company level');
});

test('stream nodes carry the cinematic imagery from the approved reference, with local files only', async () => {
  const d = (await load()).window.document;
  for (const id of ['01', '02', '03', '04', '05', '06']) {
    const img = d.querySelector('#node' + id + ' image');
    assert.ok(img, 'node ' + id + ' has an image');
    const href = img.getAttribute('href');
    assert.equal(href, 'assets/node-' + id + '.jpg');
    assert.ok(fs.statSync(path.join(SITE, href)).size > 2000, href + ' exists');
  }
});

test('the supporting instruments show only values derived from the register and the feed', async () => {
  const dom = await load(), w = dom.window, d = w.document;
  const kpi = k => d.querySelector('.kpi[data-kpi="' + k + '"] b').textContent;
  assert.equal(kpi('Registered agents'), '8');
  assert.equal(kpi('Agents reporting (last 24 h)'), 'No reports');
  w.ACC_APP.applyPublicStatus(doc([entry(MASTER, 'TI Operations Director (Master Agent)', 'active', 3), entry(CONTROLLER, 'Production Controller TI', 'idle', 40)]));
  assert.equal(kpi('Agents reporting (last 24 h)'), '2 of 8');
  assert.equal(kpi('Reported working'), '1');
  assert.equal(kpi('Approvals pending'), '0');
  assert.match(d.querySelector('#feedLine').textContent, /Feed live/);
  assert.match(d.querySelector('#feedLine').textContent, /Last successful update \d{2}:\d{2}:\d{2} EEST/);
  const text = d.querySelector('.huds').textContent;
  assert.doesNotMatch(text, /€\s?\d|%|health\s+\d/i, 'no invented cost, percentage or health figure');
});

test('reduced motion switches off every decorative animation', () => {
  const html = fs.readFileSync(INDEX, 'utf8');
  const block = /@media \(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/.exec(html);
  assert.ok(block, 'a reduced-motion block exists');
  for (const k of ['.spin', '.dash', '.breathe', '.pulsedot', '.panel.show', '.modal.open']) assert.ok(block[1].includes(k), k + ' is disabled');
  assert.match(block[1], /animation:none!important/);
  const js = fs.readFileSync(path.join(SITE, 'acc_visual.js'), 'utf8');
  assert.match(js, /prefers-reduced-motion: reduce/, 'the Earth, backdrop and camera honour the setting');
});

test('the public view never shows task text, run references, keys or costs in the console', async () => {
  const dom = await load(), w = dom.window, d = w.document;
  const e = entry(MASTER, 'TI Operations Director (Master Agent)', 'idle', 5);
  w.ACC_APP.applyPublicStatus(doc([e]));
  click(w, [...d.querySelectorAll('#agentGrid .agent')].find(b => b.querySelector('b').textContent === 'TI Operations Director (Master Agent)'));
  const all = [];
  for (const t of d.querySelectorAll('#detailTabs button')) { click(w, t); all.push(d.querySelector('#detailContent').textContent); }
  const text = all.join(' ');
  assert.doesNotMatch(text, /sk-ant|k_[0-9a-f]{12}|secret|signing|bearer|run ref|€\s?\d/i);
  assert.match(text, /Not published/);
});

/* ---------------- ACC-R018 ---------------- */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pathEnds = d => { const n = d.match(/-?\d+(\.\d+)?/g).map(Number); return [{ x: n[0], y: n[1] }, { x: n[2], y: n[3] }]; };

test('R018 topology: 00 is the hub and each of the six streams connects directly to it; no stream is chained to another', async () => {
  const d = (await load()).window.document;
  const links = [...d.querySelectorAll('#links .link')];
  assert.equal(links.length, 6);
  const core = { x: 600, y: 400 };
  for (const l of links) {
    const id = l.dataset.stream, [from, to] = pathEnds(d.querySelector('#link' + id).getAttribute('d'));
    const ring = d.querySelector('#node' + id + ' .ring'), node = { x: +ring.getAttribute('cx'), y: +ring.getAttribute('cy') };
    assert.ok(dist(from, core) < 110 && dist(from, core) > 95, 'link ' + id + ' starts at the hub: ' + dist(from, core));
    assert.ok(dist(to, node) < 110 && dist(to, node) > 100, 'link ' + id + ' ends at its own node: ' + dist(to, node));
    assert.ok(dist(to, core) > 150, 'and runs outward from 00');
  }
  assert.equal(d.querySelectorAll('#orbit [id^="flow"], #orbit [marker-end], #orbit marker, #orbit #orbitRing').length, 0, 'no sequential arcs, arrows or ring through the streams');
  const positions = ['01', '02', '03', '04', '05', '06'].map(id => { const r = d.querySelector('#node' + id + ' .ring'); return [Math.round(+r.getAttribute('cx')), Math.round(+r.getAttribute('cy'))]; });
  assert.deepEqual(positions[0].map(Math.round), [600, 132], 'the approved positions are unchanged: 01 at 12 o\'clock');
});

test('R018 pulses: identical on all six links, decorative, and never driven by a report', async () => {
  const dom = await load(), w = dom.window, d = w.document;
  const html = fs.readFileSync(INDEX, 'utf8');
  assert.match(html, /pulses travel outward from 00 on every link\. They are decorative, identical for all six streams and are not driven by any report/);
  assert.doesNotMatch(html, /spokeLive/);
  assert.match(d.querySelector('#orbitLegend').textContent, /Pulses on the links are decorative and do not represent agent communication/);
});

const COST_DOC = (over) => {
  const sc = (api, n, m) => ({ api: api === null ? { state: 'no_cost_data', amount_eur: null, costed_reports: 0, completion_reports: m || 0 } : { state: 'recorded', amount_eur: api, costed_reports: n, completion_reports: m },
    subscription: { state: 'no_cost_data', amount_eur: null, costed_reports: 0 }, original_currency: { state: 'no_cost_data', currency: null, amount: null, reports: 0, converted: false } });
  const d = { schema: 'acc-public-cost/1', generated_at_utc: '2026-10-23T12:00:00Z', currency: 'EUR', time_zone: 'Europe/Nicosia',
    evidence: { kind: 'agent_execution_records', provider_confirmed: false, note: 'Agent execution records, not provider invoices', subscription_note: 'Subscription usage is reported separately and is never added to API cost' },
    today: Object.assign({ date: '2026-10-23' }, sc(0.42, 3, 4)), month: Object.assign({ month: '2026-10' }, sc(1.5, 9, 12)),
    by_agent: [{ agent_id: MASTER, name: 'TI Operations Director (Master Agent)', today: sc(0.42, 3, 4), month: sc(1.5, 9, 12) }, { agent_id: BUILDER, name: 'Country Intelligence Builder', today: sc(null, 0, 2), month: sc(null, 0, 3) }],
    by_model_tier: ['code', 'haiku', 'sonnet', 'opus'].map(t => ({ tier: t, today: sc(t === 'haiku' ? 0.42 : null, t === 'haiku' ? 3 : 0, 4), month: sc(t === 'haiku' ? 1.5 : null, t === 'haiku' ? 9 : 0, 12) })) };
  return over ? over(d) || d : d;
};

test('R018 cost: with no published document every field reads No cost data and nothing is invented', async () => {
  const d = (await load()).window.document;
  assert.equal(d.querySelector('#costVal').textContent, 'No cost data');
  assert.equal(d.querySelector('#costSub').textContent, 'Not published');
  const rows = [...d.querySelectorAll('#costPanel .costrow .v')];
  assert.equal(rows.length, 6);
  assert.ok(rows.every(r => r.textContent === 'No cost data'));
  assert.doesNotMatch(d.querySelector('#costPanel').textContent, /€\s?\d|0\.00/, 'no invented zero');
  assert.match(d.querySelector('#costPanel').textContent, /awaiting the owner/);
  assert.match(fs.readFileSync(INDEX, 'utf8').split('fetch(statusUrl()').length > 1 ? 'x' : '', /x/);
  assert.equal((fs.readFileSync(INDEX, 'utf8').match(/\bfetch\s*\(/g) || []).length, 1, 'still exactly one request site: the status feed');
});

test('R018 cost: a valid projection shows EUR by period, agent and model, keeps subscription and original currency separate, and marks proposed fields', async () => {
  const dom = await load(), w = dom.window, d = w.document;
  const doc = COST_DOC(x => { x.today.subscription = { state: 'recorded', amount_eur: 12, costed_reports: 1 }; x.today.original_currency = { state: 'recorded', currency: 'USD', amount: 0.0223, reports: 2, converted: false }; });
  assert.equal(w.ACC_APP.applyPublicCost(doc, { proposed: true }), true);
  assert.equal(d.querySelector('#costVal').textContent, '€0.42');
  assert.match(d.querySelector('#costSub').textContent, /today · 3 of 4 reports/);
  const text = d.querySelector('#costPanel').textContent;
  assert.match(text, /PROPOSED FIELDS: NOT PUBLISHED/);
  assert.match(text, /Today, 2026-10-23[\s\S]*API expenditure€0\.42/); assert.match(text, /Month to date, 2026-10[\s\S]*€1\.50/);
  assert.match(text, /TI Operations Director \(Master Agent\)€0\.42/); assert.match(text, /Country Intelligence BuilderNo cost data/);
  assert.match(text, /HaikuNo cost data|Haiku€0\.42/); assert.match(text, /Opus\s*No cost data|OpusNo cost data/);
  assert.match(text, /USD 0\.0223/); assert.match(text, /Subscription€12\.00/); assert.match(text, /Never added to API cost/);
  assert.match(text, /not provider invoices/i);
  assert.doesNotMatch(text, /allowance|approval|key|run ref|secret/i);
});

test('R018 cost: a recorded zero is shown as a zero only when reports state it; no cost data stays No cost data', async () => {
  const w = (await load()).window, d = w.document;
  w.ACC_APP.applyPublicCost(COST_DOC(x => { x.today.api = { state: 'recorded', amount_eur: 0, costed_reports: 13, completion_reports: 13 }; }));
  assert.equal(d.querySelector('#costVal').textContent, '€0.00');
  assert.match(d.querySelector('#costSub').textContent, /13 of 13 reports/);
  w.ACC_APP.applyPublicCost(COST_DOC(x => { x.today.api = { state: 'no_cost_data', amount_eur: null, costed_reports: 0, completion_reports: 5 }; }));
  assert.equal(d.querySelector('#costVal').textContent, 'No cost data');
  assert.doesNotMatch(d.querySelector('#costVal').textContent, /€/);
});

test('R018 cost: anything outside the allowlist is refused and the page falls back to No cost data', async () => {
  const w = (await load()).window, d = w.document;
  const bad = [x => { x.allowance_eur = 5; }, x => { x.today.api.amount_eur = '0.42'; }, x => { x.today.api.amount_eur = -1; }, x => { x.today.api.state = 'no_cost_data'; }, x => { x.by_agent[0].task = 'x'; },
    x => { x.evidence.provider_confirmed = true; }, x => { x.currency = 'USD'; }, x => { x.today.original_currency.converted = true; }, x => { x.by_model_tier.pop(); },
    x => { x.by_agent[0].name = '<img src=x onerror=alert(1)>'; }, x => { x.today.date = 'today'; }, x => { x.approval_reference = 'ref'; }];
  for (const fn of bad) {
    const doc = COST_DOC(fn);
    assert.equal(w.ACC_APP.applyPublicCost(doc), false);
    assert.equal(d.querySelector('#costVal').textContent, 'No cost data');
    assert.equal(d.querySelectorAll('#costPanel img').length, 0);
  }
});

test('R018 agent console: floating timeline of genuine events, three circular indicators, a built-once radial menu, and a still core without a report', async () => {
  const dom = await load(), w = dom.window, d = w.document;
  const hist = [{ at_utc: ago(5), state: 'idle', mode: 'dry_run', delivered_late: false }, { at_utc: ago(6), state: 'active', mode: 'dry_run', delivered_late: false }, { at_utc: ago(300), state: 'failed', mode: null, delivered_late: true }];
  w.ACC_APP.applyPublicStatus(doc([Object.assign(entry(MASTER, 'TI Operations Director (Master Agent)', 'idle', 5), { history: hist })]));
  click(w, [...d.querySelectorAll('#agentGrid .agent')].find(b => b.querySelector('b').textContent === 'TI Operations Director (Master Agent)'));
  const tl = [...d.querySelectorAll('#detailTimeline .tl li')];
  assert.equal(tl.length, 3, 'one entry per genuine event');
  assert.match(tl[0].textContent, /Idle/); assert.match(tl[0].textContent, /dry run/); assert.match(tl[2].textContent, /Failed/);
  const gauges = [...d.querySelectorAll('#detailGauges .gauge')];
  assert.deepEqual(gauges.map(g => g.querySelector('b').textContent), ['Freshness', 'Reports 24 h', 'Mode']);
  assert.match(gauges[0].textContent, /Reported 5 min ago/); assert.match(gauges[1].textContent, /3 reports/); assert.match(gauges[2].textContent, /1 dry run, 0 live, 1 not stated/);
  assert.ok(d.querySelector('#coreSvg .csweep') && d.querySelector('#coreSvg .cmotes'), 'a reporting core is animated');
  const btn = d.querySelector('#detailTabs button'); click(w, d.querySelectorAll('#detailTabs button')[2]);
  assert.equal(d.querySelector('#detailTabs button'), btn, 'switching facet does not rebuild the radial menu');
  assert.equal(d.querySelectorAll('#detailTabs button[aria-selected=true]').length, 1);
  click(w, d.querySelector('#detailClose'));
  click(w, [...d.querySelectorAll('#agentGrid .agent')].find(b => b.querySelector('b').textContent === 'Country Intelligence Builder'));
  assert.equal(d.querySelector('#coreSvg .csweep'), null, 'an agent with no report has a still core');
  assert.match(d.querySelector('#detailTimeline').textContent, /No reports received/);
  assert.match(d.querySelector('#detailGauges').textContent, /No report received/);
});
