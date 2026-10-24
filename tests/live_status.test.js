'use strict';
// ACC-R014: the public frontend consumes the restricted public status document, strictly and safely.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const INDEX = path.join(__dirname, '..', 'site', 'index.html');
const NOW = Date.parse('2026-10-23T12:00:00Z');
const MASTER = '03AA-04_Master_Agent_TI_Ops_Director', BUILDER = '03AA-04_Country_Intelligence_Builder_TI', CONTROLLER = '03AA-04_Production_Controller_TI';
const ago = m => new Date(NOW - m * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');

const opened = [];
test.after(() => opened.forEach(d => d.window.close()));
async function load(fetchImpl) {
  const dom = await JSDOM.fromFile(INDEX, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) { w.fetch = fetchImpl || (() => Promise.resolve({ ok: false, json: async () => null })); } });
  opened.push(dom);
  await new Promise(r => dom.window.addEventListener('load', r));
  dom.window.ACC_APP.setClock(() => NOW);
  return dom;
}
const entry = (agent, name, state, minutes, history) => ({ agent_id: agent, name, verification: 'verified', state, state_reason: 'reported', as_of_utc: ago(minutes), last_report_utc: ago(minutes), reports_24h: 1,
  history: history || [{ at_utc: ago(minutes), state, mode: 'dry_run', delivered_late: false }] });
const doc = agents => ({ schema: 'acc-public-status/1', generated_at_utc: ago(1), window_hours: 24, working_timeout_minutes: 120, agents });
const card = (d, name) => [...d.querySelectorAll('#agentGrid .agent')].find(b => b.querySelector('b').textContent === name);
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

test('committed status.json is a valid empty document and leaves everything Unknown / Not connected', async () => {
  const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'status.json'), 'utf8'));
  const dom = await load(); const w = dom.window, d = w.document;
  assert.equal(w.ACC_APP.applyPublicStatus(committed), false, 'no data, so not connected');
  assert.match(d.querySelector('#notice').textContent, /^Last synchronised: \d{2}:\d{2}:\d{2} EEST$/, 'a valid empty document is a successful synchronisation');
  assert.equal(d.querySelector('.kpi[data-kpi="Agents reporting (last 24 h)"] b').textContent, 'No reports', 'with no reports');
  const dom2 = await load(); assert.equal(dom2.window.document.querySelector('#notice').textContent, 'Not synchronised', 'before any document has been received');
  for (const c of d.querySelectorAll('#agentGrid .agent')) assert.match(c.textContent, /Unknown, no report/);
});

test('active, idle, failed, disconnected and unknown agents are distinguished on the page', async () => {
  const dom = await load(); const w = dom.window, d = w.document;
  w.ACC_APP.applyPublicStatus(doc([entry(MASTER, 'TI Operations Director (Master Agent)', 'active', 10), entry(BUILDER, 'Country Intelligence Builder', 'failed', 20),
    entry(CONTROLLER, 'Production Controller TI', 'disconnected', 30)]));
  assert.match(d.querySelector('#actTitle').textContent, /restricted view/);
  assert.match(card(d, 'TI Operations Director (Master Agent)').textContent, /Active/);
  assert.match(card(d, 'Country Intelligence Builder').textContent, /Failed/);
  assert.match(card(d, 'Production Controller TI').textContent, /Disconnected/);
  assert.match(card(d, 'Agent SQE').textContent, /Unknown, no report/, 'provisional agents stay unknown');
  assert.equal(card(d, 'Country Intelligence Builder').querySelector('.st').dataset.s, 'failed');
  w.ACC_APP.applyPublicStatus(doc([entry(MASTER, 'TI Operations Director (Master Agent)', 'idle', 5)]));
  assert.match(card(d, 'TI Operations Director (Master Agent)').textContent, /Idle/);
  assert.match(card(d, 'Country Intelligence Builder').textContent, /Unknown, no report/, 'an agent missing from the document reverts to unknown');
});

