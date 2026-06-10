import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import process from 'node:process';
import { chromium, type Page } from 'playwright';

type GameState = {
  roads: { pathCount: number; networkCount: number; tileCount: number; pendingEndpoints: Array<{ x: number; z: number }> };
  hydrants: { count: number; positions: Array<{ id: number; x: number; z: number; coverageRadius: number; active: boolean }> };
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
      returningToBase: boolean;
      assignedIncidentId: number | null;
      water: number;
      fuel: number;
      offroadTarget: { x: number; z: number } | null;
    }>;
  };
  dispatch: {
    autoDispatch: boolean;
    incidents: Array<{ id: number; status: string; x: number; z: number; assignedFollowerIds: number[] }>;
  };
};

type TileInfo = {
  x: number;
  z: number;
  state: string;
  heat: number;
  wetness: number;
  retardant: number;
  lineStrength: number;
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
  if (process.env.AUDIT_CONSOLE) {
    page.on('console', (msg) => process.stdout.write(`[browser:${msg.type()}] ${msg.text()}\n`));
    page.on('pageerror', (err) => process.stdout.write(`[browser:error] ${err.message}\n`));
  }
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

async function payloadRoundTripScenario(baseUrl: string, artifactDir: string) {
  const { browser, page } = await createPage(baseUrl);
  try {
    // Keep auto-dispatch off so no incident ever lands on our truck during this run.
    await page.evaluate(() => window.__wildfireTestApi!.setAutoDispatch(false));
    const start = await getState(page);
    const firetruck = start.vehicles.followers.find((entry) => entry.type === 'firetruck');
    assert(firetruck, 'No firetruck available for payload scenario');
    assert(firetruck.water > 0, 'Firetruck started with an empty water tank');
    const initialWater = firetruck.water;

    // Drain tank directly — simulates mid-engagement exhaustion without the flake of
    // the real suppression loop. The drain mechanic itself is covered by unit tests.
    const drainOk = await page.evaluate((id) => window.__wildfireTestApi!.exhaustFollowerWater(id), firetruck.id);
    assert(drainOk, 'exhaustFollowerWater returned false');

    const drainedImmediately = (await getState(page)).vehicles.followers.find((f) => f.id === firetruck.id);
    assert(drainedImmediately && drainedImmediately.water === 0, `Tank should be empty post-exhaust (${drainedImmediately?.water})`);

    // Advance until the logistics loop completes the round trip: either RTB flips
    // immediately (if already at home) or the truck drives home and refills.
    // Cap at ~90s sim.
    let refilled = drainedImmediately;
    let sawRtbOrRefill = false;
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => window.__wildfireTestApi!.advanceTime(3_000));
      const next = await getState(page);
      const truck = next.vehicles.followers.find((f) => f.id === firetruck.id);
      if (!truck) break;
      if (truck.returningToBase) sawRtbOrRefill = true;
      if (truck.water >= initialWater * 0.99) sawRtbOrRefill = true;
      refilled = truck;
      if (!truck.returningToBase && truck.water >= initialWater * 0.99) break;
    }
    assert(sawRtbOrRefill, 'Neither returningToBase nor refill was observed — logistics loop inert');
    assert(!refilled.returningToBase, `Firetruck stuck in returningToBase (water=${refilled.water}, busy=${refilled.busy})`);
    assert(refilled.water >= initialWater * 0.99, `Water did not refill at home (${refilled.water} vs ${initialWater})`);
    assert(refilled.fuel > 0, `Fuel not restored (${refilled.fuel})`);
    assert(!refilled.busy, 'Firetruck left marked busy after refill');
    assert(refilled.assignedIncidentId == null, `Follower retained assignment after refill (${refilled.assignedIncidentId})`);
    await screenshot(page, artifactDir, 'payload-round-trip');
  } finally {
    await browser.close();
  }
}

