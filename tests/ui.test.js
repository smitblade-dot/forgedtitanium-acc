'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const INDEX = path.join(__dirname, '..', 'site', 'index.html');
const R = require('../site/acc_register.js');
const FIXED_NOW = Date.parse('2026-10-23T12:00:00Z');

async function load() {
  const dom = await JSDOM.fromFile(INDEX, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
  await new Promise(r => dom.window.addEventListener('load', r));
  dom.window.ACC_APP.setClock(() => FIXED_NOW);
  return dom;
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

test('orbital renders 00 core plus six streams with sub-stream labels', async () => {
  const dom = await load(); const d = dom.window.document;
  assert.ok(d.querySelector('#node00'));
  assert.deepEqual([...d.querySelectorAll('#orbit .node')].map(n => n.dataset.id), ['00', '01', '02', '03', '04', '05', '06']);
  assert.match(d.querySelector('#node00').textContent, /FORGEDTITANIUM/);
  assert.equal(d.querySelectorAll('#orbit .sublink').length, 31);
  dom.window.close();
});

test('shows Unknown / Not connected and no invented operational figures', async () => {
  const dom = await load(); const d = dom.window.document;
  const page = d.body.textContent;
  assert.match(d.querySelector('#coreStatus').textContent, /Status unknown: no report/);
  assert.match(d.querySelector('#coreTime').textContent, /No live connection/);
  assert.match(page, /Not connected/);
  assert.match(page, /Unknown/);
  assert.doesNotMatch(page, /€\s?\d/, 'no EUR figures');
  assert.doesNotMatch(page, /\b\d+ reporting\b(?<!0 reporting)/, 'no agent may be shown as reporting');
  for (const el of d.querySelectorAll('#agentGrid .agent')) assert.match(el.textContent, /Unknown|unknown/, el.textContent);
  assert.equal(d.querySelector('#eventFile'), null, 'no intake control');
  assert.equal(d.querySelector('input[type=password]'), null, 'no token entry');
  dom.window.close();
});

test('every stream node opens a panel; every Level 2 label opens its detail', async () => {
  const dom = await load(); const w = dom.window, d = w.document;
  for (const s of R.STREAMS) {
    click(w, d.querySelector('#node' + s.id));
    assert.ok(d.querySelector('#panel').classList.contains('show'), s.id);
    assert.match(d.querySelector('#panelTitle').textContent, new RegExp('^' + s.id));
  }
  for (const s of R.STREAMS.slice(1)) {
    s.sub.forEach((item, i) => {
      click(w, d.querySelector(`#orbit .sublink[data-stream="${s.id}"][data-sub="${i}"]`));
      assert.match(d.querySelector('#subDetail').textContent, new RegExp('Level 2: ' + item.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
  }
  dom.window.close();
});

test('Level 2 entry with a code lists the agents homed there and opens them', async () => {
  const dom = await load(); const w = dom.window, d = w.document;
  click(w, d.querySelector('#orbit .sublink[data-stream="03"][data-sub="3"]'));
  const links = [...d.querySelectorAll('#subDetail .agentlink')].map(b => b.textContent);
  assert.ok(links.includes('Country Intelligence Builder'));
  click(w, [...d.querySelectorAll('#subDetail .agentlink')].find(b => b.textContent === 'Country Intelligence Builder'));
  assert.ok(d.querySelector('#agentModal').classList.contains('open'));
  dom.window.close();
});

test('all eight agents open with five detail sections and an unknown status', async () => {
  const dom = await load(); const w = dom.window, d = w.document;
  assert.equal(d.querySelectorAll('#agentGrid .agent').length, 8);
  for (const a of R.AGENTS) {
    const btn = [...d.querySelectorAll('#agentGrid .agent')].find(b => b.querySelector('b').textContent === a.name);
    assert.ok(btn, a.name);
    click(w, btn);
    assert.ok(d.querySelector('#agentModal').classList.contains('open'), a.name);
    const tabs = [...d.querySelectorAll('#detailTabs button')].map(b => b.textContent);
    assert.deepEqual(tabs, ['Overview', 'Current activity', 'History', 'Performance & costs', 'Controls & approvals']);
    for (const t of d.querySelectorAll('#detailTabs button')) {
      click(w, t);
      assert.ok(d.querySelector('#detailContent').textContent.length > 20, a.name + ' ' + t.textContent);
    }
    click(w, d.querySelector('#detailTabs button'));
    assert.match(d.querySelector('#detailStatus').textContent, /No live connection/);
    assert.match(d.querySelector('#detailContent').textContent, /Reporting is disabled and not connected/);
    click(w, d.querySelector('#detailClose'));
  }
  dom.window.close();
});

test('verified and provisional agents are clearly identified', async () => {
  const dom = await load(); const d = dom.window.document;
  const cards = [...d.querySelectorAll('#agentGrid .agent')];
  assert.equal(cards.filter(c => /Verified/i.test(c.textContent) && !/not verified|unverified|not evidenced/i.test(c.textContent)).length, 3);
  assert.equal(cards.filter(c => /No verified code/.test(c.textContent)).length, 5);
  dom.window.close();
});

test('no stale references to importing, exporting or loading reports remain in visible text', async () => {
  const dom = await load(); const w = dom.window, d = w.document;
  const visible = () => { const c = d.body.cloneNode(true); c.querySelectorAll('script,style').forEach(n => n.remove()); return c.textContent; };
  const seen = [visible()];
  for (const a of R.AGENTS) {
    click(w, [...d.querySelectorAll('#agentGrid .agent')].find(b => b.querySelector('b').textContent === a.name));
    for (const t of d.querySelectorAll('#detailTabs button')) { click(w, t); seen.push(d.querySelector('#detailContent').textContent); }
    click(w, d.querySelector('#detailClose'));
  }
  for (const s of d.querySelectorAll('#orbit .node')) { click(w, s); seen.push(d.querySelector('#panel').textContent); }
  const all = seen.join('\n');
  assert.doesNotMatch(all, /import|export audit|load a report|acc_register\.js|session-only/i);
  dom.window.close();
});
