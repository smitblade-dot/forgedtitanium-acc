// Visual checks (Playwright + headless Chromium): screenshots plus layout and network assertions.
// Run: npm run test:visual   (writes screenshots/ and screenshots/results.json; exits non-zero on failure)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../../scripts/serve.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = [process.env.ACC_CHROME, '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
if (!CHROME) { console.error('No Chromium/Chrome found. Set ACC_CHROME.'); process.exit(2); }

// The one approved external address (the ACC service's restricted public status). The checks stay hermetic: the browser's request
// to it is answered locally with the committed empty status document, so no test depends on the live service or its CORS rules.
const APPROVED = 'https://forgedtitanium-acc-service.fly.dev/public/status.json';
const EMPTY_STATUS = fs.readFileSync(path.join(ROOT, 'site', 'status.json'), 'utf8');

const results = [];
const check = (name, ok, detail = '') => { results.push({ check: name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ': ' + detail : '')); };

const server = await serve(0);
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

async function open(viewport, label) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Europe/Nicosia' });
  await ctx.route(APPROVED, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: EMPTY_STATUS }));
  const page = await ctx.newPage();
  const problems = [], requests = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('request', r => requests.push(r.url()));
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForSelector('#orbit .node');
  return { ctx, page, problems, requests, label };
}
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ---------- desktop ----------
{
  const { ctx, page, problems, requests } = await open({ width: 1440, height: 900 }, 'desktop');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '01_desktop_home.png') });
  check('desktop: orbital has 00 core and six streams', (await page.locator('#orbit .node').count()) === 7);
  check('desktop: 31 clickable Level 2 labels', (await page.locator('#orbit .sublink').count()) === 31);
  check('desktop: no horizontal overflow', (await overflow(page)) <= 0);
  const pos = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#orbit .node')].map(n => { const b = n.getBoundingClientRect(); return [n.dataset.id, [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]]; })));
  const c = pos['00'];
  check('desktop: 01 above core, 04 below, 02/03 right, 05/06 left (approved layout)',
    pos['01'][1] < c[1] && pos['04'][1] > c[1] && pos['02'][0] > c[0] && pos['03'][0] > c[0] && pos['05'][0] < c[0] && pos['06'][0] < c[0] && pos['02'][1] < pos['03'][1] && pos['06'][1] < pos['05'][1], JSON.stringify(pos));

  const earthPx = await page.evaluate(() => { const c = document.getElementById('earth'); const x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < x.length; i += 4) if (x[i] > 40) n++; return { n, w: c.width }; });
  check('desktop: holographic Earth is drawn on its canvas', earthPx.n > 20000, JSON.stringify(earthPx));
  check('desktop: one orb per registered agent beside its stream', (await page.locator('#satLayer .sat').count()) === 8);
  check('desktop: backdrop canvas covers the viewport', await page.evaluate(() => { const c = document.getElementById('fxBg'); return c.width >= innerWidth && c.height >= innerHeight; }));
  const dom = await page.evaluate(() => { const r = document.getElementById('orbit').getBoundingClientRect(); return { w: r.width / innerWidth, h: r.height / innerHeight }; });
  check('desktop: the orbital network dominates the screen', dom.w >= .85 && dom.h >= .6, JSON.stringify(dom));
  const overlap = await page.evaluate(() => { const nodes = [...document.querySelectorAll('#orbit .node')].map(n => n.getBoundingClientRect()); const hits = [];
    for (const h of document.querySelectorAll('.hud')) { const a = h.getBoundingClientRect(); for (const b of nodes) if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) hits.push(h.className); } return hits; });
  check('desktop: supporting instruments never cover the orbital nodes', overlap.length === 0, overlap.join(','));
  check('desktop: no conventional boxed panels on the first screen', await page.evaluate(() => [...document.querySelectorAll('.hud, .hud-top, .dock, .strip-grid, .agent, .kpi, .kpis, .rows, .rows li, .feedline, .keylist, .keylist li')].filter(e => getComputedStyle(e).display !== 'none').every(e => { const s = getComputedStyle(e); const boxed = ['Top', 'Right', 'Bottom', 'Left'].every(k => parseFloat(s['border' + k + 'Width']) > 0 && s['border' + k + 'Style'] !== 'none'); return !boxed && s.clipPath === 'none'; })));
  await page.waitForTimeout(1800);
  const perf = await page.evaluate(() => window.ACC_PERF && window.ACC_PERF());
  check('desktop: Earth animation stays within its frame budget (adaptive quality)', perf && perf.earthMs < 60, JSON.stringify(perf));
  await page.screenshot({ path: path.join(OUT, '01c_desktop_level00.png') });
  // the individual agent command interface
  await page.locator('#agentGrid .agent', { hasText: 'TI Operations Director' }).click();
  await page.waitForSelector('#agentModal.open'); await page.waitForTimeout(700);
  const geo = await page.evaluate(() => { const cx = document.getElementById('core').getBoundingClientRect(), c = { x: cx.left + cx.width / 2, y: cx.top + cx.height / 2 };
    const inDisc = id => { const g = document.createRange(); g.selectNodeContents(document.getElementById(id)); const r = g.getBoundingClientRect(); return [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].every(([x, y]) => Math.hypot(x - c.x, y - c.y) <= cx.width * .23); };
    const ds = [...document.querySelectorAll('#detailTabs button')].map(b => { const r = b.getBoundingClientRect(); return Math.hypot(r.left + r.width / 2 - c.x, r.top + r.height / 2 - c.y) / cx.width; });
    return { name: inDisc('detailName'), state: inDisc('detailState'), fresh: inDisc('detailFresh'), spread: Math.max(...ds) - Math.min(...ds), radius: ds[0] };
  });
  check('desktop: agent core text sits inside the holographic core', geo.name && geo.state && geo.fresh, JSON.stringify(geo));
  check('desktop: five radial navigation nodes on one circle around the core', geo.spread < .01 && geo.radius > .3, JSON.stringify(geo));
  await page.screenshot({ path: path.join(OUT, '01d_desktop_master_console.png') });
  await page.locator('#detailTabs button').nth(2).click(); await page.waitForTimeout(300);
  check('desktop: selecting a radial node opens its holographic panel', /Performance/i.test(await page.locator('#detailPaneTitle').textContent()));
  await page.click('#crumbCompany'); await page.waitForTimeout(500);
  check('desktop: return path leads back to the company view', !(await page.locator('#agentModal.open').count()));
  const box0 = await page.evaluate(() => document.getElementById('orbit').getAttribute('viewBox'));
  await page.click('#node01'); await page.waitForTimeout(900);
  const box1 = await page.evaluate(() => document.getElementById('orbit').getAttribute('viewBox'));
  check('desktop: selecting a stream flies the camera in (smooth zoom)', box1 !== box0 && Number(box1.split(' ')[2]) < 1200, box0 + ' -> ' + box1);
  await page.click('#panelClose'); await page.waitForTimeout(900);
  check('desktop: closing returns the camera to the approved full view', (await page.evaluate(() => document.getElementById('orbit').getAttribute('viewBox'))) === box0);
  await page.screenshot({ path: path.join(OUT, '01b_desktop_after_zoom.png') });
  await page.click('#node03');
  await page.click('#orbit .sublink[data-stream="03"][data-sub="3"]');
  await page.waitForSelector('#subDetail');
  await page.screenshot({ path: path.join(OUT, '02_stream_03_level2_detail.png') });
  check('desktop: Level 2 detail opens with homed agents', (await page.locator('#subDetail .agentlink').count()) >= 3);

  await page.locator('#subDetail .agentlink', { hasText: 'Country Intelligence Builder' }).click();
  await page.waitForSelector('#agentModal.open');
  const tabs = await page.locator('#detailTabs button').allTextContents();
  check('desktop: agent detail has five sections', tabs.length === 5, tabs.join(' / '));
  const names = ['overview', 'activity', 'history', 'performance', 'controls'];
  for (let i = 0; i < 5; i++) { await page.locator('#detailTabs button').nth(i).click(); await page.screenshot({ path: path.join(OUT, `03_agent_verified_${i + 1}_${names[i]}.png`) }); }
  await page.click('#detailClose');

  await page.locator('#agentGrid .agent', { hasText: 'Agent SQE' }).click();
  await page.waitForSelector('#agentModal.open');
  await page.screenshot({ path: path.join(OUT, '04_agent_provisional_overview.png') });
  check('desktop: provisional agent shows no verified code', /No verified code/.test(await page.locator('#detailCode').textContent()));
  await page.click('#detailClose');

  await page.locator('#agentGrid').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '05_agent_register_strip.png'), fullPage: true });

  const external = requests.filter(u => !u.startsWith(base) && u !== APPROVED);
  check('desktop: zero requests outside the page origin except the one approved status address', external.length === 0, external.join(', '));
  check('desktop: only static files requested', requests.every(u => /\/(index\.html|acc_core\.js|acc_register\.js|acc_visual\.js|status\.json|assets\/node-0[1-6]\.jpg|)$/.test(new URL(u).pathname)), requests.join(', '));
  check('desktop: no console errors or warnings', problems.length === 0, problems.join(' | '));
  await ctx.close();
}

