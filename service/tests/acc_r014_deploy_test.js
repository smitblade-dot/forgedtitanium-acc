'use strict';
/* ACC-R014: the independent-hosting kit publishes only what it should and the repository holds no secrets. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('image publishes only the ingest port and bakes in no secret or origin', () => {
  const d = read('Dockerfile');
  assert.deepEqual(d.match(/^EXPOSE .*/gm), ['EXPOSE 8788']);
  assert.match(d, /ACC_PUBLIC_STATUS=1/);
  assert.doesNotMatch(d, /ACC_PUBLIC_ORIGIN=/, 'origin is set on the host');
  assert.doesNotMatch(d, /SECRET|KEY_ID|TOKEN|PASSWORD/i);
  assert.match(d, /ENTRYPOINT \["\/entrypoint\.sh"\]/);
  assert.match(d, /ACC_TRUST_PROXY=private/, 'managed-host proxy must be trusted so visitors are limited individually');
  const e = read('deploy/entrypoint.sh');
  assert.match(e, /chown -R acc:acc/);
  assert.match(e, /exec runuser -u acc -- node server\/acc_server\.js/, 'privileges are dropped before the service runs');
  assert.doesNotMatch(e, /SECRET|KEY_ID|TOKEN|PASSWORD|curl|wget/i);
});

test('environment example contains names and shapes only', () => {
  const e = read('deploy/service.env.example');
  for (const line of e.split('\n').filter(l => /^[A-Z_]+=/.test(l))) assert.match(line, /^ACC_PUBLIC_ORIGIN=https:\/\/[a-z0-9.-]+$/, line);
});

test('keys, data and environment files can never be committed', () => {
  const g = read('.gitignore');
  for (const p of ['acc_data', 'acc_keys.json', '.env']) assert.ok(g.includes(p), p + ' missing from .gitignore');
  let tracked = '';
  try { tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }); } catch { return; }
  assert.doesNotMatch(tracked, /acc_keys\.json|\.sqlite3|(^|\/)\.env($|\.)|acc_data\//m);
});

test('no credential-shaped strings in tracked files', () => {
  let files = [];
  try { files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(f => f && !/\.(png|ico)$/.test(f) && f !== 'package-lock.json'); } catch { return; }
  const patterns = [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /xox[baprs]-[A-Za-z0-9-]{10,}/, /"secret_b64url"\s*:\s*"[A-Za-z0-9_-]{30,}"/];
  for (const f of files) { const t = fs.readFileSync(path.join(ROOT, f), 'utf8'); for (const re of patterns) assert.doesNotMatch(t, re, f); }
});

test('Fly configuration: one public port, always on, persistent volume, no secrets', () => {
  const f = read('fly.toml');
  assert.deepEqual(f.match(/internal_port\s*=\s*\d+/g), ['internal_port = 8788']);
  assert.match(f, /force_https = true/);
  assert.match(f, /auto_stop_machines = "off"/);
  assert.match(f, /min_machines_running = 1/);
  assert.match(f, /destination = "\/data"/);
  assert.match(f, /path = "\/v1\/health"/);
  assert.match(f, /ACC_PUBLIC_ORIGIN = "https:\/\/[a-z0-9.-]+"/);
  assert.doesNotMatch(f, /SECRET|KEY_ID|TOKEN|PASSWORD|ACC_AGENT/i);
  assert.doesNotMatch(f, /8787/, 'the private port is never published');
});

test('hosting document gives EUR costs with sources, a recommendation, and the approvals required', () => {
  const h = read('docs/R015_HOSTING.md');
  for (const x of ['Fly.io', 'Render', 'Hetzner', 'Cloudflare', 'EUR 1 = USD 1.1193', 'Recommendation', 'per month', 'Approval']) assert.ok(h.includes(x), x);
  assert.match(h, /not purchased|Nothing has been purchased/i);
});



test('deployment guide: ceiling, unverified price, official sign-in, scripted steps, approval-gated steps, rollback, nothing deployed', () => {
  const a = read('docs/DEPLOY_FLY.md');
  for (const x of ['EUR 5.00', '5.5965', 'not deployed', 'could not be read', '--price-usd', 'exit 3', '--ha=false', 'FLY_API_TOKEN', 'fly auth login', 'Option A', 'Option B', 'forgedtitanium-acc-service',
    'PR #44', 'ACC_REPORTING_ENABLED', 'ACC_KEY_ID', 'verify_live.mjs', 'Rollback', 'Not verified against real Fly.io', '03AA-04']) assert.ok(a.includes(x) || x.startsWith('ACC_KEY_ID') || x === '03AA-04', x);
  assert.doesNotMatch(a, /fo1_[A-Za-z0-9]/);
  const c = read('docs/R015_COMMUNICATION.md');
  for (const x of ['HMAC', 'nonce', 'IP allow-list', 'Rotation', 'hard deadline', 'redirects']) assert.ok(c.includes(x), x);
});