test('a stale report and an unresolved start are Unknown, never Active', async () => {
  const dom = await load(); const w = dom.window, d = w.document;
  w.ACC_APP.applyPublicStatus(doc([entry(MASTER, 'TI Operations Director (Master Agent)', 'idle', 25 * 60), entry(BUILDER, 'Country Intelligence Builder', 'active', 125)]));
  assert.match(card(d, 'TI Operations Director (Master Agent)').textContent, /Unknown, no report/, 'older than 24 h');
  assert.match(card(d, 'Country Intelligence Builder').textContent, /Unknown \(reported\)/, 'start with no completion for over two hours');
  assert.doesNotMatch(card(d, 'Country Intelligence Builder').textContent, /Active/);
});

test('agent console shows verified history and timestamps; unpublished fields say Not published', async () => {
  const dom = await load(); const w = dom.window, d = w.document;
  const hist = [{ at_utc: ago(5), state: 'idle', mode: 'dry_run', delivered_late: false }, { at_utc: ago(6), state: 'active', mode: 'dry_run', delivered_late: false }, { at_utc: ago(300), state: 'failed', mode: null, delivered_late: true }];
  w.ACC_APP.applyPublicStatus(doc([entry(MASTER, 'TI Operations Director (Master Agent)', 'idle', 5, hist)]));
  click(w, card(d, 'TI Operations Director (Master Agent)'));
  assert.match(d.querySelector('#detailStatus').textContent, /Idle, reported .*Restricted public view/);
  assert.equal(d.querySelector('#detailCode').textContent, MASTER, 'the permanent FT identifier is shown');
  assert.match(d.querySelector('#detailFresh').textContent, /Reported 5 min ago/);
  assert.ok(d.querySelector('#coreSvg .freshArc'), 'reporting freshness is drawn as an arc around the core');
  const tabs = [...d.querySelectorAll('#detailTabs button')];
  assert.deepEqual(tabs.map(t => t.textContent), ['Current activity', 'Activity history', 'Performance', 'Costs', 'Controls & approvals']);
  let cur = d.querySelector('#detailContent').textContent;                       // default facet: current activity
  assert.match(cur, /Current taskNot published/); assert.match(cur, /Execution modeDry run/); assert.match(cur, /Last execution time/); assert.match(cur, /Europe\/Nicosia \(EET or EEST\)/);
  click(w, tabs[1]);
  const items = [...d.querySelectorAll('#detailContent .hist li')];
  assert.equal(items.length, 3, 'all three reports are listed');
  assert.match(items[0].textContent, /Idle/); assert.match(items[1].textContent, /Active/); assert.match(items[2].textContent, /Failed/);
  click(w, tabs[2]); cur = d.querySelector('#detailContent').textContent;
  assert.match(cur, /Reports received \(in view\)3/); assert.match(cur, /Tasks completed and success rateUnavailable: not published/);
  click(w, tabs[3]); cur = d.querySelector('#detailContent').textContent;
  assert.match(cur, /Reported costNot published/); assert.match(cur, /Model tierNot published/); assert.match(cur, /Spending allowanceNot published/);
  click(w, tabs[4]); cur = d.querySelector('#detailContent').textContent;
  assert.match(cur, /Approval stateNo approval request reported/); assert.match(cur, /Remote controlsNone enabled/);
  assert.doesNotMatch(d.querySelector('#agentModal').textContent, /Not connected|sk-ant|k_[0-9a-f]{12}/);
});

test('no violation or review noise from private governance reaches the public view', async () => {
  const dom = await load(); const w = dom.window, d = w.document;
  const hist = [{ at_utc: ago(5), state: 'idle', mode: 'live', delivered_late: true }];
  w.ACC_APP.applyPublicStatus(doc([entry(MASTER, 'TI Operations Director (Master Agent)', 'idle', 5, hist)]));
  const page = (() => { const c = d.body.cloneNode(true); c.querySelectorAll('script,style').forEach(n => n.remove()); return c.textContent; })();
  assert.doesNotMatch(page, /violation|allowance breach|NO_ALLOWANCE|DELIVERED_LATE|AGENT_KEY|for review/i);
  assert.match(d.querySelector('#excCount').textContent, /not published/);
  assert.doesNotMatch(page, /€\s?\d/);
});