async function hydrantSuppressionScenario(baseUrl: string, artifactDir: string) {
  const { browser, page } = await createPage(baseUrl);
  try {
    // Deterministic setup: strip the world of roads+hydrants, then build one short road
    // so exactly one hydrant network exists in a known location.
    await page.evaluate(() => {
      const api = window.__wildfireTestApi!;
      api.clearVehicles();
      api.clearRoads();
      api.updateHydrants();
      api.addRoad(20, 20, 35, 20);
      api.updateHydrants();
    });
    const state = await getState(page);
    const hydrant = state.hydrants.positions.find((h) => h.active);
    assert(hydrant, `Expected at least one hydrant after road placement, saw ${state.hydrants.count}`);
    const { x: hx, z: hz, coverageRadius } = hydrant;

    // "far" tile: same world, far from any placed hydrant.
    const farX = 90;
    const farZ = 90;
    for (const h of state.hydrants.positions) {
      const dx = h.x - farX;
      const dz = h.z - farZ;
      assert(dx * dx + dz * dz > (coverageRadius + 2) * (coverageRadius + 2), `Far tile (${farX},${farZ}) is still near a hydrant`);
    }

    await page.evaluate(({ hx, hz, fx, fz }) => {
      const api = window.__wildfireTestApi!;
      api.igniteTile(hx, hz, 0.9);
      api.igniteTile(fx, fz, 0.9);
      api.advanceTime(500);
    }, { hx, hz, fx: farX, fz: farZ });

    const before = {
      hydrant: await page.evaluate(({ x, z }) => window.__wildfireTestApi!.getTileAt(x, z), { x: hx, z: hz }) as TileInfo | null,
      far: await page.evaluate(({ x, z }) => window.__wildfireTestApi!.getTileAt(x, z), { x: farX, z: farZ }) as TileInfo | null,
    };
    assert(before.hydrant && before.far, 'Tile snapshots unavailable');

    // Apply the same hydrant-aware water call at both locations.
    await page.evaluate(({ hx, hz, fx, fz }) => {
      const api = window.__wildfireTestApi!;
      api.applyWaterFromHydrantAt(hx, hz, 1.5, 0.25);
      api.applyWaterFromHydrantAt(fx, fz, 1.5, 0.25);
    }, { hx, hz, fx: farX, fz: farZ });

    const after = {
      hydrant: await page.evaluate(({ x, z }) => window.__wildfireTestApi!.getTileAt(x, z), { x: hx, z: hz }) as TileInfo | null,
      far: await page.evaluate(({ x, z }) => window.__wildfireTestApi!.getTileAt(x, z), { x: farX, z: farZ }) as TileInfo | null,
    };
    assert(after.hydrant && after.far, 'Tile snapshots after water unavailable');

    const dHydrantWet = after.hydrant.wetness - before.hydrant.wetness;
    const dFarWet = after.far.wetness - before.far.wetness;
    assert(dHydrantWet > 0, 'Water at hydrant location produced no wetness change');
    assert(dFarWet > 0, 'Water at far location produced no wetness change');
    assert(
      dHydrantWet > dFarWet * 1.2,
      `Hydrant boost not observed — covered ${dHydrantWet.toFixed(3)} vs bare ${dFarWet.toFixed(3)}`,
    );
    await screenshot(page, artifactDir, 'hydrant-suppression');
  } finally {
    await browser.close();
  }
}

