'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CORE = fs.readFileSync(path.join(ROOT, 'acc_core.js'), 'utf8');
const REG = fs.readFileSync(path.join(ROOT, 'acc_register.js'), 'utf8');
const NOW = Date.parse('2026-10-22T16:42:00Z');
const MASTER = '03AA-04_Master_Agent_TI_Ops_Director';

function load() {
  const html = HTML.replace('<script src="acc_register.js"></script>', '<script>' + REG + '</script>').replace('<script src="acc_core.js"></script>', '<script>' + CORE + '</script>')
    .replace(/<link[^>]+fonts\.g[^>]+>/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.ACC_APP.setClock(() => NOW);
  return { dom, w, d: w.document, close: () => w.close() };
}
const text = d => { const b = d.body.cloneNode(true); b.querySelectorAll('script,style,pre').forEach(n => n.remove()); return b.textContent.replace(/\s+/g, ' '); };
const kpi = (d, label) => d.querySelector('[data-kpi^="' + label + '"] b').textContent;

test('acceptance: with no reports, nothing operational is invented or shown as live', () => {
  const { d, close } = load();
  try {
    assert.equal(d.querySelectorAll('img').length, 0, 'raster artwork with baked-in figures removed');
    assert.ok(!HTML.includes('approved-command-centre.png'));
    assert.equal(kpi(d, 'Agents reporting'), 'No reports');
    assert.equal(kpi(d, 'Reported working'), 'No data');
    assert.equal(kpi(d, 'Approvals pending'), 'No data');
    assert.equal(kpi(d, 'API cost today'), 'No cost data');
    assert.equal(kpi(d, 'System health'), 'Not connected');
    const t = text(d);
    assert.ok(!t.includes('%'), 'no percentage figures');
    assert.ok(!t.includes('\u20ac'), 'no euro figures');
    for (const w of ['Online', 'Running', 'Operational', 'Real time', 'ONLINE']) assert.ok(!t.includes(w), 'must not show "' + w + '"');
    assert.equal(d.getElementById('coreStatus').textContent, 'Status unknown: no report');
    const tiles = [...d.querySelectorAll('#agentGrid .agent')];
    assert.equal(tiles.length, 8);
    for (const tile of tiles) assert.match(tile.textContent, /Unknown, no report/);
    for (const id of ['01', '02', '04', '05', '06']) assert.match(d.getElementById('nd' + id).textContent, /none reporting|No registered agent/);
    assert.match(d.getElementById('activity').textContent, /No agent reports imported/);
    for (const li of d.querySelectorAll('#connections li')) assert.match(li.textContent, /Not connected/);
  } finally { close(); }
});

test('acceptance: structural counts come from the register, not the artwork', () => {
  const { d, close } = load();
  try {
    assert.equal(kpi(d, 'Streams'), '6');
    assert.equal(kpi(d, 'Sub-streams'), '31');
    assert.equal(kpi(d, 'Agents verified'), '3 of 8');
    for (const name of ['Forge Agent', 'Data Agent', 'Social Agent', 'Content Agent', 'Finance Agent']) assert.ok(!d.getElementById('agentGrid').textContent.includes(name));
  } finally { close(); }
});

test('orbital: 00 to 06 numbering and stream colours preserved', () => {
  const { d, close } = load();
  try {
    const ids = [...d.querySelectorAll('#orbit .node')].map(n => n.dataset.id).sort();
    assert.deepEqual(ids, ['00', '01', '02', '03', '04', '05', '06']);
    const ring = d.querySelector('#node02 .ring');
    assert.equal(ring.getAttribute('stroke'), '#ffab36');
    assert.equal(d.querySelector('#node06 .ring').getAttribute('stroke'), '#ff5abb');
  } finally { close(); }
});

test('import: reported data drives figures, statuses, approvals and exceptions', () => {
  const { w, d, close } = load();
  try {
    const r = w.ACC_APP.importObject({ version: '1.1', events: [
      { agent_id: MASTER, status: 'working', timestamp: '2026-10-22T16:40:00Z', task: 'Daily consolidation dry run', dry_run: true, model_tier: 'code', cost_eur: 0 },
      { agent_id: 'ti-country-builder', status: 'awaiting_approval', timestamp: '2026-10-22T16:30:00Z', task: 'Ghana refresh', dry_run: true, model_tier: 'sonnet', cost_eur: 0.3, cost_basis: 'api', approval_request: { summary: 'Publish Ghana brief', reference: 'TI-PR-12' } },
      { agent_id: 'sqe', status: 'idle', timestamp: '2026-10-22T16:00:00Z', dry_run: false, model_tier: 'opus', cost_eur: 0.12 },
      { agent_id: 'forge-agent', status: 'working', timestamp: '2026-10-22T16:00:00Z' }
    ] }, 'sample.json');
    assert.equal(r.accepted, 3);
    assert.equal(r.rejected, 1);
    assert.equal(kpi(d, 'Agents reporting'), '3 of 8');
    assert.equal(kpi(d, 'Reported working'), '1');
    assert.equal(kpi(d, 'Approvals pending'), '1');
    assert.equal(kpi(d, 'API cost today'), '\u20ac0.42');
    assert.equal(kpi(d, 'System health'), 'Not connected');
    assert.equal(d.getElementById('coreStatus').textContent, 'Reported: Working');
    assert.equal(d.getElementById('coreTime').textContent, '19:40 EEST, not live');
    assert.match(d.getElementById('approvals').textContent, /Publish Ghana brief \(TI-PR-12\)/);
    const ex = d.getElementById('exceptionTable').textContent;
    for (const c of ['ROUTING_SONNET_NO_REASON', 'OPUS_REVIEW', 'NO_ALLOWANCE_CONFIGURED', 'DRY_RUN_WITH_COST', 'ID_SUPERSEDED', 'ID_UNVERIFIED']) assert.ok(ex.includes(c), c);
    assert.match(d.getElementById('rejectedTable').textContent, /AGENT_ID_UNKNOWN/);
    assert.match(d.getElementById('activity').textContent, /19:40 EEST/);
    assert.match(d.getElementById('nd01').textContent, /2 agents, 2 reporting|5 agents, 2 reporting/);
  } finally { close(); }
});

test('timezone: clock label switches from EEST to EET at the October change', () => {
  const { w, d, close } = load();
  try {
    w.ACC_APP.setClock(() => Date.parse('2026-10-25T00:59:30Z'));
    assert.equal(d.getElementById('clockZone').textContent, 'Cyprus (EEST)');
    assert.equal(d.getElementById('clockTime').textContent, '03:59:30');
    w.ACC_APP.setClock(() => Date.parse('2026-10-25T01:00:30Z'));
    assert.equal(d.getElementById('clockZone').textContent, 'Cyprus (EET)');
    assert.equal(d.getElementById('clockTime').textContent, '03:00:30');
  } finally { close(); }
});

test('timezone: imported statuses revert to unknown once older than 24 hours', () => {
  const { w, d, close } = load();
  try {
    w.ACC_APP.importObject({ version: '1.1', events: [{ agent_id: MASTER, status: 'working', timestamp: '2026-10-22T16:40:00Z', dry_run: true, model_tier: 'code' }] });
    assert.equal(kpi(d, 'Agents reporting'), '1 of 8');
    w.ACC_APP.setClock(() => NOW + 25 * 3600000);
    assert.equal(kpi(d, 'Agents reporting'), '0 of 8');
    assert.equal(d.getElementById('coreStatus').textContent, 'Status unknown: no report');
  } finally { close(); }
});

test('agent detail: five tabs, unverified code shown, no controls offered', () => {
  const { w, d, close } = load();
  try {
    w.ACC_APP.openAgent('sqe');
    assert.ok(d.getElementById('agentModal').classList.contains('open'));
    const tabs = [...d.querySelectorAll('#detailTabs button')].map(b => b.textContent);
    assert.deepEqual(tabs, ['Overview', 'Current activity', 'History', 'Performance & costs', 'Controls & approvals']);
    assert.match(d.getElementById('detailContent').textContent, /No verified code \(interim: sqe\)/);
    d.querySelectorAll('#detailTabs button')[4].click();
    assert.match(d.getElementById('detailContent').textContent, /No remote agent controls are enabled/);
    assert.match(d.getElementById('detailContent').textContent, /No EUR allowance configured/);
    assert.equal(d.querySelectorAll('#detailContent button').length, 0, 'no control buttons');
    d.querySelectorAll('#detailTabs button')[3].click();
    assert.match(d.getElementById('detailContent').textContent, /No usage or expenditure data reported/);
  } finally { close(); }
});

test('keyboard: one Escape handler closes the modal first, then the stream panel', () => {
  const { w, d, close } = load();
  try {
    w.ACC_APP.openStream('02');
    w.ACC_APP.openAgent(MASTER);
    const esc = () => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    esc();
    assert.ok(!d.getElementById('agentModal').classList.contains('open'));
    assert.ok(d.getElementById('panel').classList.contains('show'));
    esc();
    assert.ok(!d.getElementById('panel').classList.contains('show'));
  } finally { close(); }
});

test('orbital: selecting a node opens its stream detail', () => {
  const { w, d, close } = load();
  try {
    d.getElementById('node05').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert.equal(d.getElementById('panelTitle').textContent, '05 OSINT Dashboards');
    assert.match(d.getElementById('panelBody').textContent, /No registered AI agent/);
  } finally { close(); }
});

test('housekeeping: no long dashes, no obsolete CSS, single keydown listener', () => {
  for (const f of ['index.html', 'acc_core.js', 'acc_register.js', 'README.md', 'agent_event_format_example.json', 'server/acc_server.js', 'server/acc_admin.js', 'clients/acc_report_client.py', 'integrations/travel_intelligence/acc_report.py']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/[\u2013\u2014]/.test(s), f + ' contains a long dash');
  }
  for (const cls of ['.live-dock', '.live-card', '.live-grid', '.live-btn', '.state-label', '.pulse', '.hotspot', '.art{']) assert.ok(!HTML.includes(cls), 'obsolete ' + cls);
  assert.equal((HTML.match(/document\.addEventListener\('keydown'/g) || []).length, 1);
  assert.ok(!/innerHTML/.test(HTML), 'no innerHTML rendering of data');
});
