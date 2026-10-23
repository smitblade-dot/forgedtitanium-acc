'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../site/acc_register.js');

test('orbital hierarchy 00-06 is retained with approved names', () => {
  assert.deepEqual(R.STREAMS.map(s => s.id + ' ' + s.name), [
    '00 FORGEDTITANIUM', '01 Travel Intelligence', '02 Quality Solutions', '03 Agents & Automation',
    '04 The Mester’s Forge', '05 OSINT Dashboards', '06 Venture Engine']);
  assert.deepEqual(R.STREAMS.slice(1).map(s => s.sub.length), [6, 3, 6, 6, 4, 6]);
});

test('approved orbital positions are unchanged', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
  assert.match(html, /const ANGLES = \{'01':-90,'02':-30,'03':30,'04':90,'05':150,'06':210\};/);
  assert.match(html, /viewBox="0 0 1200 800"/);
});

test('three verified Travel Intelligence agents and five provisional agents', () => {
  const verified = R.AGENTS.filter(a => a.verification === 'verified');
  assert.deepEqual(verified.map(a => a.code).sort(), [
    '03AA-04_Country_Intelligence_Builder_TI', '03AA-04_Master_Agent_TI_Ops_Director', '03AA-04_Production_Controller_TI']);
  const provisional = R.AGENTS.filter(a => a.verification !== 'verified');
  assert.equal(provisional.length, 5);
  for (const a of provisional) assert.equal(a.code, null, a.name + ' must not carry an invented code');
  assert.equal(R.AGENTS.length, 8);
});

test('every agent has all five implementation stages as text, never numbers', () => {
  for (const a of R.AGENTS) for (const k of ['built', 'tested', 'merged', 'configured', 'operational'])
    assert.equal(typeof a.stages[k], 'string', a.name + ' ' + k);
});

test('level 2 entries are labelled corroborated or provisional only', () => {
  const all = R.STREAMS.flatMap(s => s.sub);
  assert.equal(all.length, 31);
  assert.deepEqual([...new Set(all.map(x => x.status))].sort(), ['corroborated', 'provisional']);
  assert.equal(all.filter(x => x.status === 'corroborated').length, 1);
});
