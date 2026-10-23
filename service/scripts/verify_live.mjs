// Post-deployment verification for the ACC (ACC-R015). Read-only: it never writes an event.
//   SERVICE_URL=https://<host> SITE_URL=https://smitblade-dot.github.io/forgedtitanium-acc/ [ORIGIN=https://smitblade-dot.github.io]
//   [EXPECT_AGENTS=a,b,c] [--expect-live] [--require-browser] [--allow-http-localhost] node scripts/verify_live.mjs
// Checks the public status feed (safe, small, fresh, CORS), that private paths are not reachable, that unauthenticated and
// badly signed writes are refused, and (with a browser) that the published page shows what the feed says, with no leaks.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = require(path.join(ROOT, 'server/public_status.js'));

const args = process.argv.slice(2), flag = f => args.includes(f);
const SERVICE = (process.env.SERVICE_URL || '').replace(/\/$/, ''), SITE = process.env.SITE_URL || '';
const ORIGIN = process.env.ORIGIN === 'none' ? '' : (process.env.ORIGIN || (SITE ? new URL(SITE).origin : ''));
const EXPECT = (process.env.EXPECT_AGENTS || '').split(',').map(s => s.trim()).filter(Boolean);
const OUT = process.env.OUT || path.join(ROOT, 'demo/out');
if (!SERVICE) { console.error('Set SERVICE_URL'); process.exit(2); }
const checks = []; const check = (n, ok, d = '') => { checks.push({ check: n, ok: !!ok, detail: String(d).slice(0, 300) }); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ': ' + String(d).slice(0, 200) : '')); };
const info = (n, d) => { checks.push({ check: n, ok: true, info: true, detail: String(d).slice(0, 300) }); console.log('INFO ' + n + ': ' + d); };
const get = async (p, init) => { try { const r = await fetch(SERVICE + p, Object.assign({ redirect: 'manual' }, init)); return { status: r.status, headers: r.headers, text: await r.text() }; } catch (e) { return { status: 0, headers: new Headers(), text: '', error: e.message }; } };

const local = /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(SERVICE);
check('service address is https', SERVICE.startsWith('https://') || (flag('--allow-http-localhost') && local), SERVICE);

const h = await get('/v1/health');
check('health answers {"ok":true} and reveals nothing else', h.status === 200 && h.text === '{"ok":true}', h.status + ' ' + h.text.slice(0, 80));

const s = await get('/public/status.json', { headers: ORIGIN ? { Origin: ORIGIN } : {} });
let doc = null; try { doc = JSON.parse(s.text); } catch {}
check('public status answers 200 JSON', s.status === 200 && !!doc, 'status ' + s.status);
if (doc) {
  let safe = false; try { P.assertPublicSafe(doc); safe = true; } catch (e) { info('allowlist failure', e.message); }
  check('public status passes the strict allowlist', safe);
  check('public status is small (under 20 KB)', s.text.length < 20000, s.text.length + ' bytes');
  check('public status is fresh (generated within 5 minutes)', Math.abs(Date.now() - Date.parse(doc.generated_at_utc)) < 5 * 60000, doc.generated_at_utc);
  check('CORS allows only the published site origin', !ORIGIN || s.headers.get('access-control-allow-origin') === ORIGIN, String(s.headers.get('access-control-allow-origin')));
  check('cacheable for a short time', /max-age=\d+/.test(s.headers.get('cache-control') || ''), s.headers.get('cache-control'));
  const t = s.text;
  check('no credential-shaped or key-like text in the feed', !/(secret|bearer|password|private key|ghp_|AKIA|sk-[A-Za-z0-9]{20})/i.test(t) && !/key_[0-9a-f]{8,}/i.test(t) && !/[A-Za-z0-9_-]{43}/.test(t.replace(/03AA-[A-Za-z0-9_]+/g, '')));
  const by = c => doc.agents.find(a => a.agent_id === c);
  for (const c of EXPECT) {
    const a = by(c);
    check('agent registered in the feed: ' + c, !!a);
    if (a) {
      if (flag('--expect-live')) check('agent has genuine recent reports: ' + c, a.state_reason === 'reported' && a.reports_24h > 0, a.state + ' / ' + a.state_reason + ' / ' + a.reports_24h + ' reports in 24 h');
      else info('agent state: ' + c, a.state + ' (' + a.state_reason + '), last report ' + a.last_report_utc);
    }
  }
}

