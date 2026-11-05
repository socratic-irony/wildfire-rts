import { spawn } from 'node:child_process';
import { launchChromium } from './browser.mjs';

const PORT = 4176;
const BASE = `http://localhost:${PORT}`;
const SEEDS = [1, 42, 12345, 987654321, 2026];

const server = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BROWSER: 'none' },
});

let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += String(chunk);
});
server.stderr.on('data', (chunk) => {
  serverOutput += String(chunk);
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
  throw new Error(`Vite did not become ready.\n${serverOutput}`);
}

let browser;
try {
  await waitForServer();
  browser = await launchChromium();
  const rows = [];
  const runs = [...SEEDS, SEEDS[0]];
  for (const seed of runs) {
    const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    await page.goto(`${BASE}/?seed=${seed}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__cinderline));
    await page.click('[data-action="start"]');
    await page.evaluate(() => window.__cinderline.advanceTime(480000));
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => window.__cinderline.getState());
    const finite = state.units.every(
      (unit) => Number.isFinite(unit.x) && Number.isFinite(unit.z) && Number.isFinite(unit.water),
    );
    const unresolved = state.incidents.filter((incident) => !incident.resolved).length;
    rows.push({
      seed,
      score: state.scenario.score,
      status: state.scenario.status,
      elapsed: state.scenario.elapsed,
      burned: state.fire.burned,
      standing: state.buildings.standing,
      destroyed: state.buildings.destroyed,
      incidents: state.incidents.length,
      unresolved,
      finite,
      errors,
    });
    await page.close();
    console.log(
      `seed ${String(seed).padEnd(10)} ${state.scenario.status.padEnd(5)} ` +
        `t=${state.scenario.elapsed.toFixed(0).padStart(3)}s ` +
        `burned=${String(state.fire.burned).padStart(4)} ` +
        `standing=${state.buildings.standing} lost=${state.buildings.destroyed} ` +
        `incidents=${state.incidents.length} unresolved=${unresolved} finite=${finite} ` +
        `errors=${errors.length}`,
    );
  }
  const first = rows[0];
  const repeat = rows[rows.length - 1];
  if (
    first.status !== repeat.status ||
    first.score !== repeat.score ||
    first.burned !== repeat.burned ||
    first.elapsed !== repeat.elapsed
  ) {
    console.error(`Seed ${first.seed} is not deterministic:`, first, repeat);
    process.exitCode = 1;
  }
  const bad = rows.filter(
    (row) =>
      !['won', 'lost'].includes(row.status) ||
      !row.finite ||
      row.errors.length > 0 ||
      // Early wins require every incident resolved; a win at the bell may leave a corralled fire open.
      (row.status === 'won' && row.elapsed < 479.9 && row.unresolved > 0),
  );
  if (bad.length > 0) {
    console.error('Unstable runs:', bad);
    process.exitCode = 1;
  } else if (!process.exitCode) {
    console.log(`Stability passed across ${SEEDS.length} seeds; seed ${first.seed} replayed identically.`);
  }
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