test('hostile or malformed documents are ignored whole: unknown fields, bad values, markup, wrong schema', async () => {
  const good = doc([entry(MASTER, 'TI Operations Director (Master Agent)', 'idle', 5)]);
  const mut = fn => { const x = JSON.parse(JSON.stringify(good)); fn(x); return x; };
  const bad = [
    x => { x.agents[0].task = 'SECRET'; }, x => { x.extra = 1; }, x => { x.schema = 'acc-public-status/2'; }, x => { x.agents[0].state = 'running'; },
    x => { x.agents[0].name = '<img src=x onerror=alert(1)>'.repeat(10); }, x => { x.agents[0].history[0].note = 'free text'; }, x => { x.agents[0].history[0].at_utc = 'yesterday'; },
    x => { x.agents[0].agent_id = 'evil<script>'; }, x => { x.working_timeout_minutes = 0; }, x => { x.agents = 'nope'; }, x => { x.agents[0].history[0].mode = 'paid'; }
  ];
  for (const fn of bad) {
    const dom = await load(); const w = dom.window, d = w.document;
    assert.equal(w.ACC_APP.applyPublicStatus(mut(fn)), false);
    assert.match(card(d, 'TI Operations Director (Master Agent)').textContent, /Unknown, no report/);
    assert.equal(d.querySelectorAll('img').length, 0);
    assert.equal(d.querySelectorAll('script').length, 4, 'no script injected (inline app plus the three files)');
  }
  const dom = await load();
  assert.equal(dom.window.ACC_APP.applyPublicStatus(null), false);
  assert.equal(dom.window.ACC_APP.applyPublicStatus('<b>x</b>'), false);
});

test('a name in the document cannot rename an agent or inject markup: the register decides', async () => {
  const dom = await load(); const w = dom.window, d = w.document;
  w.ACC_APP.applyPublicStatus(doc([Object.assign(entry(MASTER, 'Totally Different Name', 'idle', 5), {})]));
  assert.ok(card(d, 'TI Operations Director (Master Agent)'));
  assert.equal(card(d, 'Totally Different Name'), undefined);
});

test('a document naming an agent the register does not know adds nothing', async () => {
  const dom = await load(); const w = dom.window;
  assert.equal(w.ACC_APP.applyPublicStatus(doc([entry('03AA-04_Invented_Agent', 'Invented', 'active', 5)])), false);
});

test('the page requests only the approved status document, anonymously', async () => {
  const calls = [];
  const dom = await load((url, init) => { calls.push([url, init]); return Promise.resolve({ ok: true, json: async () => doc([entry(CONTROLLER, 'Production Controller TI', 'idle', 3)]) }); });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(calls.length >= 1, true);
  assert.equal(calls[0][0], 'https://forgedtitanium-acc-service.fly.dev/public/status.json');   // the one approved address
  assert.equal(JSON.stringify(calls[0][1]), JSON.stringify({ cache: 'no-store', credentials: 'omit' }));
  assert.match(card(dom.window.document, 'Production Controller TI').textContent, /Idle/);
  assert.match(dom.window.document.querySelector('#connections').textContent, /Agent servicesACC service, restricted view/);
});