for (const p of ['/v1/events', '/v1/audit', '/v1/audit/verify', '/v1/summary', '/v1/rejections', '/index.html', '/acc_core.js', '/acc_register.js', '/.env', '/acc_data/acc_keys.json', '/server/acc_server.js', '/public/../v1/audit', '/public/status.json/../../v1/audit'])
  { const r = await get(p); check('private path is not reachable: ' + p, r.status === 404 || r.status === 400, r.status); }
const w1 = await get('/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"version":"1.1","events":[]}' });
check('an unauthenticated write is refused (401)', w1.status === 401, w1.status);
const w2 = await get('/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ACC-Key-Id': 'key_verify', 'X-ACC-Timestamp': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), 'X-ACC-Nonce': crypto.randomBytes(16).toString('hex'), 'X-ACC-Signature': '0'.repeat(64) }, body: '{"version":"1.1","events":[]}' });
check('a badly signed write is refused (401)', w2.status === 401, w2.status);

if (SITE) {
  let chromium = null; try { ({ chromium } = await import('playwright-core')); } catch {}
  const CHROME = [process.env.ACC_CHROME, '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
  if (!chromium || !CHROME) { check('browser available for the page check', !flag('--require-browser'), 'skipped: no Chromium'); }
  else {
    fs.mkdirSync(OUT, { recursive: true });
    const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    const page = await (await b.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Nicosia', locale: 'en-GB' })).newPage();
    const problems = [], reqs = [];
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
    page.on('pageerror', e => problems.push(e.message));
    page.on('request', q => reqs.push(q.url()));
    await page.goto(SITE, { waitUntil: 'load' });
    await page.waitForSelector('#orbit .node');
    await page.waitForTimeout(3000);
    const allowed = new Set([new URL(SITE).origin, new URL(SERVICE).origin]);
    check('page requests go only to the site and the reporting service', reqs.every(u => u.startsWith('data:') || allowed.has(new URL(u).origin)), [...new Set(reqs.map(u => new URL(u).origin))].join(' '));
    check('page has no console errors or warnings', problems.length === 0, problems.join(' | '));
    check('orbital intact: core plus six streams', (await page.locator('#orbit .node').count()) === 7);
    const notice = await page.locator('#notice').textContent();
    info('page notice', notice.trim());
    if (doc) {
      const stateLabel = { active: 'Active', idle: 'Idle', failed: 'Failed', disconnected: 'Disconnected', awaiting_approval: 'Awaiting approval', unknown: 'Unknown' };
      for (const a of doc.agents.filter(x => x.agent_id)) {
        const txt = (await page.locator('#agentGrid .agent', { hasText: a.agent_id }).first().textContent().catch(() => '')).replace(/\s+/g, ' ');
        const shown = a.state_reason === 'reported' ? stateLabel[a.state] : 'Unknown';
        check('page shows the feed state for ' + a.agent_id, txt.includes(shown), 'feed=' + a.state + '/' + a.state_reason + ' page=' + txt.slice(0, 70));
        if (a.last_report_utc && a.state_reason === 'reported') check('page labels the time EET or EEST for ' + a.agent_id, /\d{2}:\d{2} (EEST|EET)/.test(txt), txt.slice(0, 70));
      }
    }
    const body = await page.evaluate(() => { const c = document.body.cloneNode(true); c.querySelectorAll('script,style').forEach(n => n.remove()); return c.textContent; });
    check('page text contains no credential-like or internal text', !/(secret|bearer|password|ghp_|acc_keys|violation|allowance|€\s?\d)/i.test(body));
    await page.screenshot({ path: path.join(OUT, 'live_verification.png') });
    await b.close();
  }
}
const bad = checks.filter(c => !c.ok);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'live_verification.json'), JSON.stringify({ at_utc: new Date().toISOString(), service: SERVICE, site: SITE, passed: checks.filter(c => c.ok && !c.info).length, failed: bad.length, checks }, null, 2));
console.log('\n' + (checks.filter(c => !c.info).length - bad.length) + '/' + checks.filter(c => !c.info).length + ' verification checks passed');
process.exit(bad.length ? 1 : 0);
