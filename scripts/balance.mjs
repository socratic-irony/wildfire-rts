import { spawn } from 'node:child_process';
import { launchChromium } from './browser.mjs';

/**
 * Hands-off balance report: plays full shifts with auto-dispatch only and
 * reports outcomes, a fire timeline, and any unit that stopped moving while
 * it still had somewhere to be. Exits non-zero on stuck units or errors.
 *
 *   npm run balance                      # default seeds, standard difficulty
 *   SEEDS=1,2,3 DIFFICULTY=redflag npm run balance
 */
const PORT = Number(process.env.PORT ?? 4178);
const BASE = `http://localhost:${PORT}`;
const SEEDS = (process.env.SEEDS ?? '1,42,12345,987654321,2026,7,99,31337')
  .split(',')
  .map((value) => Number.parseInt(value, 10))
  .filter(Number.isFinite);
const DIFFICULTY = process.env.DIFFICULTY ?? '';
const SAMPLE_SECONDS = 30;
const MOVING_STATES = new Set(['moving', 'toIncident', 'returning', 'refilling', 'cutting']);

const server = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BROWSER: 'none' },
});

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/?seed=1`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Vite did not become ready.');
}

let browser;
let failures = 0;
try {
  await waitForServer();
  browser = await launchChromium();
  const tally = { won: 0, lost: 0 };
  for (const seed of SEEDS) {
    const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const query = DIFFICULTY ? `?seed=${seed}&difficulty=${DIFFICULTY}` : `?seed=${seed}`;
    await page.goto(`${BASE}/${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__cinderline));
    await page.evaluate(() => window.__cinderline.start());
    const samples = [];
    let state;
    for (let t = 0; t < 600; t += SAMPLE_SECONDS) {
      state = await page.evaluate((ms) => {
        window.__cinderline.advanceTime(ms);
        return window.__cinderline.getState();
      }, SAMPLE_SECONDS * 1000);
      samples.push(state);
      if (state.scenario.status !== 'running') break;
    }
    const stuck = new Set();
    for (let i = 2; i < samples.length; i += 1) {
      for (const unit of samples[i].units) {
        const a = samples[i - 2].units.find((u) => u.id === unit.id);
        const b = samples[i - 1].units.find((u) => u.id === unit.id);
        if (!a || !b || !MOVING_STATES.has(unit.state)) continue;
        if (unit.state === 'refilling' && /Refilling/.test(unit.status)) continue;
        const still = (p, q) => Math.hypot(p.x - q.x, p.z - q.z) < 0.05;
        if (still(a, b) && still(b, unit) && a.state === unit.state) stuck.add(`${unit.name} ${unit.state} "${unit.status}"`);
      }
    }
    const r = state.scenario;
    tally[r.status] = (tally[r.status] ?? 0) + 1;
    console.log(
      `seed ${String(seed).padEnd(10)} ${r.status.padEnd(5)} t=${r.elapsed.toFixed(0).padStart(3)}s ` +
        `burned=${r.burnedHectares.toFixed(2)}ha lost=${r.structuresLost} contained=${r.incidentsContained}/${state.incidents.length} ` +
        `score=${r.score}`,
    );
    console.log(`   fire: ${samples.map((s) => `${s.scenario.elapsed.toFixed(0)}s:${s.fire.active}`).join(' ')}`);
    if (stuck.size) console.log(`   STUCK: ${[...stuck].join(' | ')}`);
    if (errors.length) console.log(`   ERRORS: ${errors.slice(0, 3).join(' | ')}`);
    if (stuck.size || errors.length) failures += 1;
    await page.close();
  }
  console.log(`\n${tally.won ?? 0} won / ${tally.lost ?? 0} lost across ${SEEDS.length} seeds${DIFFICULTY ? ` (${DIFFICULTY})` : ''}.`);
  if (failures) {
    console.error(`${failures} run(s) had stuck units or browser errors.`);
    process.exitCode = 1;
  }
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
