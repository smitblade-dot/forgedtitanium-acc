'use strict';
/* This directory is published in a PUBLIC repository. These tests keep it fit for that: no credentials, no internal
   approvals or allowances, no owner-network details, nothing that reads like a private deployment. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  if (['node_modules', '.git', 'acc_data', '__pycache__'].includes(e.name)) return [];
  const p = path.join(d, e.name); return e.isDirectory() ? walk(p) : [p];
});
const files = walk(ROOT).filter(f => !/\.(png|ico)$/.test(f) && !/package-lock\.json$/.test(f));
const rel = f => path.relative(ROOT, f);

test('no credentials, tokens, private keys or key-shaped secrets in any file', () => {
  const patterns = [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /xox[baprs]-[A-Za-z0-9-]{10,}/,
    /"secret_b64url"\s*:\s*"[A-Za-z0-9_-]{30,}"/, /fo1_[A-Za-z0-9]{30,}/, /\bFlyV1 [A-Za-z0-9+\/=_,-]{20,}/];
  for (const f of files) { const t = fs.readFileSync(f, 'utf8'); for (const re of patterns) assert.doesNotMatch(t, re, rel(f)); }
});

test('no owner-network, personal-address or private-host details', () => {
  const bad = [/\bNUC\b/, /tailscale/i, /cloudflared/i, /\bufw\b/i, /hotmail|smit_blade|forged-titanium\.com/i, /\/home\/user|\/tmp\/claude/, /\b192\.168\.\d+\.\d+\b/, /\b10\.\d+\.\d+\.\d+\b/];
  for (const f of files.filter(f => rel(f) !== path.join('tests', 'public_source_test.js'))) {   // this file names the terms it forbids
    const t = fs.readFileSync(f, 'utf8'); for (const re of bad) assert.doesNotMatch(t, re, rel(f) + ' ' + re);
  }
});

test("the owner's name appears only in the vendored reporter, which is a byte copy of the public Travel Intelligence file", () => {
  const allowed = new Set([path.join('integrations', 'travel_intelligence', 'acc_report.py')]);
  for (const f of files) if (!allowed.has(rel(f))) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /\bMarc\b/, rel(f));
  const crypto = require('node:crypto');
  const src = fs.readFileSync(path.join(ROOT, 'integrations/travel_intelligence/SOURCE.txt'), 'utf8');
  assert.ok(src.includes(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'integrations/travel_intelligence/acc_report.py'))).digest('hex')), 'vendored reporter must match its recorded source');
});

test('the register is the public-safe one: no allowances, approvals, approver names or reconciliation notes', () => {
  const R = require('../acc_register.js');
  assert.deepEqual(R.APPROVALS, []);
  assert.deepEqual(R.RECONCILIATION, []);
  assert.equal(R.TI_INTEGRATION, null);
  for (const a of R.AGENTS) {
    for (const [k, v] of Object.entries(a.controls.allowance_eur)) if (k !== 'period_time_zone') assert.equal(v, null, a.name + ' ' + k);
    assert.equal(a.integration.state, 'none');
  }
  const text = fs.readFileSync(path.join(ROOT, 'acc_register.js'), 'utf8');
  assert.doesNotMatch(text, /cap_eur\s*:\s*[0-9]|approved_by\s*:\s*'/);
});

test('nothing that could hold live data or keys is shipped: no databases, key files, env files or output folders', () => {
  for (const f of files) assert.doesNotMatch(rel(f), /acc_keys\.json|\.sqlite3|(^|\/)\.env($|\.)(?!example)|(^|\/)demo\/out|acc_data/, rel(f));
});

test('this directory cannot reach the published site: the Pages workflow uploads only site/', () => {
  const wf = path.join(ROOT, '..', '.github', 'workflows', 'publish.yml');
  if (!fs.existsSync(wf)) return;
  const t = fs.readFileSync(wf, 'utf8');
  assert.match(t, /path:\s*site\s*$/m);
  assert.doesNotMatch(t, /path:\s*(\.|service)/);
});
