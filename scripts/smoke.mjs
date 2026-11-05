import { spawn } from 'node:child_process';
import { launchChromium } from './browser.mjs';

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
  browser = await launchChromium();
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

  // HUD controls must not swallow keyboard camera input once clicked.
  await page.click('.fleet-panel .switch');
  state = await page.evaluate(() => window.__cinderline.getState());
  assert(state.units.every((unit) => !unit.auto), 'ALL AUTO switch did not put every unit on manual');
  await page.click('.fleet-panel .switch');
  await page.locator('[data-unit-auto="2"]').click();
  state = await page.evaluate(() => window.__cinderline.getState());
  assert(state.units.find((unit) => unit.id === 2)?.auto === false, 'AUTO chip did not toggle the unit');
  assert(state.units.filter((unit) => unit.auto).length === 4, 'AUTO chip changed other units');
  const cameraBefore = state.camera;
  await page.keyboard.down('d');
  await page.waitForTimeout(900);
  await page.keyboard.up('d');
  await page.waitForTimeout(150);
  const cameraAfter = (await page.evaluate(() => window.__cinderline.getState())).camera;
  assert(
    Math.hypot(cameraAfter.x - cameraBefore.x, cameraAfter.z - cameraBefore.z) > 0.5,
    'D did not pan the camera after clicking HUD controls',
  );

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

  // Command layer: plan overlay, dozer line, backburn, mutual aid.
  await page.evaluate(() => window.__cinderline.focusTile(48, 45));
  await page.waitForTimeout(400);
  await page.keyboard.press('b');
  const roadA = await page.evaluate(() => window.__cinderline.screenPosition(46, 40));
  const roadB = await page.evaluate(() => window.__cinderline.screenPosition(52, 40));
  await page.mouse.click(roadA.x, roadA.y);
  await page.mouse.move(roadB.x, roadB.y, { steps: 4 });
  state = await page.evaluate(() => window.__cinderline.getState());
  assert(state.tool === 'road' && state.plan.overlayVisible && state.plan.tiles > 1, 'road plan overlay did not appear');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const lineOrdered = await page.evaluate(() => {
    const api = window.__cinderline;
    const spot = api.findBurnableNear(70, 70, 20);
    if (!spot) return false;
    for (const [dx, dz] of [[6, 0], [0, 6], [-6, 0], [0, -6]]) {
      if (api.orderLine(spot.x, spot.z, spot.x + dx, spot.z + dz)) return true;
    }
    return false;
  });
  assert(lineOrdered, 'dozer line order was refused everywhere');
  state = await page.evaluate(() => window.__cinderline.getState());
  assert(state.units.some((unit) => unit.kind === 'dozer' && unit.state === 'cutting'), 'dozer did not take the line order');

  const torchLit = await page.evaluate(() => {
    const api = window.__cinderline;
    const incident = api.getState().incidents.find((item) => !item.resolved);
    if (!incident) return false;
    const cx = Math.floor(incident.x / 2);
    const cz = Math.floor(incident.z / 2);
    for (let r = 3; r < 30; r += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const tile = api.getTile(cx + dx, cz + dz);
          if (tile.road || tile.building || tile.state !== 0) continue;
          if (api.torch(cx + dx, cz + dz)) return true;
        }
      }
    }
    return false;
  });
  assert(torchLit, 'no backburn could be lit near the incident');

  const fundsBefore = (await page.evaluate(() => window.__cinderline.getState())).funds;
  assert(await page.evaluate(() => window.__cinderline.requestMutualAid('dozer')), 'mutual aid request failed');
  await page.evaluate(() => window.__cinderline.advanceTime(21000));
  state = await page.evaluate(() => window.__cinderline.getState());
  assert(state.units.length === 6, 'mutual-aid unit did not arrive');
  assert(state.funds < fundsBefore + 100, 'mutual aid was not charged');

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
  assert(typeof state.scenario.grade === 'string', 'result has no grade');
  assert(await page.locator('#end-screen').evaluate((el) => el.classList.contains('visible')), 'end screen did not show');
  assert(errors.length === 0, `browser errors:\n${errors.join('\n')}`);

  console.log(
    `Smoke passed: ${state.scenario.status}, ${state.scenario.incidentsContained} incidents, ${state.scenario.structuresStanding} structures standing.`,
  );
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