// ---------- reduced motion ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.route(APPROVED, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: EMPTY_STATUS }));
  const page = await ctx.newPage(); await page.goto(base + '/', { waitUntil: 'load' }); await page.waitForSelector('#orbit .node'); await page.waitForTimeout(800);
  const running = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && !(a instanceof CSSTransition)).length);
  check('reduced motion: no decorative animation is running', running === 0, String(running));
  const b0 = await page.evaluate(() => document.getElementById('orbit').getAttribute('viewBox')); await page.click('#node03'); await page.waitForTimeout(150);
  check('reduced motion: camera moves without a tween', (await page.evaluate(() => document.getElementById('orbit').getAttribute('viewBox'))) !== b0);
  await ctx.close();
}

// ---------- mobile ----------
{
  const { ctx, page, problems } = await open({ width: 390, height: 844 }, 'mobile');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '06_mobile_home.png'), fullPage: true });
  check('mobile: no horizontal overflow', (await overflow(page)) <= 0, String(await overflow(page)));
  await page.locator('#node01').dispatchEvent('click');
  await page.waitForSelector('#panel.show');
  await page.screenshot({ path: path.join(OUT, '07_mobile_stream_panel.png') });
  check('mobile: stream panel Level 2 labels are readable', (await page.locator('#panel button.sublink:visible').count()) === 6);
  check('mobile: sub-stream labels are not drawn on the small orbit', (await page.locator('#orbit .sublink:visible').count()) === 0);
  await page.locator('#panel ul.rows .agentlink').first().click();
  await page.waitForSelector('#agentModal.open');
  await page.screenshot({ path: path.join(OUT, '08_mobile_agent_detail.png') });
  check('mobile: agent detail fits the viewport', (await overflow(page)) <= 0);
  check('mobile: no console errors or warnings', problems.length === 0, problems.join(' | '));
  await ctx.close();
}

// ---------- tablet ----------
{
  const { ctx, page } = await open({ width: 820, height: 1180 }, 'tablet');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '09_tablet_home.png'), fullPage: true });
  check('tablet: no horizontal overflow', (await overflow(page)) <= 0);
  await ctx.close();
}

await browser.close(); server.close();
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ chrome: CHROME, results }, null, 2));
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} visual checks passed`);
process.exit(failed.length ? 1 : 0);
