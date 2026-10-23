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

const results = [];
const check = (name, ok, detail = '') => { results.push({ check: name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ': ' + detail : '')); };

const server = await serve(0);
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

async function open(viewport, label) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Europe/Nicosia' });
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
  check('desktop: provisional agent shows no verified code', /No verified code/.test(await page.locator('#detailContent').textContent()) || /interim/i.test(await page.locator('#detailContent').textContent()));
  await page.click('#detailClose');

  await page.locator('#agentGrid').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '05_agent_register_strip.png'), fullPage: true });

  const external = requests.filter(u => !u.startsWith(base));
  check('desktop: zero requests outside the page origin', external.length === 0, external.join(', '));
  check('desktop: only static files requested', requests.every(u => /\/(index\.html|acc_core\.js|acc_register\.js|status\.json|)$/.test(new URL(u).pathname)), requests.join(', '));
  check('desktop: no console errors or warnings', problems.length === 0, problems.join(' | '));
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
