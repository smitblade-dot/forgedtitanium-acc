'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.join(__dirname, '..', 'site');
const files = fs.readdirSync(SITE, { recursive: true }).filter(f => fs.statSync(path.join(SITE, f)).isFile()).sort();
const text = f => fs.readFileSync(path.join(SITE, f), 'utf8');

test('published file set is exactly the public-safe frontend', () => {
  assert.deepEqual(files, ['.nojekyll', 'acc_core.js', 'acc_register.js', 'index.html']);
});

test('no network calls, storage or third-party requests in shipped code', () => {
  for (const f of files.filter(f => /\.(js|html)$/.test(f))) {
    const t = text(f);
    for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /EventSource/, /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /importScripts/])
      assert.doesNotMatch(t, re, f + ' must not match ' + re);
    const urls = (t.match(/https?:\/\/[^\s'"`)<>]+/g) || []).filter(u => !/^http:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink)$/.test(u));
    assert.deepEqual(urls, [], f + ' references external URLs');
  }
  assert.doesNotMatch(text('index.html'), /<link[^>]+href="https?:/);
  assert.doesNotMatch(text('index.html'), /<script[^>]+src="https?:/);
});

test('no credentials, keys, private endpoints or internal operational metadata', () => {
  const forbidden = [/\bMarc\b/, /\bsecret/i, /ACC_KEY_ID/, /ACC_AGENT_SECRET/, /ACC_REPORT/, /\/v1\//, /127\.0\.0\.1/, /localhost/i, /\bNUC\b/, /cloudflared/i, /tailscale/i,
    /viewer ?token/i, /bearer/i, /hmac/i, /password/i, /BEGIN [A-Z ]*KEY/, /ghp_[A-Za-z0-9]{10,}/, /github_pat_/, /AKIA[0-9A-Z]{12,}/, /[\w.+-]+@[\w-]+\.[\w.]+/,
    /feature\/03aa-04-acc-reporting/, /f0e8e37/, /acc_data/, /X-ACC-/];
  for (const f of files.filter(f => /\.(js|html)$/.test(f))) {
    const t = text(f);
    for (const re of forbidden) assert.doesNotMatch(t, re, f + ' must not match ' + re);
  }
});

test('public register carries no allowances, approvals, integrations or reconciliation notes', () => {
  const R = require('../site/acc_register.js');
  assert.deepEqual(R.APPROVALS, []);
  assert.deepEqual(R.RECONCILIATION, []);
  assert.equal(R.TI_INTEGRATION, null);
  for (const a of R.AGENTS) {
    assert.equal(a.integration.state, 'none', a.name);
    assert.deepEqual(Object.values(a.controls.allowance_eur).filter(v => v !== null && v !== 'Europe/Nicosia'), [], a.name + ' allowance must be unset');
    assert.doesNotMatch(JSON.stringify(a.integration), /key|secret|branch|variable/i);
  }
});

test('deployment workflow is gated and only ever publishes site/', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'publish.yml'), 'utf8');
  assert.match(wf, /workflow_dispatch/);
  assert.doesNotMatch(wf, /^\s*(push|pull_request|schedule):/m, 'publish must never run automatically');
  assert.match(wf, /ACC_PUBLISH_APPROVED/);
  assert.match(wf, /path:\s*site/);
  assert.doesNotMatch(wf, /secrets\./, 'publish needs no secrets');
});

test('no credential-shaped strings anywhere in the repository (excluding dependencies)', () => {
  const root = path.join(__dirname, '..');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    if (['node_modules', '.git'].includes(e.name)) return [];
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  const patterns = [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /xox[baprs]-[A-Za-z0-9-]{10,}/, /sk-[A-Za-z0-9]{32,}/];
  for (const f of walk(root).filter(f => !/\.(png|jpg|ico)$/.test(f) && !/package-lock\.json$/.test(f))) {
    const t = fs.readFileSync(f, 'utf8');
    for (const re of patterns) assert.doesNotMatch(t, re, path.relative(root, f) + ' must not match ' + re);
  }
});
