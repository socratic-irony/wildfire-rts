import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchChromium } from './browser.mjs';

/**
 * Screenshots of the model lab (models.html) for checking vehicle and
 * building models. `OUT` sets the folder (default docs/screenshots),
 * `VIEWS` a semicolon-separated list of lab query strings, `PORT` the dev-server port.
 */
const PORT = Number(process.env.PORT ?? 4176);
const BASE = `http://localhost:${PORT}`;
const OUT = resolve(process.env.OUT ?? 'docs/screenshots');
const VIEWS = (
  process.env.VIEWS ?? 'view=vehicles&size=17&x=-1&z=-2;view=buildings&size=24&x=-9&z=-3&yaw=0.6&pitch=0.85;view=buildings&size=24&x=-6&z=3&yaw=3.74&pitch=0.85'
)
  .split(';')
  .map((item) => item.trim())
  .filter(Boolean);

mkdirSync(OUT, { recursive: true });
const server = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BROWSER: 'none' },
});

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/models.html`);
      if (response.ok) return;
    } catch {
      // Keep polling until Vite is listening.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('Vite did not become ready.');
}

let browser;
try {
  await waitForServer();
  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  for (const [i, query] of VIEWS.entries()) {
    await page.goto(`${BASE}/models.html?${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__modelLabReady));
    await page.waitForTimeout(900);
    const name = `models-${i + 1}.png`;
    await page.screenshot({ path: resolve(OUT, name) });
    console.log(`${name}: ${query}`);
  }
  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