async function bulldozerFirelineScenario(baseUrl: string, artifactDir: string) {
  const { browser, page } = await createPage(baseUrl);
  try {
    const spawned = await page.evaluate(() => window.__wildfireTestApi!.spawnVehicle('bulldozer'));
    assert(spawned, 'Failed to spawn bulldozer');
    const state = await getState(page);
    const dozer = state.vehicles.followers.find((entry) => entry.type === 'bulldozer');
    assert(dozer, 'Bulldozer missing after spawn');

    // Sample the fireline strength along the planned traversal before moving.
    // Use floor to match the main-loop grid math (`pos.x / hm.scale`), so sample
    // tiles match the tile the bulldozer actually writes to as it crosses.
    const targetX = dozer.x + 8;
    const targetZ = dozer.z;
    const startTileZ = Math.floor(dozer.z);
    const sampleTiles: Array<{ x: number; z: number }> = [];
    for (let i = 1; i <= 6; i++) {
      sampleTiles.push({ x: Math.floor(dozer.x + i), z: startTileZ });
    }
    const beforeSamples = await page.evaluate((tiles) => tiles.map(({ x, z }) => window.__wildfireTestApi!.getTileAt(x, z)), sampleTiles) as Array<TileInfo | null>;
    for (const tile of beforeSamples) {
      assert(tile && tile.lineStrength === 0, `Unexpected preexisting fireline at (${tile?.x}, ${tile?.z}) = ${tile?.lineStrength}`);
    }

    const orderOk = await page.evaluate(({ id, x, z }) => window.__wildfireTestApi!.orderFollowerTo(id, x, z), {
      id: dozer.id,
      x: targetX,
      z: targetZ,
    });
    assert(orderOk, 'Failed to issue bulldozer off-road order');

    // Traverse to target.
    await page.evaluate(() => window.__wildfireTestApi!.advanceTime(6_000));
    const postState = await getState(page);
    const afterDozer = postState.vehicles.followers.find((f) => f.id === dozer.id);
    const moved = afterDozer ? Math.hypot(afterDozer.x - dozer.x, afterDozer.z - dozer.z) : 0;
    const afterSamples = await page.evaluate((tiles) => tiles.map(({ x, z }) => window.__wildfireTestApi!.getTileAt(x, z)), sampleTiles) as Array<TileInfo | null>;
    const carved = afterSamples.filter((tile) => tile && tile.lineStrength > 0.5).length;
    assert(
      carved >= 3,
      `Bulldozer did not carve a fireline — only ${carved}/${sampleTiles.length} tiles have lineStrength > 0.5; ` +
      `dozer start=(${dozer.x.toFixed(1)},${dozer.z.toFixed(1)}) end=(${afterDozer?.x.toFixed(1) ?? '?'},${afterDozer?.z.toFixed(1) ?? '?'}) moved=${moved.toFixed(2)} ` +
      `samples=${JSON.stringify(afterSamples.map((t) => ({ x: t?.x, z: t?.z, ls: t?.lineStrength })))}`,
    );
    await screenshot(page, artifactDir, 'bulldozer-fireline');
  } finally {
    await browser.close();
  }
}

async function longRunStabilityScenario(baseUrl: string, artifactDir: string) {
  const { browser, page } = await createPage(baseUrl);
  try {
    const start = await getState(page);
    // Seed multiple fires spaced around the map.
    const seeds = [
      { x: start.vehicles.followers[0]?.x ?? 30, z: start.vehicles.followers[0]?.z ?? 30 },
      { x: 40, z: 40 },
      { x: 60, z: 20 },
      { x: 20, z: 60 },
      { x: 70, z: 70 },
    ];
    await page.evaluate((seeds) => {
      const api = window.__wildfireTestApi!;
      for (const s of seeds) api.igniteTile(Math.round(s.x), Math.round(s.z), 0.85);
    }, seeds);

    // Fast-forward a total of 60s in 6 chunks, sampling state.
    let sawResolved = false;
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.__wildfireTestApi!.advanceTime(10_000));
      const snap = await getState(page);
      for (const f of snap.vehicles.followers) {
        assert(Number.isFinite(f.x) && Number.isFinite(f.z), `NaN follower position at chunk ${i}: ${JSON.stringify(f)}`);
        assert(f.water >= 0, `Follower ${f.id} water went negative: ${f.water}`);
        assert(f.fuel >= 0, `Follower ${f.id} fuel went negative: ${f.fuel}`);
        if (f.busy) {
          const assigned = f.assignedIncidentId != null;
          const rtb = f.returningToBase;
          assert(assigned || rtb, `Follower ${f.id} marked busy with no incident and not returning (chunk ${i})`);
        }
      }
      if (snap.dispatch.incidents.some((inc) => inc.status === 'resolved')) sawResolved = true;
    }
    assert(sawResolved, 'Dispatch resolved zero incidents over 60s — system appears stalled');
    await screenshot(page, artifactDir, 'long-run-stability');
  } finally {
    await browser.close();
  }
}

