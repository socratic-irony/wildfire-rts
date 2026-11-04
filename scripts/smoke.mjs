import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4174;
const BASE = `http://localhost:${PORT}`;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

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
      const response = await fetch(`${BASE}/?seed=12345`);
      if (response.ok) return;
    } catch {
      // Keep polling until Vite is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`Vite did not become ready.\n${serverOutput}`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(`${BASE}/?seed=12345`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__cinderline));
  await page.waitForTimeout(500);

  let state = await page.evaluate(() => window.__cinderline.getState());
  assert(state.seed === 12345, 'seed did not round-trip');
  assert(state.units.length === 5, 'expected the full five-unit fleet');
  assert(state.hydrants > 20, 'hydrants were not placed along roads');
  assert(state.roads > 200, 'initial road network is missing');
  assert(state.vegetation > 500, 'vegetation scatter is unexpectedly sparse');

  await page.click('[data-action="start"]');
  await page.waitForTimeout(500);
  state = await page.evaluate(() => window.__cinderline.getState());
  assert(state.started, 'shift did not start');
  assert(state.scenario.status === 'running', 'scenario is not running');

  await page.evaluate(() => window.__cinderline.setAutoDispatch(false));
  const spot = await page.evaluate(() => window.__cinderline.findBurnableNear(40, 28, 12));
  assert(spot, 'no burnable tile found for smoke fire');
  await page.evaluate(({ x, z }) => {
    window.__cinderline.ignite(x, z);
    window.__cinderline.focusTile(x, z);
  }, spot);
  await page.evaluate(() => window.__cinderline.advanceTime(8000));
  state = await page.evaluate(() => window.__cinderline.getState());
  assert(state.fire.active > 0, 'manual fire did not spread');
  assert(state.incidents.length > 0, 'manual fire did not create an incident');

  await page.evaluate(() => window.__cinderline.focusTile(48, 45));
  await page.waitForTimeout(600);
  const unitPosition = await page.evaluate(() => window.__cinderline.unitScreenPosition(1));
  assert(unitPosition, 'engine screen position unavailable');
  await page.mouse.click(unitPosition.x, unitPosition.y);
  await page.waitForTimeout(250);
  state = await page.evaluate(() => window.__cinderline.getState());
  assert(state.units.some((unit) => unit.selected), 'clicking a vehicle did not select it');

  await page.evaluate(() => window.__cinderline.focusTile(48, 45));
  await page.waitForTimeout(500);
  const movePosition = await page.evaluate(() => window.__cinderline.screenPosition(54, 45));
  await page.mouse.click(movePosition.x, movePosition.y, { button: 'right' });
  await page.evaluate(() => window.__cinderline.advanceTime(1500));
  state = await page.evaluate(() => window.__cinderline.getState());
  const engine = state.units.find((unit) => unit.id === 1);
  assert(engine && engine.state !== 'idle', 'move order did not reach the engine');

  const roadLength = await page.evaluate(() => window.__cinderline.buildRoad(50, 52, 56, 52));
  assert(roadLength > 1, 'road planning failed');
  assert((await page.evaluate(() => window.__cinderline.roadFuelMismatches())) === 0, 'new roads did not become fire breaks');

  await page.locator('[data-action="pause"]').click();
  state = await page.evaluate(() => window.__cinderline.getState());
  assert(state.paused, 'pause button did not pause');
  await page.locator('[data-speed="4"]').click();
  state = await page.evaluate(() => window.__cinderline.getState());
  assert(!state.paused && state.speed === 4, 'speed control did not resume at 4x');

  await page.locator('.toolbar [data-action="help"]').click();
  assert(await page.locator('#help-overlay').evaluate((el) => el.classList.contains('visible')), 'help overlay did not open');
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.__cinderline.setAutoDispatch(true));
  await page.evaluate(() => window.__cinderline.advanceTime(480000));
  await page.waitForTimeout(700);
  state = await page.evaluate(() => window.__cinderline.getState());
  assert(state.scenario.status === 'won' || state.scenario.status === 'lost', 'scenario never reached an outcome');
  assert(await page.locator('#end-screen').evaluate((el) => el.classList.contains('visible')), 'end screen did not show');
  assert(errors.length === 0, `browser errors:\n${errors.join('\n')}`);

  console.log(
    `Smoke passed: ${state.scenario.status}, ${state.scenario.incidentsContained} incidents, ${state.scenario.structuresStanding} structures standing.`,
  );
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
