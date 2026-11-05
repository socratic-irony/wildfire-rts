import { spawn } from 'node:child_process';
import { launchChromium } from '../scripts/browser.mjs';
const PORT = 4181, BASE = `http://localhost:${PORT}`;
const server = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: ['ignore','pipe','pipe'] });
async function wait() { const dl = Date.now()+30000; while (Date.now()<dl) { try { const r = await fetch(`${BASE}/?seed=1`); if (r.ok) return; } catch {} await new Promise(r=>setTimeout(r,250)); } throw new Error('no server'); }
let browser;
try {
  await wait();
  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/?seed=12345`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__cinderline));
  await page.click('[data-action="start"]');
  await page.evaluate(() => window.__cinderline.setAutoDispatch(false));
  const spot = await page.evaluate(() => window.__cinderline.findBurnableNear(40, 28, 12));
  await page.evaluate(({ x, z }) => { window.__cinderline.ignite(x, z); window.__cinderline.focusTile(x, z); }, spot);
  await page.evaluate(() => window.__cinderline.advanceTime(8000));
  await page.evaluate(() => window.__cinderline.focusTile(48, 45));
  await page.waitForTimeout(600);
  const unitPosition = await page.evaluate(() => window.__cinderline.unitScreenPosition(1));
  console.log('unitPos', unitPosition, await page.evaluate(() => window.__cinderline.getState().units[0]));
  await page.mouse.click(unitPosition.x, unitPosition.y);
  await page.waitForTimeout(250);
  console.log('selected', await page.evaluate(() => window.__cinderline.getState().units.filter(u=>u.selected).map(u=>u.name)));
  await page.evaluate(() => window.__cinderline.focusTile(48, 45));
  await page.waitForTimeout(500);
  const movePosition = await page.evaluate(() => window.__cinderline.screenPosition(54, 45));
  await page.mouse.click(movePosition.x, movePosition.y, { button: 'right' });
  const toasts = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t=>t.textContent));
  console.log('toasts', toasts);
  console.log('after click', await page.evaluate(() => window.__cinderline.getState().units[0]));
  await page.evaluate(() => window.__cinderline.advanceTime(1500));
  console.log('after 1.5s', await page.evaluate(() => window.__cinderline.getState().units[0]));
} finally { if (browser) await browser.close(); server.kill('SIGTERM'); }