test('a configured status address must be same-origin relative or an https URL; anything else falls back', async () => {
  for (const [content, want] of [['status.json', 'status.json'], ['https://acc.example.org/public/status.json', 'https://acc.example.org/public/status.json'],
    ['http://evil.example/status.json', 'status.json'], ['javascript:alert(1)', 'status.json'], ['//evil.example/x', 'status.json'], ['https://a.com@evil.com/x', 'status.json'], ['', 'status.json']]) {
    const calls = [];
    const html = fs.readFileSync(INDEX, 'utf8').replace('content="https://forgedtitanium-acc-service.fly.dev/public/status.json"', 'content="' + content + '"');
    const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'file://' + INDEX,
      beforeParse(w) { w.fetch = u => { calls.push(u); return Promise.resolve({ ok: false, json: async () => null }); }; } });
    opened.push(dom);
    await new Promise(r => dom.window.addEventListener('load', r));
    assert.equal(calls[0], want, content);
  }
});

test('an agent awaiting approval is shown, with its details marked Not published', async () => {
  const dom = await load(); const w = dom.window, d = w.document;
  w.ACC_APP.applyPublicStatus(doc([entry(BUILDER, 'Country Intelligence Builder', 'awaiting_approval', 5)]));
  assert.match(d.querySelector('#apprCount').textContent, /1 pending/);
  assert.match(d.querySelector('#approvals').textContent, /Details are not published/);
});

test('each agent shows identity, operating stream, status, last report time and recent history together', async () => {
  const dom = await load(); const w = dom.window, d = w.document;
  const hist = [{ at_utc: ago(5), state: 'idle', mode: 'dry_run', delivered_late: false }, { at_utc: ago(8), state: 'active', mode: 'dry_run', delivered_late: false }];
  w.ACC_APP.applyPublicStatus(doc([entry(CONTROLLER, 'Production Controller TI', 'idle', 5, hist), entry(MASTER, 'TI Operations Director (Master Agent)', 'failed', 20)]));
  const c = card(d, 'Production Controller TI').textContent;
  assert.match(c, /Production Controller TI/);                    // identity: name
  assert.match(c, /03AA-04_Production_Controller_TI/);            // identity: code
  assert.match(c, /Idle, \d{2}:\d{2} EEST/);                      // status and last report time
  assert.match(c, /Verified/);
  click(w, card(d, 'Production Controller TI'));
  assert.match(d.querySelector('#detailPath').textContent, /Home 03AA-04, operates in 01 Travel Intelligence/);   // operating stream
  assert.match(d.querySelector('#detailStatus').textContent, /Idle, reported 23 Oct 2026, 1\d:\d{2}/);
  click(w, [...d.querySelectorAll('#detailTabs button')][1]);
  const items = [...d.querySelectorAll('#detailContent .hist li')].map(li => li.textContent);
  assert.equal(items.length, 2);                                   // sanitised recent history, newest first
  assert.match(items[0], /Idle/); assert.match(items[1], /Active/);
  assert.match(items[0], /dry run/);
  click(w, d.querySelector('#detailClose'));
  // the stream filter lists the agent under its operating stream
  const sel = d.querySelector('#agentFilter'); sel.value = '01'; sel.dispatchEvent(new w.Event('change'));
  assert.ok(card(d, 'Production Controller TI')); assert.equal(card(d, 'Agent SQE'), undefined);
});

test('the compact synchronisation indicator replaces the long notice and still calls out a stale feed, with the time labelled', async () => {
  const dom = await load(); const w = dom.window, d = w.document;
  const stale = doc([entry(MASTER, 'TI Operations Director (Master Agent)', 'idle', 30)]);
  stale.generated_at_utc = ago(20);
  w.ACC_APP.applyPublicStatus(stale);
  const n = d.querySelector('#notice');
  assert.match(n.textContent, /^Last synchronised: \d{2}:\d{2}:\d{2} EEST \u00b7 feed stale$/);
  assert.ok(n.classList.contains('stale'));
  w.ACC_APP.applyPublicStatus(doc([entry(MASTER, 'TI Operations Director (Master Agent)', 'idle', 3)]));
  assert.match(n.textContent, /^Last synchronised: \d{2}:\d{2}:\d{2} EEST$/);
  assert.ok(!n.classList.contains('stale'));
  assert.doesNotMatch(d.body.textContent, /Restricted public view of reports received by the ACC service/, 'the prominent paragraph is gone');
  assert.match(n.getAttribute('title'), /Statuses older than 24 hours revert to Unknown/, 'the restriction is kept as a tooltip and in the footer');
});

