import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import process from 'node:process';
import { chromium, type Page } from 'playwright';

type GameState = {
  roads: { pathCount: number; networkCount: number; tileCount: number; pendingEndpoints: Array<{ x: number; z: number }> };
  hydrants: { count: number };
  fire: {
    burningCount: number;
    smolderingCount: number;
    activeTiles: Array<{ x: number; z: number; state: string; heat: number; wetness: number; retardant: number }>;
  };
  vehicles: {
    count: number;
    selectedId: number | null;
    followers: Array<{
      id: number;
      type: string;
      x: number;
      y: number;
      z: number;
      speed: number;
      busy: boolean;
      assignedIncidentId: number | null;
      water: number;
      offroadTarget: { x: number; z: number } | null;
    }>;
  };
  dispatch: {
    autoDispatch: boolean;
    incidents: Array<{ id: number; status: string; x: number; z: number; assignedFollowerIds: number[] }>;
  };
};

class AuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditError';
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AuditError(message);
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await wait(250);
  }
  throw new AuditError(`Timed out waiting for dev server at ${url}`);
}

async function startDevServer(url: URL): Promise<{ child: ChildProcessWithoutNullStreams; close: () => void }> {
  const child = spawn('npm', ['run', 'dev', '--', '--host', url.hostname, '--port', url.port], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: process.cwd(),
    env: process.env,
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  await waitForServer(url.toString());
  return {
    child,
    close: () => {
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}

async function createPage(baseUrl: string) {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  return { browser, page };
}

async function getState(page: Page): Promise<GameState> {
  const state = await page.evaluate(() => window.__wildfireTestApi?.getState());
  assert(state, 'window.__wildfireTestApi.getState() is unavailable');
  return state as GameState;
}

async function screenshot(page: Page, dir: string, name: string) {
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

async function scenario(name: string, artifactDir: string, fn: () => Promise<void>) {
  process.stdout.write(`\n[game-audit] ${name}\n`);
  try {
    await fn();
  } catch (error) {
    if (error instanceof Error) {
      throw new AuditError(`${name}: ${error.message}`);
    }
    throw error;
  }
}

async function baselineScenario(baseUrl: string, artifactDir: string) {
  const { browser, page } = await createPage(baseUrl);
  try {
    const requiredTestIds = [
      'toolbar',
      'tool-ignite',
      'action-ignite-center',
      'tool-water',
      'tool-retardant',
      'tool-roads',
      'action-clear-roads',
      'vehicle-spawn-main',
      'vehicle-spawn-menu',
      'action-clear-vehicles',
      'dispatch-panel',
      'dispatch-auto-toggle',
    ];
    for (const testId of requiredTestIds) {
      assert(await page.locator(`[data-testid="${testId}"]`).count(), `Missing [data-testid="${testId}"]`);
    }
    const state = await getState(page);
    assert(state.roads.pathCount >= 1, 'Expected seeded roads at startup');
    assert(state.hydrants.count >= 1, 'Expected hydrants at startup');
    assert(state.vehicles.count >= 1, 'Expected seeded vehicles at startup');
    await screenshot(page, artifactDir, 'baseline');
  } finally {
    await browser.close();
  }
}

async function roadScenario(baseUrl: string, artifactDir: string) {
  const { browser, page } = await createPage(baseUrl);
  try {
    const before = await getState(page);
    const ok = await page.evaluate(() => window.__wildfireTestApi?.addRoad(15, 15, 30, 20));
    assert(ok, 'Failed to add a road segment');
    const afterAdd = await getState(page);
    assert(afterAdd.roads.pathCount === before.roads.pathCount + 1, 'Road path count did not increase');
    assert(afterAdd.roads.pendingEndpoints.length === 1, 'Road endpoint chaining state is incorrect');
    await page.evaluate(() => window.__wildfireTestApi?.clearRoads());
    const afterClear = await getState(page);
    assert(afterClear.roads.pathCount === 0, 'Road clear did not remove all paths');
    assert(afterClear.roads.tileCount === 0, 'Road clear did not reset mask tiles');
    await screenshot(page, artifactDir, 'roads');
  } finally {
    await browser.close();
  }
}

async function vehicleScenario(baseUrl: string, artifactDir: string) {
  const { browser, page } = await createPage(baseUrl);
  try {
    const before = await getState(page);
    const spawnOk = await page.evaluate(() => window.__wildfireTestApi?.spawnVehicle('bulldozer'));
    assert(spawnOk, 'Failed to spawn bulldozer');
    const afterSpawn = await getState(page);
    assert(afterSpawn.vehicles.count === before.vehicles.count + 1, 'Vehicle count did not increase after spawn');
    const bulldozer = afterSpawn.vehicles.followers.find((entry) => entry.type === 'bulldozer');
    assert(bulldozer, 'Spawned bulldozer not found in state');
    const target = { x: bulldozer.x + 8, z: bulldozer.z + 6 };
    const orderOk = await page.evaluate(({ id, x, z }) => window.__wildfireTestApi?.orderFollowerTo(id, x, z), {
      id: bulldozer.id,
      x: target.x,
      z: target.z,
    });
    assert(orderOk, 'Failed to issue bulldozer move order');
    await page.evaluate(() => window.__wildfireTestApi?.advanceTime(4000));
    const afterMove = await getState(page);
    const moved = afterMove.vehicles.followers.find((entry) => entry.id === bulldozer.id);
    assert(moved, 'Bulldozer missing after movement update');
    const distanceMoved = Math.hypot(moved.x - bulldozer.x, moved.z - bulldozer.z);
    assert(distanceMoved > 4, `Bulldozer barely moved off-road (${distanceMoved.toFixed(2)} units)`);
    assert(moved.offroadTarget, 'Bulldozer lost off-road target prematurely');
    await page.evaluate(() => window.__wildfireTestApi?.clearVehicles());
    const afterClear = await getState(page);
    assert(afterClear.vehicles.count === 0, 'Vehicle clear did not remove followers');
    await screenshot(page, artifactDir, 'vehicles');
  } finally {
    await browser.close();
  }
}

async function suppressionScenario(baseUrl: string, artifactDir: string) {
  const { browser, page } = await createPage(baseUrl);
  try {
    await page.locator('[data-testid="action-ignite-center"]').click();
    await page.evaluate(() => window.__wildfireTestApi?.advanceTime(1500));
    const burning = await getState(page);
    const tile = burning.fire.activeTiles[0];
    assert(tile, 'Center ignition did not create an active fire tile');
    await page.evaluate(({ x, z }) => {
      window.__wildfireTestApi?.applyWaterAt(x, z, 2, 0.8);
      window.__wildfireTestApi?.applyRetardantAt(x + 1, z + 1, 1.5, 0.9);
      window.__wildfireTestApi?.advanceTime(750);
    }, { x: tile.x, z: tile.z });
    const after = await getState(page);
    const suppressed = after.fire.activeTiles.find((entry) => entry.x === tile.x && entry.z === tile.z);
    assert(suppressed, 'Suppressed fire tile disappeared before state could be inspected');
    assert(suppressed.wetness > tile.wetness, 'Water application did not increase wetness');
    assert(suppressed.retardant > 0, 'Retardant application did not register');
    assert(suppressed.heat < tile.heat, 'Suppression did not lower tile heat');
    await screenshot(page, artifactDir, 'suppression');
  } finally {
    await browser.close();
  }
}

async function autoDispatchScenario(baseUrl: string, artifactDir: string) {
  const { browser, page } = await createPage(baseUrl);
  try {
    const start = await getState(page);
    const firetruck = start.vehicles.followers.find((entry) => entry.type === 'firetruck') ?? start.vehicles.followers[0];
    assert(firetruck, 'No firetruck available for dispatch scenario');
    await page.evaluate(({ x, z }) => window.__wildfireTestApi?.igniteTile(x, z), {
      x: Math.round(firetruck.x),
      z: Math.round(firetruck.z),
    });

    const deadline = Date.now() + 18_000;
    let latest = await getState(page);
    while (Date.now() < deadline) {
      if (latest.dispatch.incidents.some((incident) => incident.status === 'resolved')) break;
      await page.waitForTimeout(1000);
      latest = await getState(page);
    }

    const resolved = latest.dispatch.incidents.find((incident) => incident.status === 'resolved');
    assert(resolved, 'Auto-dispatch never resolved a nearby incident');
    const truckAfter = latest.vehicles.followers.find((entry) => entry.id === firetruck.id);
    assert(truckAfter && !truckAfter.busy, 'Firetruck remained busy after incident resolution');
    await screenshot(page, artifactDir, 'auto-dispatch');
  } finally {
    await browser.close();
  }
}

async function manualDispatchScenario(baseUrl: string, artifactDir: string) {
  const { browser, page } = await createPage(baseUrl);
  try {
    await page.locator('[data-testid="dispatch-auto-toggle"]').uncheck();
    const state = await getState(page);
    const firetruck = state.vehicles.followers.find((entry) => entry.type === 'firetruck') ?? state.vehicles.followers[0];
    assert(firetruck, 'No firetruck available for manual dispatch');
    await page.evaluate(({ x, z }) => window.__wildfireTestApi?.igniteTile(x, z), {
      x: Math.round(firetruck.x),
      z: Math.round(firetruck.z),
    });

    await page.waitForFunction(() => {
      const next = window.__wildfireTestApi?.getState();
      return Boolean(next && next.dispatch.incidents.length > 0);
    }, { timeout: 6_000 });

    const nextState = await getState(page);
    const incident = nextState.dispatch.incidents[0];
    assert(incident, 'No detected incident available for manual dispatch');
    await page.evaluate((id) => window.__wildfireTestApi?.selectFollower(id), firetruck.id);
    const assignButton = page.locator(`[data-testid="dispatch-assign-${incident.id}"]`);
    assert(await assignButton.count(), 'Manual dispatch button did not render');
    assert(await assignButton.isEnabled(), 'Manual dispatch button is disabled for a serviceable firetruck');
    const ok = await page.evaluate(({ incidentId, followerId }) => (
      window.__wildfireTestApi?.manualDispatch(incidentId, followerId) ?? false
    ), { incidentId: incident.id, followerId: firetruck.id });
    assert(ok, 'Manual dispatch API rejected the selected firetruck');
    await page.waitForTimeout(1500);
    const after = await getState(page);
    const assigned = after.dispatch.incidents.find((entry) => entry.id === incident.id);
    assert(assigned, 'Incident disappeared before manual dispatch verification');
    assert(assigned.assignedFollowerIds.includes(firetruck.id), 'Manual dispatch did not assign the selected firetruck');
    await screenshot(page, artifactDir, 'manual-dispatch');
  } finally {
    await browser.close();
  }
}

async function main() {
  const artifacts = process.env.GAME_AUDIT_ARTIFACTS
    ? path.resolve(process.env.GAME_AUDIT_ARTIFACTS)
    : mkdtempSync(path.join(tmpdir(), 'wildfire-rts-audit-'));
  mkdirSync(artifacts, { recursive: true });
  process.stdout.write(`[game-audit] artifacts: ${artifacts}\n`);

  const externalUrl = process.env.GAME_AUDIT_URL;
  const baseUrl = externalUrl ?? 'http://127.0.0.1:4173';
  let serverHandle: { close: () => void } | null = null;

  try {
    if (!externalUrl) {
      serverHandle = await startDevServer(new URL(baseUrl));
    } else {
      await waitForServer(baseUrl);
    }

    await scenario('baseline', artifacts, () => baselineScenario(baseUrl, artifacts));
    await scenario('roads', artifacts, () => roadScenario(baseUrl, artifacts));
    await scenario('vehicles', artifacts, () => vehicleScenario(baseUrl, artifacts));
    await scenario('suppression', artifacts, () => suppressionScenario(baseUrl, artifacts));
    await scenario('auto-dispatch', artifacts, () => autoDispatchScenario(baseUrl, artifacts));
    await scenario('manual-dispatch', artifacts, () => manualDispatchScenario(baseUrl, artifacts));

    process.stdout.write('\n[game-audit] PASS\n');
  } finally {
    serverHandle?.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  process.stderr.write(`\n[game-audit] FAIL ${message}\n`);
  process.exit(1);
});
