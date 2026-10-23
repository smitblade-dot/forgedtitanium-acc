'use strict';
/* ACC-R016: the Fly.io activation and key-provisioning scripts, tested offline with stub `fly`, `gh` and `curl` programs.
   Proves the cost guard, the single-machine guard, and that no secret is ever printed or passed on a command line. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ACTIVATE = path.join(ROOT, 'deploy/activate_fly.sh');
const PROVISION = path.join(ROOT, 'deploy/provision_agent_keys.sh');
const SECRET = 'SECRETSTUBVALUE0123456789abcdefghijklmnopqrs';
const TOKEN = 'fo1_TOKENSTUBVALUE_do_not_print';

function sandbox(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc16-'));
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  const log = path.join(dir, 'calls.log'), stdinFile = path.join(dir, 'secret.stdin');
  const w = (n, body) => { fs.writeFileSync(path.join(bin, n), '#!/usr/bin/env bash\n' + body + '\n', { mode: 0o755 }); };
  w('fly', `echo "fly $*" >> "${log}"
case "$1 $2" in
  "apps list") if [ -n "$STUB_APP_EXISTS" ]; then echo '[{"Name": "forgedtitanium-acc-service"}]'; else echo '[]'; fi ;;
  "volumes list") if [ -n "$STUB_VOLUME_EXISTS" ]; then echo '[{"name": "acc_data"}]'; else echo '[]'; fi ;;
  "machines list") n=\${STUB_MACHINES:-1}; printf '['; for i in $(seq 1 $n); do [ $i -gt 1 ] && printf ','; printf '{"id":"m%s"}' $i; done; echo ']' ;;
  "ssh console") if [ -n "$STUB_SSH_FAIL" ]; then echo 'error: no machine'; else printf 'Connecting...\\n{\\n  "key_id": "key_stub0001",\\n  "secret_b64url": "${SECRET}"\\n}\\nStore the secret now.\\n'; fi ;;
esac
exit 0`);
  w('gh', `echo "gh $* [GH_TOKEN=\${GH_TOKEN:+set}]" >> "${log}"
if [ "$1 $2" = "secret set" ]; then cat > "${stdinFile}"; fi
exit 0`);
  w('curl', `if [ -n "$STUB_HEALTH_FAIL" ]; then exit 22; fi; echo -n '{"ok":true}'`);
  w('sleep', 'exit 0');
  const run = (script, args, env) => spawnSync('bash', [script, ...args], { env: Object.assign({ PATH: bin + ':' + process.env.PATH, ACC_SKIP_VERIFY: '1' }, env || {}), encoding: 'utf8', timeout: 60000 });
  return { dir, log, stdinFile, run, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []) };
}
const out = r => r.stdout + r.stderr;

test('activation refuses without a token or a price, and creates nothing', () => {
  const sb = sandbox();
  let r = sb.run(ACTIVATE, ['--price-usd', '4.41']);
  assert.equal(r.status, 2); assert.match(out(r), /FLY_API_TOKEN is not set/);
  r = sb.run(ACTIVATE, [], { FLY_API_TOKEN: TOKEN });
  assert.equal(r.status, 2); assert.match(out(r), /--price-usd/);
  r = sb.run(ACTIVATE, ['--price-usd', 'cheap'], { FLY_API_TOKEN: TOKEN });
  assert.equal(r.status, 2);
  assert.deepEqual(sb.calls(), []);
});

test('COST GUARD: a confirmed price above EUR 5 stops everything with exit 3 and creates nothing', () => {
  for (const price of ['5.61', '5.5966', '7.88', '12']) {
    const sb = sandbox();
    const r = sb.run(ACTIVATE, ['--price-usd', price], { FLY_API_TOKEN: TOKEN });
    assert.equal(r.status, 3, price);
    assert.match(out(r), /STOP: confirmed price USD .* exceeds the approved ceiling EUR 5\.00/);
    assert.match(out(r), /owner must approve/);
    assert.deepEqual(sb.calls(), [], 'nothing may be created when the price is over the ceiling (' + price + ')');
  }
});

test('COST GUARD: a price at or under the ceiling passes; the ceiling follows the exchange rate given', () => {
  assert.equal(sandbox().run(ACTIVATE, ['--price-usd', '5.5965'], { FLY_API_TOKEN: TOKEN }).status, 0);
  assert.equal(sandbox().run(ACTIVATE, ['--price-usd', '4.41'], { FLY_API_TOKEN: TOKEN }).status, 0);
  const r = sandbox().run(ACTIVATE, ['--price-usd', '5.30'], { FLY_API_TOKEN: TOKEN, ACC_EUR_USD: '1.05' });   // EUR 5 = USD 5.25 at that rate
  assert.equal(r.status, 3);
});

test('fly.toml must still match what was priced: region, size, memory, volume, one machine', () => {
  const base = fs.readFileSync(path.join(ROOT, 'fly.toml'), 'utf8');
  const variants = [
    ['region', base.replace('primary_region = "fra"', 'primary_region = "iad"')],
    ['memory', base.replace('memory = "512mb"', 'memory = "1gb"')],
    ['size', base.replace('size = "shared-cpu-1x"', 'size = "performance-1x"')],
    ['volume', base.replace('initial_size = "1gb"', 'initial_size = "10gb"')],
    ['two machines', base + '\n[[vm]]\n  size = "shared-cpu-1x"\n  memory = "512mb"\n'],
    ['no always-on', base.replace('min_machines_running = 1', 'min_machines_running = 0')]
  ];
  for (const [name, toml] of variants) {
    const sb = sandbox(); const f = path.join(sb.dir, 'fly.toml'); fs.writeFileSync(f, toml);
    const r = sb.run(ACTIVATE, ['--price-usd', '4.41'], { FLY_API_TOKEN: TOKEN, ACC_FLY_TOML: f });
    assert.equal(r.status, 4, name + ': ' + out(r));
    assert.deepEqual(sb.calls(), [], name + ' must not create anything');
  }
});

test('happy path: validate, create app and volume, deploy WITHOUT high availability, confirm health; token never printed', () => {
  const sb = sandbox();
  const r = sb.run(ACTIVATE, ['--price-usd', '4.41'], { FLY_API_TOKEN: TOKEN });
  assert.equal(r.status, 0, out(r));
  const calls = sb.calls().join('\n');
  const order = ['fly version', 'fly config validate', 'fly apps list', 'fly apps create forgedtitanium-acc-service', 'fly volumes list', 'fly volumes create acc_data', 'fly deploy', 'fly machines list'];
  let at = -1; for (const o of order) { const i = calls.indexOf(o); assert.ok(i > at, o + ' missing or out of order in:\n' + calls); at = i; }
  assert.match(calls, /fly volumes create acc_data --app forgedtitanium-acc-service --region fra --size 1 --yes/);
  assert.match(calls, /fly deploy .*--ha=false/, 'without --ha=false Fly starts a second machine and doubles the cost');
  assert.doesNotMatch(calls, /scale count/);
  assert.ok(!out(r).includes(TOKEN) && !calls.includes(TOKEN), 'the token must never be printed or passed as an argument');
  assert.match(out(r), /Service healthy at https:\/\/forgedtitanium-acc-service\.fly\.dev/);
});

test('a second machine is scaled back to one; existing app and volume are reused, not recreated', () => {
  const sb = sandbox();
  const r = sb.run(ACTIVATE, ['--price-usd', '4.41'], { FLY_API_TOKEN: TOKEN, STUB_MACHINES: '2', STUB_APP_EXISTS: '1', STUB_VOLUME_EXISTS: '1' });
  assert.equal(r.status, 0, out(r));
  const calls = sb.calls().join('\n');
  assert.match(calls, /fly scale count 1 --app forgedtitanium-acc-service --yes/);
  assert.doesNotMatch(calls, /apps create/); assert.doesNotMatch(calls, /volumes create/);
});

test('if the health check never passes, activation stops with exit 5', () => {
  const r = sandbox().run(ACTIVATE, ['--price-usd', '4.41'], { FLY_API_TOKEN: TOKEN, STUB_HEALTH_FAIL: '1' });
  assert.equal(r.status, 5); assert.match(out(r), /did not answer its health check/);
});

test('key provisioning: refuses without tokens, other repositories, or no agent named', () => {
  const sb = sandbox();
  assert.equal(sb.run(PROVISION, ['controller'], { GH_ADMIN_TOKEN: 'x' }).status, 2);
  assert.equal(sb.run(PROVISION, ['controller'], { FLY_API_TOKEN: TOKEN }).status, 2);
  assert.equal(sb.run(PROVISION, [], { FLY_API_TOKEN: TOKEN, GH_ADMIN_TOKEN: 'x' }).status, 2);
  const r = sb.run(PROVISION, ['--repo', 'smitblade-dot/crude-flow-dashboard', 'controller'], { FLY_API_TOKEN: TOKEN, GH_ADMIN_TOKEN: 'x' });
  assert.equal(r.status, 2); assert.match(out(r), /only smitblade-dot\/Travel_Intelligence is in scope/);
  assert.equal(sb.run(PROVISION, ['hacker'], { FLY_API_TOKEN: TOKEN, GH_ADMIN_TOKEN: 'x' }).status, 2);
  assert.deepEqual(sb.calls(), []);
});

test('key provisioning: the secret goes to GitHub only through stdin, is never printed, and reporting is NOT enabled', () => {
  const sb = sandbox();
  const r = sb.run(PROVISION, ['controller'], { FLY_API_TOKEN: TOKEN, GH_ADMIN_TOKEN: 'ghadmin_STUB' });
  assert.equal(r.status, 0, out(r));
  const calls = sb.calls().join('\n');
  assert.ok(!out(r).includes(SECRET), 'secret printed');
  assert.ok(!calls.includes(SECRET), 'secret passed on a command line');
  assert.equal(fs.readFileSync(sb.stdinFile, 'utf8'), SECRET, 'the secret must arrive on stdin exactly');
  assert.match(calls, /gh variable set ACC_REPORT_URL --repo smitblade-dot\/Travel_Intelligence --body https:\/\/forgedtitanium-acc-service\.fly\.dev/);
  assert.match(calls, /gh variable set ACC_KEY_ID_PRODUCTION_CONTROLLER --repo smitblade-dot\/Travel_Intelligence --body key_stub0001/);
  assert.match(calls, /gh secret set ACC_AGENT_SECRET_PRODUCTION_CONTROLLER --repo smitblade-dot\/Travel_Intelligence/);
  assert.doesNotMatch(calls, /ACC_REPORTING_ENABLED/, 'enabling production reporting is a separate owner decision');
  assert.doesNotMatch(calls, /03AA-04_Master|03AA-04_Country/, 'only the named agent is connected');
  assert.match(calls, /fly ssh console --app forgedtitanium-acc-service --command runuser -u acc -- env ACC_DATA_DIR=\/data node \/app\/server\/acc_admin\.js issue-agent-key 03AA-04_Production_Controller_TI/);
  assert.match(calls, /GH_TOKEN=set/, 'gh is run with the admin token, not the ambient one');
  assert.ok(!out(r).includes('ghadmin_STUB'));
});

test('key provisioning: all three agents get their own key and settings; a failed key issue stores nothing', () => {
  const sb = sandbox();
  const r = sb.run(PROVISION, ['master', 'builder', 'controller'], { FLY_API_TOKEN: TOKEN, GH_ADMIN_TOKEN: 'x' });
  assert.equal(r.status, 0, out(r));
  const calls = sb.calls().join('\n');
  for (const s of ['MASTER', 'COUNTRY_BUILDER', 'PRODUCTION_CONTROLLER']) { assert.match(calls, new RegExp('gh variable set ACC_KEY_ID_' + s)); assert.match(calls, new RegExp('gh secret set ACC_AGENT_SECRET_' + s)); }
  const bad = sandbox();
  const f = bad.run(PROVISION, ['controller'], { FLY_API_TOKEN: TOKEN, GH_ADMIN_TOKEN: 'x', STUB_SSH_FAIL: '1' });
  assert.equal(f.status, 5);
  assert.doesNotMatch(bad.calls().join('\n'), /secret set|ACC_KEY_ID/);
});
