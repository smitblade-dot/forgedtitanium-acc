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
  // the only connections are the register's stream flows and the spokes to the core; none joins two agent orbs
  assert.equal(d.querySelectorAll('#satLayer line').length, d.querySelectorAll('#satLayer .sat').length, 'each orb has only its tether to its own stream');
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

test('layout hooks for the camera exist: base box, aspect ratio and a canvas for the Earth and the backdrop', async () => {
  const d = (await load()).window.document;
  assert.ok(d.querySelector('canvas#earth') && d.querySelector('canvas#fxBg'));
  assert.equal(d.querySelector('#orbit').getAttribute('viewBox'), '0.0 20.0 1200.0 760.0');
  assert.equal(d.querySelector('#orbit').style.aspectRatio.replace(/\s/g, ''), '1200/760');
});