test('every displayed time is Europe/Nicosia and explicitly labelled EEST in summer and EET after the 25 Oct 2026 change', async () => {
  const visible = d => { const c = d.body.cloneNode(true); c.querySelectorAll('script,style,.clock,#agentModal').forEach(n => n.remove()); return c.textContent; };
  const check = async (nowIso, label) => {
    const now = Date.parse(nowIso);
    const ago2 = m => new Date(now - m * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const dom = await load(); const w = dom.window, d = w.document;
    w.ACC_APP.setClock(() => now);
    const mk = (agent, name, state, m) => Object.assign(entry(agent, name, state, m), { history: [{ at_utc: ago2(m), state, mode: 'dry_run', delivered_late: false }, { at_utc: ago2(m + 40), state: 'active', mode: null, delivered_late: false }] });
    const dd = { schema: 'acc-public-status/1', generated_at_utc: ago2(1), window_hours: 24, working_timeout_minutes: 120, agents: [mk(MASTER, 'TI Operations Director (Master Agent)', 'failed', 10), mk(BUILDER, 'Country Intelligence Builder', 'idle', 20), mk(CONTROLLER, 'Production Controller TI', 'idle', 30)] };
    w.ACC_APP.applyPublicStatus(dd);
    for (const name of ['TI Operations Director (Master Agent)', 'Country Intelligence Builder', 'Production Controller TI']) {
      click(w, card(d, name));
      for (const t of [...d.querySelectorAll('#detailTabs button')].slice(0, 3)) { click(w, t); }
      const text = d.querySelector('#detailContent').textContent + ' ' + d.querySelector('#detailStatus').textContent;
      click(w, [...d.querySelectorAll('#detailTabs button')][1]);
      const cur = d.querySelector('#detailContent').textContent + d.querySelector('#detailStatus').textContent;
      for (const t of [text, cur]) for (const m of t.matchAll(/\b\d{2}:\d{2}(?::\d{2})?(?![\d:])(?! (?:EEST|EET))/g)) assert.fail('unlabelled time ' + m[0] + ' in: ' + t.slice(Math.max(0, m.index - 40), m.index + 20));
      click(w, d.querySelector('#detailClose'));
    }
    const page = visible(d);
    assert.ok(page.includes(label), 'expected label ' + label + ' on the page');
    for (const m of page.matchAll(/\b\d{2}:\d{2}(?::\d{2})?(?![\d:])(?! (?:EEST|EET))/g)) assert.fail('unlabelled time ' + m[0] + ' near: ' + page.slice(Math.max(0, m.index - 40), m.index + 20));
    assert.equal(page.includes(label === 'EEST' ? ' EET' : ' EEST'), false, 'wrong zone label');
  };
  await check('2026-10-23T12:00:00Z', 'EEST');
  await check('2026-10-26T12:00:00Z', 'EET');
});

test('exactly one registration per verified agent code, and the Haiku monitor is not a separate agent', () => {
  const R = require('../site/acc_register.js');
  const codes = R.AGENTS.filter(a => a.code).map(a => a.code);
  assert.deepEqual(codes.sort(), [BUILDER, CONTROLLER, MASTER].sort());
  assert.equal(new Set(R.AGENTS.map(a => a.name)).size, R.AGENTS.length, 'no duplicate names');
  assert.equal(new Set(R.AGENTS.map(a => a.interim_id)).size, R.AGENTS.length, 'no duplicate interim ids');
  assert.ok(!R.AGENTS.some(a => /haiku|monitor/i.test(a.name)), 'the monitor is a function of the Master Agent, not its own agent');
  assert.match(R.AGENTS.find(a => a.code === MASTER).responsibilities.join(' '), /Haiku/);
});