async function mvpContainmentScenario(baseUrl: string, artifactDir: string) {
  const { browser, page } = await createPage(baseUrl);
  try {
    // Load the default seeded containment scenario. Ignites at a fixed tile
    // inside auto-dispatch range of the baseline firetruck fleet.
    const loaded = await page.evaluate(() => window.__wildfireTestApi!.loadScenario());
    assert(loaded && loaded.id === 'mvp-containment-1', `Scenario did not load: ${JSON.stringify(loaded)}`);

    // Fast-forward slightly longer than the time limit so we comfortably
    // cross the win boundary if containment holds.
    const totalSec = loaded.timeLimitSec + 5;
    const chunkMs = 3_000;
    const chunks = Math.ceil((totalSec * 1000) / chunkMs);
    let last: { id: string; result: string; elapsedSec: number; footprint: number; budget: number; timeLimitSec: number } | null = null;
    for (let i = 0; i < chunks; i++) {
      await page.evaluate((ms) => window.__wildfireTestApi!.advanceTime(ms), chunkMs);
      last = await page.evaluate(() => window.__wildfireTestApi!.getScenarioResult());
      if (last && last.result !== 'pending') break;
    }
    assert(last, 'getScenarioResult() returned null');
    assert(
      last.result === 'win',
      `Scenario did not win: result=${last.result} footprint=${last.footprint}/${last.budget} elapsed=${last.elapsedSec}/${last.timeLimitSec}`,
    );
    await screenshot(page, artifactDir, 'mvp-containment');
  } finally {
    await browser.close();
  }
}

async function stressContentionScenario(baseUrl: string, artifactDir: string) {
  const { browser, page } = await createPage(baseUrl);
  try {
    // Spawn additional firetrucks so we have ≥4 total.
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__wildfireTestApi!.spawnVehicle('firetruck'));
    }
    const ready = await getState(page);
    const firetrucks = ready.vehicles.followers.filter((entry) => entry.type === 'firetruck');
    assert(firetrucks.length >= 4, `Expected ≥4 firetrucks, got ${firetrucks.length}`);

    // Ignite 10 tiles — clustered near the firetruck fleet so they have service range.
    await page.evaluate((trucks) => {
      const api = window.__wildfireTestApi!;
      for (let i = 0; i < 10; i++) {
        const t = trucks[i % trucks.length];
        const offset = Math.floor(i / trucks.length);
        api.igniteTile(Math.round(t.x) + offset * 2, Math.round(t.z) + offset * 2, 0.9);
      }
    }, firetrucks);

    // Let auto-dispatch churn for up to 60s of sim time. Bound by sim time,
    // not wall clock — wall-clock loops advance unbounded sim time on fast
    // machines, letting the fire outrun road-serviceable range.
    let latest = ready;
    let sawResolved = 0;
    for (let step = 0; step < 20; step++) {
      await page.evaluate(() => window.__wildfireTestApi!.advanceTime(3_000));
      latest = await getState(page);
      sawResolved = latest.dispatch.incidents.filter((i) => i.status === 'resolved').length;
      const pending = latest.dispatch.incidents.filter((i) => i.status !== 'resolved');
      if (!pending.length) break;
    }

    // Non-deadlock check: every still-open incident is in an actively-progressing
    // state (engaged/assigned/reopened), or is freshly detected awaiting pickup.
    // What we really care about is: no follower stuck busy with no work, and
    // dispatch is making progress (at least one resolution).
    const unresolved = latest.dispatch.incidents.filter((inc) => inc.status !== 'resolved');
    const stuck = latest.vehicles.followers.filter((f) => f.busy && f.assignedIncidentId == null && !f.returningToBase);
    assert(
      stuck.length === 0,
      `Followers stuck busy with no assignment: ${JSON.stringify(stuck.map((f) => f.id))}`,
    );
    assert(
      sawResolved >= 2,
      `Dispatch resolved too few incidents under contention (${sawResolved}): ${JSON.stringify(latest.dispatch.incidents.map((i) => i.status))}`,
    );
    // Sanity: unresolved counts should be bounded (not ballooning beyond initial 10).
    assert(
      unresolved.length <= 15,
      `Unresolved incidents ballooned (${unresolved.length}) — dispatch may be starving`,
    );
    await screenshot(page, artifactDir, 'stress-contention');
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
    await scenario('payload-round-trip', artifacts, () => payloadRoundTripScenario(baseUrl, artifacts));
    await scenario('hydrant-suppression', artifacts, () => hydrantSuppressionScenario(baseUrl, artifacts));
    await scenario('bulldozer-fireline', artifacts, () => bulldozerFirelineScenario(baseUrl, artifacts));
    await scenario('long-run-stability', artifacts, () => longRunStabilityScenario(baseUrl, artifacts));
    await scenario('stress-contention', artifacts, () => stressContentionScenario(baseUrl, artifacts));
    await scenario('mvp-containment', artifacts, () => mvpContainmentScenario(baseUrl, artifacts));

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
