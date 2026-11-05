import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
} from 'three';
import { CameraRig } from './core/camera';
import { createRenderer, createScene } from './core/scene';
import { GRID_SIZE, TILE_SIZE, tileToWorld, worldToTile } from './world/constants';
import { World } from './world/world';
import { BACKBURN_GENERATIONS, FireState, Fuel, QUERY_BURNING, QUERY_WILD, Wildfire } from './sim/fire';
import { SoundEngine } from './audio/sound';
import { Effects } from './fx/effects';
import { PlanPreview } from './fx/planPreview';
import { Atmosphere } from './fx/atmosphere';
import { Hints } from './ui/hints';
import { ParticleSystem } from './sim/particles';
import { Fleet } from './sim/units';
import { Incident, IncidentSystem } from './sim/incidents';
import { Scenario } from './sim/scenario';
import { NotifyFn, NotifyTone } from './sim/types';
import { UnitKind } from './sim/vehicleModels';
import {
  Budget,
  MUTUAL_AID_COST,
  MUTUAL_AID_ETA,
  MUTUAL_AID_LIMIT,
  ROAD_COST_PER_TILE,
  TORCH_COST,
} from './sim/budget';
import { DIFFICULTIES, DifficultyId, parseDifficulty } from './sim/difficulty';
import { loadJson, loadPreference, saveJson, savePreference } from './core/prefs';
import { BestRecord, Hud, HudState, ThreatSummary, Tool, UnitAction } from './ui/hud';

/** A structure is threatened when burning wildfire is within this many tiles. */
const THREAT_RADIUS_TILES = 7;
/** A threatened structure counts as saved once no wildfire is within this many tiles. */
const SAVED_CLEAR_TILES = 12;
/** Budget paid for each structure that comes through a threat. */
const SAVE_BONUS = 40;
/** Simulated seconds between situation updates (threats, saves, firebreak reports). */
const SITUATION_INTERVAL = 0.5;
/** Minimum simulated seconds between "firebreak holding" reports. */
const HOLD_REPORT_INTERVAL = 25;

/** Fixed simulation step for scenario, incidents, units, and structures. */
const SIM_STEP = 1 / 30;
/** Cap on catch-up steps per frame; any larger backlog is dropped. */
const MAX_SIM_STEPS = 24;

interface TestApi {
  getState: () => unknown;
  start: () => void;
  advanceTime: (ms: number) => void;
  setRealtime: (enabled: boolean) => void;
  ignite: (tx: number, tz: number) => boolean;
  selectUnit: (id: number) => void;
  dispatch: (incidentId: number) => boolean;
  setSpeed: (speed: number) => void;
  getTile: (tx: number, tz: number) => unknown;
  torch: (tx: number, tz: number) => boolean;
  orderLine: (sx: number, sz: number, gx: number, gz: number) => boolean;
  requestMutualAid: (kind: UnitKind) => boolean;
  setDifficulty: (id: DifficultyId) => void;
  findBurnableNear: (tx: number, tz: number, radius: number) => { x: number; z: number } | null;
  focusTile: (tx: number, tz: number) => void;
  setView: (view: { yaw?: number; pitch?: number; viewSize?: number }) => void;
  focusIncident: (id: number) => void;
  setAutoDispatch: (enabled: boolean) => void;
  buildRoad: (sx: number, sz: number, gx: number, gz: number) => number;
  screenPosition: (tx: number, tz: number) => { x: number; y: number };
  unitScreenPosition: (id: number) => { x: number; y: number } | null;
  debugPick: (x: number, y: number) => unknown;
  roadFuelMismatches: () => number;
}

export class Game {
  readonly renderer;
  readonly scene;
  readonly rig: CameraRig;
  readonly world: World;
  readonly fire: Wildfire;
  readonly particles: ParticleSystem;
  readonly fleet: Fleet;
  readonly incidents: IncidentSystem;
  readonly scenario: Scenario;
  readonly hud: Hud;
  readonly seed: number;

  private readonly viewport: HTMLElement;
  private started = false;
  private paused = false;
  private speed = 1;
  private tool: Tool = 'select';
  private roadStart: { x: number; z: number } | null = null;
  private lineStart: { x: number; z: number } | null = null;
  /** Tiles and cost of the road or dozer line under the cursor. */
  private preview: { tiles: number; cost: number } | null = null;
  private budget: Budget;
  private difficulty: DifficultyId;
  private readonly reinforcements: Array<{ kind: UnitKind; name: string; eta: number }> = [];
  private mutualAidRequested = 0;
  private readonly sound: SoundEngine;
  private readonly effects: Effects;
  private readonly planPreview: PlanPreview;
  private readonly atmosphere: Atmosphere;
  private situationTimer = 0;
  private readonly everThreatened = new Set<number>();
  private readonly savedStructures = new Set<number>();
  private lastHoldReport = -Infinity;
  /** Tiles paved by the player, so "road holding" reports only credit their roads. */
  private readonly playerRoads = new Uint8Array(GRID_SIZE * GRID_SIZE);
  private readonly hints: Hints;
  private threats: ThreatSummary = { total: 0, byIncident: new Map(), buildings: new Set() };
  private lastThreatTotal = 0;
  private best: BestRecord | null = null;
  private newBest = false;
  private selectedUnitId: number | null = null;
  private hudTimer = 0;
  private lastFrame = performance.now();
  private keys = new Set<string>();
  private pointerDown = false;
  private downX = 0;
  private downY = 0;
  private panLastX = 0;
  private panLastY = 0;
  private downButton = -1;
  private hoverTile: { x: number; z: number } | null = null;
  private hoverWorld: { x: number; z: number } | null = null;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly tileHighlight: LineLoop;
  private readonly roadPreview: Line;
  private roadPreviewKey = '';
  private readonly markerGroup = new Group();
  private readonly incidentMarkers = new Map<number, Mesh>();
  private readonly destroyedBuildings = new Set<number>();
  private readonly notify: NotifyFn;
  private lastScenarioStatus = 'briefing';
  private markerTime = 0;
  private simAccumulator = 0;
  /** True once the test API drives the clock; the frame loop then only renders. */
  private externalClock = false;

  constructor(viewport: HTMLElement, seed: number, difficulty?: DifficultyId) {
    this.viewport = viewport;
    this.seed = seed;
    this.difficulty = difficulty ?? parseDifficulty(loadPreference('difficulty')) ?? 'standard';
    this.budget = new Budget(DIFFICULTIES[this.difficulty].startingFunds, DIFFICULTIES[this.difficulty].income);
    this.renderer = createRenderer(viewport);
    this.scene = createScene();
    this.world = new World(seed);
    this.scene.add(this.world.group);
    this.rig = new CameraRig(viewport.clientWidth, viewport.clientHeight, this.world.heightmap);
    this.rig.focus(this.world.worldCenter.x - 2, this.world.worldCenter.z - 2);
    this.rig.zoom(82 / 66);
    this.rig.snap();
    this.fire = new Wildfire(this.world.heightmap, this.world.biomes, {
      roadMask: this.world.roads.mask,
      structureAt: this.world.buildings.structureAt,
      seed: seed ^ 0x1f123bb5,
    });

    this.sound = new SoundEngine(loadPreference('muted') === '1');
    this.notify = (message: string, tone: NotifyTone = 'info') => {
      this.hud?.toast(message, tone);
      if (tone === 'danger') this.sound?.play('alert');
    };
    this.hints = new Hints(this.notify);
    this.best = this.loadBest();

    this.hud = new Hud(
      document.getElementById('ui') as HTMLElement,
      this.world,
      this.fire,
      {
        onStart: () => this.startShift(),
        onDifficulty: (id) => this.chooseDifficulty(id),
        onMutualAid: (kind) => {
          this.requestMutualAid(kind);
        },
        onTool: (tool) => this.setTool(tool),
        onSpeed: (speed) => this.setSpeed(speed),
        onPause: () => this.togglePause(),
        onAutoDispatch: (enabled) => this.setAutoDispatch(enabled),
        onIncidentFocus: (id) => this.focusIncident(id),
        onIncidentDispatch: (id) => this.dispatchIncident(id),
        onUnitSelect: (id) => this.onFleetRowClick(id),
        onUnitAction: (id, action) => this.unitAction(id, action),
        onMute: () => this.toggleMute(),
        onMinimapFocus: (x, z) => this.rig.focus(x, z),
        onHelp: () => {
          this.keys.clear();
        },
        onRestart: (sameSeed) => this.restart(sameSeed),
      },
      seed,
      this.difficulty,
    );

    this.particles = new ParticleSystem(this.world.heightmap);
    this.scene.add(this.particles.group);
    this.fleet = new Fleet(this.world, this.fire, this.particles, this.notify);
    this.scene.add(this.fleet.group);
    this.incidents = new IncidentSystem(this.fire, this.notify);
    this.scenario = new Scenario(this.world, this.fire, this.incidents, this.notify, seed, this.difficulty);
    this.incidents.onResolved = (incident) => {
      this.scenario.registerIncidentContained();
      const bonus = this.scenario.difficulty.containmentBonus;
      this.budget.earn(bonus);
      this.notify(`Contained in ${this.world.sectorName(incident.tx, incident.tz)}. +$${bonus} budget.`, 'success');
    };
    this.incidents.onSpotDetected = (incident) => {
      this.scenario.registerFireStarted();
      this.notify(`Lookout reports a spot fire — ${this.world.sectorName(incident.tx, incident.tz)}.`, 'danger');
    };
    this.effects = new Effects(this.world.heightmap);
    this.scene.add(this.effects.group);
    this.scenario.onLightning = (tx, tz) => {
      const world = tileToWorld(tx, tz);
      this.effects.lightning(world.x, world.z);
      this.hud.lightning();
      const camera = this.rig.target;
      const far = Math.hypot(camera.x - world.x, camera.z - world.z);
      this.sound.play('thunder', Math.min(1.4, 0.15 + far / 120));
    };
    this.scenario.onWindShift = () => {
      this.sound.play('windShift');
    };
    this.fleet.onEvent = (event) => {
      if (event === 'waterDrop') this.sound.play('drop');
      else if (event === 'retardant') {
        this.sound.play('retardant');
        this.effects.addShake(0.35);
      } else if (event === 'burnover') {
        this.sound.play('burnover');
        this.effects.addShake(0.8);
      } else if (event === 'lineDone') this.sound.play('contained');
      else if (event === 'dip') this.sound.play('drop');
    };
    this.scene.add(this.markerGroup);
    this.markerGroup.name = 'incident-markers';

    this.tileHighlight = createTileHighlight();
    this.scene.add(this.tileHighlight);
    this.roadPreview = createRoadPreview();
    this.scene.add(this.roadPreview);
    this.planPreview = new PlanPreview(this.world.heightmap);
    this.scene.add(this.planPreview.mesh);
    this.atmosphere = new Atmosphere(this.scene);

    this.hud.setTool(this.tool);
    this.bindEvents();
    this.installTestApi();
    this.hud.setBestLine(this.bestLine());
    this.hud.update(this.hudState(), true);
    requestAnimationFrame(this.frame);
  }

  private bestKey(): string {
    return `best.${this.seed}.${this.difficulty}`;
  }

  private loadBest(): BestRecord | null {
    return loadJson<BestRecord | null>(this.bestKey(), null);
  }

  private bestLine(): string | null {
    return this.best ? `Your best on this map: ${this.best.score.toLocaleString()} (grade ${this.best.grade})` : null;
  }

  private toggleMute(): void {
    this.sound.unlock();
    this.sound.setMuted(!this.sound.muted);
    savePreference('muted', this.sound.muted ? '1' : '0');
    this.hud.update(this.hudState(), true);
  }

  /** Record the result once the shift ends: best score, sound, and the end screen. */
  private onOutcome(): void {
    const result = this.scenario.currentResult;
    this.sound.play(result.status === 'won' ? 'win' : 'lose', 0.4);
    if (!this.best || result.score > this.best.score) {
      this.newBest = this.best !== null;
      this.best = { score: result.score, grade: result.grade ?? 'F' };
      saveJson(this.bestKey(), this.best);
    }
  }

  /** Intact structures with burning wildfire nearby, attributed to the closest incident. */
  private computeThreats(): ThreatSummary {
    const buildings = new Set<number>();
    const byIncident = new Map<number, number>();
    const active = this.incidents.activeIncidents;
    for (const building of this.world.buildings.buildings) {
      if (building.state === 'destroyed') continue;
      const near =
        building.state === 'burning' ||
        this.fire.nearestActive(building.centerX, building.centerZ, THREAT_RADIUS_TILES, QUERY_WILD | QUERY_BURNING) !== null;
      if (!near) continue;
      buildings.add(building.id);
      let closest: Incident | null = null;
      let closestDistance = Infinity;
      for (const incident of active) {
        const d = Math.hypot(incident.x - building.centerX, incident.z - building.centerZ);
        if (d < closestDistance) {
          closestDistance = d;
          closest = incident;
        }
      }
      if (closest) byIncident.set(closest.id, (byIncident.get(closest.id) ?? 0) + 1);
    }
    return { total: buildings.size, byIncident, buildings };
  }

  /**
   * Simulation-clock bookkeeping: which structures are threatened, which
   * came through (saved bonus), and whether wildfire is pressing against a
   * dozer line or a player-built road (the "line is holding" payoff).
   */
  private updateSituation(dt: number): void {
    this.situationTimer -= dt;
    if (this.situationTimer > 0) return;
    this.situationTimer = SITUATION_INTERVAL;
    this.threats = this.computeThreats();
    for (const id of this.threats.buildings) this.everThreatened.add(id);
    for (const id of this.everThreatened) {
      if (this.savedStructures.has(id) || this.threats.buildings.has(id)) continue;
      const building = this.world.buildings.buildings.find((item) => item.id === id);
      if (!building || building.state === 'destroyed') continue;
      if (this.fire.isActiveNear(building.centerX, building.centerZ, SAVED_CLEAR_TILES, QUERY_WILD)) continue;
      this.savedStructures.add(id);
      this.budget.earn(SAVE_BONUS);
      this.notify(`${labelBuilding(building.kind)} saved in ${this.world.sectorName(building.x0, building.z0)}. +$${SAVE_BONUS}.`, 'success');
      this.sound.play('contained');
    }
    const contacts = this.fire.takeBreakContacts();
    if (contacts.length < 2 || this.scenario.time - this.lastHoldReport < HOLD_REPORT_INTERVAL) return;
    for (const index of contacts) {
      const line = this.fire.state[index] === FireState.Cleared;
      if (!line && this.playerRoads[index] !== 1) continue;
      const tx = index % GRID_SIZE;
      const tz = Math.floor(index / GRID_SIZE);
      this.lastHoldReport = this.scenario.time;
      this.notify(`${line ? 'Dozer line' : 'Your road'} is holding the fire in ${this.world.sectorName(tx, tz)}.`, 'success');
      this.sound.play('hold');
      return;
    }
  }

  /** Real-time bookkeeping at HUD cadence: threat visuals, heads, ambience, coaching. */
  private refreshSituation(): void {
    if (this.threats.total > this.lastThreatTotal && this.started) this.sound.play('alert');
    this.lastThreatTotal = this.threats.total;
    this.effects.setThreatened(this.world.buildings.buildings, this.threats.buildings);
    const heads: Array<{ x: number; z: number }> = [];
    for (const incident of this.incidents.activeIncidents) {
      if (incident.severity < 4) continue;
      const head = this.fire.headTileNear(incident.x, incident.z, 30, QUERY_WILD);
      if (head) heads.push(tileToWorld(head.x, head.z));
    }
    this.effects.setHeads(heads, this.scenario.windDirection, this.scenario.windSpeed);
    const camera = this.rig.target;
    const view = this.rig.viewSize / TILE_SIZE;
    this.sound.setAmbience({
      wind: this.started ? this.scenario.windSpeed : 2,
      fire: this.started && !this.paused ? this.fire.activeCountNear(camera.x, camera.z, view * 0.8, QUERY_BURNING) : 0,
      spraying: this.paused ? 0 : this.fleet.sprayingCount,
    });
    if (this.started && this.scenario.status === 'running') this.coach();
  }

  private coach(): void {
    const time = this.scenario.time;
    if (time > 4) this.hints.show('welcome');
    const incidents = this.incidents.activeIncidents;
    if (incidents.some((incident) => incident.severity >= 10)) this.hints.show('line');
    if (incidents.some((incident) => incident.severity >= 24)) this.hints.show('backburn');
    const next = this.scenario.nextWindShift();
    if (next && next.time - time < 22 && time > 10) this.hints.show('forecast');
    if (this.threats.total > 0) this.hints.show('threat');
    if (this.fleet.units.some((unit) => unit.status === 'Driving to hydrant')) this.hints.show('hydrant');
    if (this.budget.funds >= 420) this.hints.show('aid');
    if (this.fleet.units.some((unit) => unit.kind === 'dozer' && unit.exposure > 0.3)) this.hints.show('heat');
  }

  private chooseDifficulty(id: DifficultyId): void {
    if (this.started) return;
    this.difficulty = id;
    savePreference('difficulty', id);
    this.scenario.setDifficulty(id);
    const config = DIFFICULTIES[id];
    this.budget = new Budget(config.startingFunds, config.income);
    this.best = this.loadBest();
    this.hud.setBestLine(this.bestLine());
    this.hud.update(this.hudState(), true);
  }

  private startShift(): void {
    if (this.started) return;
    this.chooseDifficulty(this.difficulty);
    this.sound.unlock();
    this.sound.play('click');
    this.started = true;
    this.scenario.start();
    this.setTool('select');
    this.rig.zoom(0.9);
    this.hud.update(this.hudState(), true);
  }

  private restart(sameSeed = false): void {
    const nextSeed = sameSeed ? this.seed : (Math.random() * 0xffffffff) >>> 0;
    window.location.href = `${window.location.pathname}?seed=${nextSeed}&difficulty=${this.difficulty}`;
  }

  private requestMutualAid(kind: UnitKind): boolean {
    if (!this.started || this.scenario.status !== 'running') return false;
    if (this.mutualAidRequested >= MUTUAL_AID_LIMIT) {
      this.notify('Mutual aid is exhausted for this shift.', 'warning');
      return false;
    }
    const cost = MUTUAL_AID_COST[kind];
    if (!this.budget.spend(cost)) {
      this.notify(`Mutual aid costs $${cost}. Not enough budget yet.`, 'warning');
      return false;
    }
    this.mutualAidRequested += 1;
    const name = this.fleet.reserveMutualAidName(kind);
    this.reinforcements.push({ kind, name, eta: MUTUAL_AID_ETA });
    this.notify(`${name} requested from mutual aid. ETA ${MUTUAL_AID_ETA} s.`, 'info');
    this.hud.update(this.hudState(), true);
    return true;
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.roadStart = null;
    this.lineStart = null;
    this.preview = null;
    this.hidePlanPreview();
    this.roadPreviewKey = '';
    this.hud.setTool(tool);
    this.hud.update(this.hudState(), true);
  }

  private setSpeed(speed: number): void {
    if (speed <= 0) return;
    this.speed = speed;
    this.paused = false;
    this.hud.update(this.hudState(), true);
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.hud.update(this.hudState(), true);
  }

  private setAutoDispatch(enabled: boolean): void {
    this.incidents.autoDispatch = enabled;
    this.notify(enabled ? 'Auto-dispatch engaged.' : 'Auto-dispatch off. Manual control.', 'info');
    this.hud.update(this.hudState(), true);
  }

  private selectUnit(id: number | null): void {
    this.selectedUnitId = id;
    this.fleet.select(id);
    this.hud.update(this.hudState(), true);
  }

  private focusIncident(id: number): void {
    const incident = this.incidents.incidents.find((item) => item.id === id);
    if (!incident) return;
    this.rig.focus(incident.x, incident.z);
    this.rig.zoom(0.62);
  }

  private dispatchIncident(id: number): void {
    if (this.incidents.dispatchOne(id, this.fleet)) {
      const incident = this.incidents.incidents.find((item) => item.id === id);
      const sector = incident ? this.world.sectorName(incident.tx, incident.tz) : 'the fire';
      this.notify(`Dispatch ordered to ${sector}.`, 'info');
      this.sound.play('dispatch');
      this.hud.update(this.hudState(), true);
    }
  }

  private unitAction(id: number, action: UnitAction): void {
    if (action === 'line') {
      this.selectUnit(id);
      this.setTool('line');
      return;
    }
    if (action === 'home') {
      this.fleet.returnHome(id);
      this.notify(`${this.fleet.unitById(id)?.name ?? 'Unit'} returning to base.`, 'info');
    } else if (action === 'hold') {
      this.fleet.hold(id);
      this.notify(`${this.fleet.unitById(id)?.name ?? 'Unit'} holding position.`, 'info');
    } else {
      this.attackNearest(id);
    }
    this.hud.update(this.hudState(), true);
  }

  private attackNearest(unitId: number): void {
    const unit = this.fleet.unitById(unitId);
    if (!unit) return;
    if (unit.outOfService > 0) {
      this.notify(`${unit.name} is out of service after a burnover.`, 'warning');
      return;
    }
    let best: Incident | null = null;
    let bestDistance = Infinity;
    for (const incident of this.incidents.activeIncidents) {
      const dist = Math.hypot(incident.x - unit.x, incident.z - unit.z);
      if (dist < bestDistance) {
        best = incident;
        bestDistance = dist;
      }
    }
    let incident = best;
    if (!incident) {
      const target = this.fire.nearestActive(unit.x, unit.z, 70);
      if (target) incident = this.incidents.createAt(target.x, target.z, 'manual');
    }
    if (!incident) {
      this.notify('No active fire to attack.', 'warning');
      return;
    }
    if (unit.kind === 'firetruck' && !this.fleet.canReach(unitId, incident)) {
      this.notify(`${unit.name} cannot reach that fire by road. Try an aircraft.`, 'warning');
      return;
    }
    this.fleet.assignToIncident(unitId, incident);
    incident.assigned.add(unitId);
    this.notify(`${unit.name} attacking ${this.world.sectorName(incident.tx, incident.tz)}.`, 'info');
    this.sound.play('dispatch');
  }

  private frame = (now: number): void => {
    const realDt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.started) this.rig.rotate(realDt * 0.035);
    this.updateCameraInput(realDt);
    this.rig.update(realDt);
    if (this.started && !this.paused && !this.externalClock) {
      const simDt = realDt * this.speed;
      this.simulate(simDt);
    }
    this.markerTime += realDt;
    this.updateIncidentMarkers();
    this.effects.update(realDt);
    this.planPreview.update(this.markerTime);
    this.atmosphere.update(realDt, this.scenario.shiftProgress, this.fire.stats().burning);
    this.hudTimer -= realDt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.16;
      this.refreshSituation();
      this.updateHudCamera();
      this.hud.update(this.hudState());
    }
    const shake = this.effects.shake;
    const camera = this.rig.camera;
    const ox = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    const oy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    camera.position.x += ox;
    camera.position.y += oy;
    this.renderer.render(this.scene, camera);
    camera.position.x -= ox;
    camera.position.y -= oy;
    requestAnimationFrame(this.frame);
  };

  private simulate(dt: number): void {
    if (this.scenario.status !== 'running') {
      if (this.scenario.status === 'won' || this.scenario.status === 'lost') {
        if (this.lastScenarioStatus !== this.scenario.status) {
          this.lastScenarioStatus = this.scenario.status;
          this.hud.update(this.hudState(), true);
        }
      }
      return;
    }
    this.simAccumulator += dt;
    let steps = 0;
    while (this.simAccumulator >= SIM_STEP && steps < MAX_SIM_STEPS) {
      this.simAccumulator -= SIM_STEP;
      steps += 1;
      this.stepSimulation(SIM_STEP);
      if (this.scenario.status !== 'running') {
        this.simAccumulator = 0;
        break;
      }
    }
    if (steps >= MAX_SIM_STEPS) this.simAccumulator = 0;
    this.world.terrain.updateBurnTint(this.fire.state, dt, this.fire.wetness, this.fire.retardant);
    this.world.vegetation.updateBurnTint((index) => this.fire.state[index] ?? 0, dt);
    const wind = this.fire.windVector;
    const windLength = Math.hypot(wind.x, wind.z) || 1;
    this.particles.update(
      this.fire,
      dt,
      wind.x / windLength,
      wind.z / windLength,
      this.pixelPerWorld(),
    );
    if (this.lastScenarioStatus !== this.scenario.status) {
      this.lastScenarioStatus = this.scenario.status;
      if (this.isShiftOver()) this.onOutcome();
      this.hud.update(this.hudState(), true);
    }
  }

  /** One fixed step of the gameplay simulation. Visual-only updates live in simulate(). */
  private stepSimulation(dt: number): void {
    this.scenario.update(dt);
    this.budget.update(dt);
    this.updateSituation(dt);
    for (let i = this.reinforcements.length - 1; i >= 0; i -= 1) {
      const pending = this.reinforcements[i]!;
      pending.eta -= dt;
      if (pending.eta > 0) continue;
      this.reinforcements.splice(i, 1);
      this.fleet.addUnit(pending.kind, pending.name);
      const where = pending.kind === 'helicopter' || pending.kind === 'tanker' ? 'the helipad' : 'the station';
      this.notify(`${pending.name} has arrived at ${where} and is ready.`, 'success');
    }
    this.fire.step(dt);
    this.incidents.update(dt, this.fleet);
    this.fleet.update(dt, this.incidents.viewMap());
    this.world.buildings.update(
      dt,
      (index) => this.fire.state[index] ?? 0,
      (index) => this.fire.heat[index] ?? 0,
    );
    for (const building of this.world.buildings.buildings) {
      if (building.state === 'destroyed' && !this.destroyedBuildings.has(building.id)) {
        this.destroyedBuildings.add(building.id);
        this.hud.refreshMinimapBase();
        this.notify(`${labelBuilding(building.kind)} lost near ${this.world.sectorName(building.x0, building.z0)}.`, 'danger');
        this.sound.play('collapse');
        this.effects.addShake(0.6);
      }
    }
  }

  private updateCameraInput(dt: number): void {
    const speed = (this.rig.viewSize / 72) * 46 * dt;
    const forwardX = -Math.sin(this.rig.yaw);
    const forwardZ = -Math.cos(this.rig.yaw);
    const rightX = Math.cos(this.rig.yaw);
    const rightZ = -Math.sin(this.rig.yaw);
    let panX = 0;
    let panZ = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) {
      panX += forwardX * speed;
      panZ += forwardZ * speed;
    }
    if (this.keys.has('s') || this.keys.has('arrowdown')) {
      panX -= forwardX * speed;
      panZ -= forwardZ * speed;
    }
    if (this.keys.has('a') || this.keys.has('arrowleft')) {
      panX -= rightX * speed;
      panZ -= rightZ * speed;
    }
    if (this.keys.has('d') || this.keys.has('arrowright')) {
      panX += rightX * speed;
      panZ += rightZ * speed;
    }
    if (panX !== 0 || panZ !== 0) this.rig.pan(panX, panZ);
    if (this.keys.has('q')) this.rig.rotate(-dt * 1.1);
    if (this.keys.has('e')) this.rig.rotate(dt * 1.1);
    if (this.keys.has('r')) this.rig.tilt(-dt * 0.7);
    if (this.keys.has('f')) this.rig.tilt(dt * 0.7);
  }

  private pixelPerWorld(): number {
    return (this.renderer.domElement.height / this.rig.viewSize) * (window.devicePixelRatio > 1 ? 1.1 : 1);
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keyup', (event) => this.onKeyUp(event));
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.onPointerUp(event));
    canvas.addEventListener('pointerleave', () => {
      this.hoverTile = null;
      this.tileHighlight.visible = false;
      this.hidePlanPreview();
      this.roadPreviewKey = '';
      this.hud.setTooltip(null);
    });
  }

  private resize(): void {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    this.renderer.setSize(width, height);
    this.rig.setViewport(width, height);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      if (this.hud.isHelpOpen) {
        this.hud.setHelp(false);
        return;
      }
      if (this.roadStart || this.lineStart) {
        this.roadStart = null;
        this.lineStart = null;
        this.preview = null;
        this.hidePlanPreview();
        this.hud.update(this.hudState(), true);
        return;
      }
      if (this.tool !== 'select') {
        this.setTool('select');
        return;
      }
      if (this.selectedUnitId !== null) {
        this.selectUnit(null);
        return;
      }
    }
    if (key === 'h') {
      this.hud.setHelp(!this.hud.isHelpOpen);
      return;
    }
    if (key === 'm') {
      this.toggleMute();
      return;
    }
    if (key === 'v') {
      this.setTool('select');
      return;
    }
    if (key === 't' || key === 'i') {
      this.setTool('torch');
      return;
    }
    if (key === 'b') {
      this.setTool('road');
      return;
    }
    if (key === 'l') {
      this.setTool('line');
      return;
    }
    if (key === 'tab') {
      event.preventDefault();
      this.cycleUnit(event.shiftKey ? -1 : 1);
      return;
    }
    if (key === ' ') {
      event.preventDefault();
      this.togglePause();
      return;
    }
    if (key === '1' || key === '2' || key === '4') {
      this.setSpeed(Number(key));
      return;
    }
    this.keys.add(key);
    if (key.startsWith('arrow') || key === ' ') event.preventDefault();
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.keys.delete(event.key.toLowerCase());
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    };
    this.rig.zoom(Math.exp(event.deltaY * 0.0011), ndc);
  }

  private onPointerDown(event: PointerEvent): void {
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.panLastX = event.clientX;
    this.panLastY = event.clientY;
    this.downButton = event.button;
    if (event.button === 1) {
      event.preventDefault();
      this.pointerDown = true;
      this.renderer.domElement.setPointerCapture(event.pointerId);
    } else if (event.button === 0) {
      this.pointerDown = true;
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.pointerDown && this.downButton === 1) {
      const dx = event.clientX - this.panLastX;
      const dy = event.clientY - this.panLastY;
      this.panLastX = event.clientX;
      this.panLastY = event.clientY;
      this.rig.panByPixels(dx, dy);
      return;
    }
    this.updateHover(event);
  }

  private onPointerUp(event: PointerEvent): void {
    const moved = Math.abs(event.clientX - this.downX) + Math.abs(event.clientY - this.downY) > 7;
    const wasButton = this.downButton;
    this.pointerDown = false;
    this.downButton = -1;
    if (moved) return;
    this.updateHover(event);
    if (wasButton === 0) this.handleLeftClick(event);
    else if (wasButton === 2) this.handleRightClick();
  }

  private updateHover(event: PointerEvent): void {
    if (this.isShiftOver()) {
      this.hud.setTooltip(null);
      this.tileHighlight.visible = false;
      return;
    }
    if (!this.hoverTile) {
      this.tileHighlight.visible = false;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.rig.camera);

    const hits = this.raycaster.intersectObject(this.world.terrain.mesh, false);
    const point = hits[0]?.point;
    if (!point) {
      this.hoverTile = null;
      this.tileHighlight.visible = false;
      this.hidePlanPreview();
      this.hud.setTooltip(null);
      this.renderer.domElement.style.cursor = 'crosshair';
      return;
    }
    const tile = worldToTile(point.x, point.z);
    this.hoverTile = tile;
    this.hoverWorld = { x: point.x, z: point.z };

    const unitHit = this.raycaster
      .intersectObject(this.fleet.group, true)
      .find((hit) => typeof hit.object.userData.unitId === 'number');
    if (unitHit) {
      const id = unitHit.object.userData.unitId as number;
      const unit = this.fleet.unitById(id);
      if (unit) {
        this.hud.setTooltip(`${unit.name} · ${unit.status}`, event.clientX, event.clientY);
        this.tileHighlight.visible = false;
        this.renderer.domElement.style.cursor = 'pointer';
        return;
      }
    }

    const info = this.world.tileInfo(tile.x, tile.z);
    const index = tile.z * GRID_SIZE + tile.x;
    const state = this.fire.state[index] ?? FireState.Unburned;
    const fireLabel = fireStateLabel(state);
    const structure = this.world.buildings.buildingAt(tile.x, tile.z);
    const building = structure ? ` · ${labelBuilding(structure.kind)} (${structure.state})` : '';
    const fuel = this.fire.fuelAt(tile.x, tile.z).name;
    const extra = state !== FireState.Unburned ? ` · ${fireLabel}` : '';
    const wet = this.fire.wetness[index] ?? 0;
    const retardant = this.fire.retardant[index] ?? 0;
    const mods = `${wet > 0.08 ? ` · wet ${Math.round(wet * 100)}%` : ''}${retardant > 0.08 ? ` · retardant ${Math.round(retardant * 100)}%` : ''}`;
    this.hud.setTooltip(
      `${this.world.sectorName(tile.x, tile.z)} · ${info.terrain}${building}${extra} · ${fuel} · slope ${info.slope.toFixed(2)}${mods}`,
      event.clientX,
      event.clientY,
    );
    this.updateTileHighlight(tile);
    this.updateRoadPreview(tile);
    this.renderer.domElement.style.cursor = this.tool === 'select' ? 'default' : 'crosshair';
  }

  private handleLeftClick(event: PointerEvent): void {
    if (!this.started) return;
    if (!this.hoverTile || !this.hoverWorld) return;
    const tile = this.hoverTile;
    if (this.tool === 'torch') {
      this.manualTorch(tile.x, tile.z);
      return;
    }
    if (this.tool === 'road') {
      this.handleRoadClick(tile);
      return;
    }
    if (this.tool === 'line') {
      this.handleLineClick(tile);
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.rig.camera);
    const unitHit = this.raycaster
      .intersectObject(this.fleet.group, true)
      .find((hit) => typeof hit.object.userData.unitId === 'number');
    if (unitHit) {
      this.selectUnit(unitHit.object.userData.unitId as number);
      return;
    }
    if (this.selectedUnitId !== null) {
      const state = this.fire.stateAt(tile.x, tile.z);
      if (state === FireState.Burning || state === FireState.Igniting || state === FireState.Smoldering) {
        this.orderAttack(tile.x, tile.z);
        return;
      }
    }
    const nearby = this.incidents.activeIncidents.find(
      (incident) => Math.hypot(incident.x - this.hoverWorld!.x, incident.z - this.hoverWorld!.z) < 18,
    );
    if (nearby && this.selectedUnitId === null) {
      this.focusIncident(nearby.id);
      return;
    }
    this.selectUnit(null);
  }

  private handleRightClick(): void {
    if (!this.started || !this.hoverTile || !this.hoverWorld) return;
    if (this.selectedUnitId === null) return;
    const tile = this.hoverTile;
    const state = this.fire.stateAt(tile.x, tile.z);
    if (state === FireState.Burning || state === FireState.Igniting || state === FireState.Smoldering) {
      this.orderAttack(tile.x, tile.z);
      return;
    }
    const result = this.fleet.orderMove(this.selectedUnitId, this.hoverWorld.x, this.hoverWorld.z);
    if (!result.ok) {
      this.notify(result.message ?? 'Order failed.', 'warning');
    }
    this.hud.update(this.hudState(), true);
  }

  private orderAttack(tx: number, tz: number): void {
    if (this.selectedUnitId === null) return;
    const unit = this.fleet.unitById(this.selectedUnitId);
    if (!unit) return;
    if (unit.outOfService > 0) {
      this.notify(`${unit.name} is out of service after a burnover.`, 'warning');
      return;
    }
    // Direct orders are never capped: the player may commit the whole fleet.
    const incident = this.incidents.createAt(tx, tz, 'manual');
    if (unit.kind === 'firetruck' && !this.fleet.canReach(this.selectedUnitId, incident)) {
      this.notify(`${unit.name} cannot reach that fire by road. Use an aircraft.`, 'warning');
      return;
    }
    this.fleet.assignToIncident(this.selectedUnitId, incident);
    incident.assigned.add(this.selectedUnitId);
    this.notify(`${unit.name} ordered to ${this.world.sectorName(tx, tz)}.`, 'info');
    this.sound.play('dispatch');
    this.hud.update(this.hudState(), true);
  }

  private manualIgnite(tx: number, tz: number): void {
    const state = this.fire.stateAt(tx, tz);
    if (state !== FireState.Unburned && state !== FireState.Burned) {
      this.notify('That tile is already burning.', 'warning');
      return;
    }
    const fuel = this.fire.fuelAt(tx, tz);
    if (fuel.baseROS <= 0) {
      this.notify('No burnable fuel there.', 'warning');
      return;
    }
    if (!this.fire.ignite(tx, tz)) {
      this.notify('The fuel is too wet to catch.', 'warning');
      return;
    }
    this.incidents.createAt(tx, tz, 'manual');
    this.scenario.registerFireStarted();
    this.notify(`Fire started in ${this.world.sectorName(tx, tz)}.`, 'danger');
    this.hud.update(this.hudState(), true);
  }

  /**
   * Drip-torch backburn: light a short strip across the wind on fuel that
   * sits against a firebreak, ahead of an active fire. The burn stays under
   * control for BACKBURN_GENERATIONS tiles of spread before it turns wild.
   */
  private manualTorch(tx: number, tz: number): boolean {
    if (this.fire.stateAt(tx, tz) !== FireState.Unburned) {
      this.notify('That ground has already burned or is burning.', 'warning');
      return false;
    }
    if (this.fire.fuelAt(tx, tz).baseROS <= 0 || this.world.buildings.isOccupied(tx, tz)) {
      this.notify('Nothing to burn out there.', 'warning');
      return false;
    }
    if (!this.nearFirebreak(tx, tz)) {
      this.notify('Light backburns within 2 tiles of a road, dozer line, water, or burned ground.', 'warning');
      return false;
    }
    const world = tileToWorld(tx, tz);
    const ahead = this.incidents.activeIncidents.some((incident) => Math.hypot(incident.x - world.x, incident.z - world.z) < 76);
    if (!ahead) {
      this.notify('Backburns only make sense ahead of an active fire.', 'warning');
      return false;
    }
    if (!this.budget.canAfford(TORCH_COST)) {
      this.notify(`A backburn costs $${TORCH_COST}. Not enough budget yet.`, 'warning');
      return false;
    }
    const wind = this.fire.windVector;
    const length = Math.hypot(wind.x, wind.z) || 1;
    const perpX = -wind.z / length;
    const perpZ = wind.x / length;
    let lit = 0;
    for (let k = -1; k <= 1; k += 1) {
      const x = Math.round(tx + perpX * k);
      const z = Math.round(tz + perpZ * k);
      if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) continue;
      if (this.world.buildings.isOccupied(x, z) || !this.nearFirebreak(x, z)) continue;
      if (this.fire.ignite(x, z, false, BACKBURN_GENERATIONS)) lit += 1;
    }
    if (lit === 0) {
      this.notify('The fuel there is too wet to take a torch.', 'warning');
      return false;
    }
    this.budget.spend(TORCH_COST);
    this.sound.play('torch');
    this.notify(`Backburn lit in ${this.world.sectorName(tx, tz)}. Starve the fire before the head arrives.`, 'info');
    this.hud.update(this.hudState(), true);
    return true;
  }

  /** True if a road, cleared line, water, rock, or burned ground lies within `radius` tiles. */
  private nearFirebreak(tx: number, tz: number, radius = 2): boolean {
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = tx + dx;
        const z = tz + dz;
        if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) continue;
        const index = z * GRID_SIZE + x;
        if (this.world.roads.mask[index] === 1) return true;
        const state = this.fire.state[index];
        if (state === FireState.Cleared || state === FireState.Burned) return true;
        const fuel = this.fire.fuel[index];
        if (fuel === Fuel.Water || fuel === Fuel.Rock || fuel === Fuel.Road) return true;
      }
    }
    return false;
  }

  private handleLineClick(tile: { x: number; z: number }): void {
    if (!this.lineStart) {
      this.lineStart = { x: tile.x, z: tile.z };
      this.notify('Line start set. Click where the dozer line should end.', 'info');
      this.hud.update(this.hudState(), true);
      return;
    }
    const result = this.fleet.orderLine(this.selectedUnitId, this.lineStart, tile);
    this.notify(result.message, result.ok ? 'info' : 'warning');
    if (!result.ok) return;
    this.setTool('select');
    if (result.unitId !== undefined) this.selectUnit(result.unitId);
  }

  private cycleUnit(direction: number): void {
    const units = this.fleet.units;
    if (units.length === 0) return;
    const current = units.findIndex((unit) => unit.id === this.selectedUnitId);
    const next = units[(current + direction + units.length) % units.length] ?? units[0]!;
    this.selectUnit(next.id);
    this.rig.focus(next.x, next.z);
  }

  private onFleetRowClick(id: number): void {
    if (this.selectedUnitId === id) {
      const unit = this.fleet.unitById(id);
      if (unit) this.rig.focus(unit.x, unit.z);
      return;
    }
    this.selectUnit(id);
  }

  /** Planned road tiles that are not already asphalt. */
  private newRoadTiles(path: ReadonlyArray<{ x: number; z: number }>): number {
    let count = 0;
    for (const tile of path) if (!this.world.roads.has(tile.x, tile.z)) count += 1;
    return count;
  }

  private handleRoadClick(tile: { x: number; z: number }): void {
    if (this.world.isReservedForRoad(tile.x, tile.z)) {
      this.notify('That tile is reserved by a structure. Choose clear ground.', 'warning');
      return;
    }
    if (!this.roadStart) {
      this.roadStart = { x: tile.x, z: tile.z };
      this.notify('Road start set. Choose the destination tile.', 'info');
      this.hud.update(this.hudState(), true);
      return;
    }
    const planned = this.world.findOffroadPath(this.roadStart, tile, this.activeFireMask());
    if (!planned || planned.length < 2) {
      this.notify('No viable road route to that tile (crews will not pave through active fire).', 'warning');
      return;
    }
    const cost = this.newRoadTiles(planned) * ROAD_COST_PER_TILE;
    if (!this.budget.canAfford(cost)) {
      this.notify(`That road costs $${cost}. Budget available: $${Math.floor(this.budget.funds)}.`, 'warning');
      return;
    }
    const path = this.layRoad(this.roadStart, tile);
    if (path) {
      this.budget.spend(cost);
      this.notify(`Road laid: ${path.length} tiles for $${cost}. Hydrants follow the new asphalt.`, 'success');
      this.roadStart = null;
      this.preview = null;
    } else {
      this.notify('No viable road route to that tile (crews will not pave through active fire).', 'warning');
    }
    this.hidePlanPreview();
    this.hud.update(this.hudState(), true);
  }

  /** Tiles a road crew cannot work: anything currently on fire. */
  private activeFireMask(): Uint8Array {
    const mask = new Uint8Array(this.fire.state.length);
    for (let i = 0; i < mask.length; i += 1) {
      const state = this.fire.state[i];
      if (state === FireState.Igniting || state === FireState.Burning || state === FireState.Smoldering) mask[i] = 1;
    }
    return mask;
  }

  private layRoad(start: { x: number; z: number }, goal: { x: number; z: number }): { x: number; z: number }[] | null {
    const revision = this.world.terrainRevision;
    const path = this.world.buildRoad(start, goal, this.activeFireMask());
    if (!path) return null;
    for (const tile of path) this.playerRoads[tile.z * GRID_SIZE + tile.x] = 1;
    this.fire.refreshRoadMask(this.world.roads.mask);
    if (this.world.terrainRevision !== revision) this.fire.refreshTerrain(this.world.heightmap);
    this.hud.refreshMinimapBase();
    return path;
  }

  private updateTileHighlight(tile: { x: number; z: number }): void {
    const positions = this.tileHighlight.geometry.getAttribute('position');
    const h = this.world.heightmap;
    const corners: Array<[number, number]> = [
      [tile.x, tile.z],
      [tile.x, tile.z + 1],
      [tile.x + 1, tile.z + 1],
      [tile.x + 1, tile.z],
      [tile.x, tile.z],
    ];
    corners.forEach(([cx, cz], i) => {
      positions.setXYZ(
        i,
        cx * TILE_SIZE,
        h.vertexHeight(cx, cz) + 0.16,
        cz * TILE_SIZE,
      );
    });
    positions.needsUpdate = true;
    this.tileHighlight.visible = true;
    const material = this.tileHighlight.material as LineBasicMaterial;
    const colors: Record<Tool, number> = { select: 0xffe8a8, torch: 0xff8a3a, road: 0xffcf5e, line: 0xe9844a };
    material.color.setHex(colors[this.tool]);
  }

  private hidePlanPreview(): void {
    this.roadPreview.visible = false;
    this.planPreview.hide();
  }

  /** Read through a method so control-flow narrowing of the status does not stick. */
  private isShiftOver(): boolean {
    return this.scenario.status === 'won' || this.scenario.status === 'lost';
  }

  private updateRoadPreview(tile: { x: number; z: number }): void {
    const start = this.tool === 'road' ? this.roadStart : this.tool === 'line' ? this.lineStart : null;
    if (
      !start ||
      (this.tool === 'road' && (this.world.isReservedForRoad(start.x, start.z) || this.world.isReservedForRoad(tile.x, tile.z)))
    ) {
      this.hidePlanPreview();
      this.roadPreviewKey = '';
      this.preview = null;
      return;
    }
    const key = `${this.tool}:${start.x},${start.z}>${tile.x},${tile.z}`;
    if (key === this.roadPreviewKey && this.roadPreview.visible) return;
    this.roadPreviewKey = key;
    const path =
      this.tool === 'road' ? this.world.findOffroadPath(start, tile, this.activeFireMask()) : this.fleet.previewLine(start, tile);
    if (!path || path.length < 2) {
      this.hidePlanPreview();
      this.preview = null;
      return;
    }
    this.preview =
      this.tool === 'road'
        ? { tiles: path.length, cost: this.newRoadTiles(path) * ROAD_COST_PER_TILE }
        : { tiles: path.length, cost: 0 };
    const color = this.tool === 'road' ? 0xffd24a : 0xff7a24;
    (this.roadPreview.material as LineBasicMaterial).color.setHex(color);
    this.planPreview.show(path, color, this.preview.cost <= this.budget.funds);
    const positions = this.roadPreview.geometry.getAttribute('position');
    const limit = Math.min(path.length, positions.count);
    for (let i = 0; i < limit; i += 1) {
      const point = path[i];
      if (!point) continue;
      const world = tileToWorld(point.x, point.z);
      positions.setXYZ(i, world.x, this.world.heightmap.heightAt(world.x, world.z) + 0.24, world.z);
    }
    positions.needsUpdate = true;
    this.roadPreview.geometry.setDrawRange(0, limit);
    this.roadPreview.visible = true;
  }

  private updateIncidentMarkers(): void {
    const active = new Set<number>();
    for (const incident of this.incidents.activeIncidents) {
      active.add(incident.id);
      let marker = this.incidentMarkers.get(incident.id);
      if (!marker) {
        marker = createIncidentMarker();
        this.incidentMarkers.set(incident.id, marker);
        this.markerGroup.add(marker);
      }
      const y = this.world.heightmap.heightAt(incident.x, incident.z) + 0.24;
      marker.position.set(incident.x, y, incident.z);
      const scale = 1 + Math.sin(this.markerTime * 2.6 + incident.id) * 0.08;
      marker.scale.setScalar(scale);
      const material = marker.material as MeshBasicMaterial;
      material.opacity = 0.5 + Math.sin(this.markerTime * 2.6 + incident.id) * 0.16;
    }
    for (const [id, marker] of this.incidentMarkers) {
      if (active.has(id)) continue;
      this.markerGroup.remove(marker);
      marker.geometry.dispose();
      (marker.material as MeshBasicMaterial).dispose();
      this.incidentMarkers.delete(id);
    }
  }

  private updateHudCamera(): void {
    const aspect = this.viewport.clientWidth / Math.max(1, this.viewport.clientHeight);
    this.hud.lastCameraView = {
      x: this.rig.target.x,
      z: this.rig.target.z,
      width: this.rig.viewSize * aspect,
      height: this.rig.viewSize,
    };
  }

  private hudState(): HudState {
    const stats = this.fire.stats();
    const selected = this.selectedUnitId !== null ? this.fleet.unitById(this.selectedUnitId) : null;
    const snapshot = selected
      ? this.fleet.snapshots().find((unit) => unit.id === selected.id) ?? null
      : null;
    return {
      scenario: this.scenario.currentResult,
      fireActive: stats.burning + stats.igniting,
      fireBurning: stats.burning,
      burnedHectares: stats.burnedHectares,
      incidents: this.incidents.incidents,
      units: this.fleet.snapshots(),
      selectedUnit: snapshot,
      windDirection: this.scenario.windDirection,
      windSpeed: this.scenario.windSpeed,
      autoDispatch: this.incidents.autoDispatch,
      paused: this.paused,
      speed: this.speed,
      seed: this.seed,
      tool: this.tool,
      roadStart: this.roadStart !== null,
      lineStart: this.lineStart !== null,
      preview: this.preview,
      funds: this.budget.funds,
      income: this.budget.income,
      difficulty: this.difficulty,
      reinforcements: this.reinforcements.map((item) => ({ name: item.name, eta: item.eta })),
      mutualAidLeft: Math.max(0, MUTUAL_AID_LIMIT - this.mutualAidRequested),
      nextWind: this.scenario.nextWindShift(),
      nextStrikeIn: this.scenario.nextStrikeIn(),
      shiftTime: this.scenario.time,
      threats: this.threats,
      savedStructures: this.savedStructures.size,
      muted: this.sound.muted,
      best: this.best,
      newBest: this.newBest,
    };
  }

  private projectToScreen(x: number, y: number, z: number): { x: number; y: number } {
    const point = new Vector3(x, y, z).project(this.rig.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - point.y) / 2) * rect.height,
    };
  }

  private installTestApi(): void {
    const api: TestApi = {
      getState: () => ({
        seed: this.seed,
        started: this.started,
        paused: this.paused,
        speed: this.speed,
        tool: this.tool,
        difficulty: this.difficulty,
        funds: Math.floor(this.budget.funds),
        reinforcements: this.reinforcements.map((item) => ({ name: item.name, eta: item.eta })),
        plan: {
          tiles: this.preview?.tiles ?? 0,
          overlayVisible: this.planPreview.mesh.visible,
          lineVisible: this.roadPreview.visible,
        },
        scenario: this.scenario.currentResult,
        fire: this.fire.stats(),
        units: this.fleet.snapshots(),
        incidents: this.incidents.incidents.map((incident) => ({
          id: incident.id,
          x: incident.x,
          z: incident.z,
          severity: incident.severity,
          resolved: incident.resolved,
          assigned: [...incident.assigned],
          source: incident.source,
        })),
        buildings: {
          standing: this.world.buildings.intactCount,
          destroyed: this.world.buildings.destroyedCount,
          burning: this.world.buildings.burningCount,
          list: this.world.buildings.buildings.map((building) => ({
            id: building.id,
            kind: building.kind,
            x: building.x0,
            z: building.z0,
            state: building.state,
            damage: building.damage,
          })),
        },
        hydrants: this.world.hydrants.count,
        roads: this.world.roads.count(),
        vegetation: this.world.vegetation.totalInstances,
      }),
      start: () => this.startShift(),
      setRealtime: (enabled: boolean) => {
        this.externalClock = !enabled;
      },
      advanceTime: (ms: number) => {
        this.externalClock = true;
        const cap = Math.max(0, Math.min(ms, 8 * 60 * 1000));
        let remaining = cap / 1000;
        const step = 0.05;
        while (remaining > 0) {
          const dt = Math.min(step, remaining);
          this.simulate(dt);
          remaining -= dt;
        }
        this.hud.update(this.hudState(), true);
      },
      torch: (tx: number, tz: number) => this.manualTorch(tx, tz),
      orderLine: (sx: number, sz: number, gx: number, gz: number) =>
        this.fleet.orderLine(this.selectedUnitId, { x: sx, z: sz }, { x: gx, z: gz }).ok,
      requestMutualAid: (kind: UnitKind) => this.requestMutualAid(kind),
      setDifficulty: (id: DifficultyId) => this.chooseDifficulty(id),
      ignite: (tx: number, tz: number) => {
        this.manualIgnite(tx, tz);
        return this.fire.stateAt(tx, tz) !== FireState.Unburned;
      },
      selectUnit: (id: number) => this.selectUnit(id),
      dispatch: (incidentId: number) => {
        this.dispatchIncident(incidentId);
        return true;
      },
      setSpeed: (speed: number) => this.setSpeed(speed),
      getTile: (tx: number, tz: number) => ({
        ...this.world.tileInfo(tx, tz),
        fuel: this.fire.fuelAt(tx, tz).name,
        state: this.fire.stateAt(tx, tz),
        heat: this.fire.heat[tz * GRID_SIZE + tx] ?? 0,
        progress: this.fire.progress[tz * GRID_SIZE + tx] ?? 0,
        wetness: this.fire.wetness[tz * GRID_SIZE + tx] ?? 0,
      }),
      findBurnableNear: (tx: number, tz: number, radius: number) => {
        for (let r = 0; r <= radius; r += 1) {
          for (let dz = -r; dz <= r; dz += 1) {
            for (let dx = -r; dx <= r; dx += 1) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
              const x = tx + dx;
              const z = tz + dz;
              if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) continue;
              const index = z * GRID_SIZE + x;
              if (this.world.roads.has(x, z)) continue;
              if (this.fire.fuelAt(x, z).baseROS <= 0) continue;
              if ((this.fire.state[index] ?? 0) !== FireState.Unburned) continue;
              return { x, z };
            }
          }
        }
        return null;
      },
      focusTile: (tx: number, tz: number) => {
        const world = tileToWorld(tx, tz);
        this.rig.focus(world.x, world.z);
      },
      setView: (view) => this.rig.setView(view),
      focusIncident: (id: number) => this.focusIncident(id),
      setAutoDispatch: (enabled: boolean) => this.setAutoDispatch(enabled),
      buildRoad: (sx: number, sz: number, gx: number, gz: number) =>
        this.layRoad({ x: sx, z: sz }, { x: gx, z: gz })?.length ?? 0,
      screenPosition: (tx: number, tz: number) => {
        const world = tileToWorld(tx, tz);
        return this.projectToScreen(world.x, this.world.heightmap.heightAt(world.x, world.z) + 0.2, world.z);
      },
      unitScreenPosition: (id: number) => {
        const unit = this.fleet.unitById(id);
        if (!unit) return null;
        return this.projectToScreen(unit.x, unit.y + 0.9, unit.z);
      },
      roadFuelMismatches: () => {
        let mismatches = 0;
        for (let i = 0; i < this.world.roads.mask.length; i += 1) {
          if (this.world.roads.mask[i] === 1 && this.fire.fuel[i] !== 6) mismatches += 1;
        }
        return mismatches;
      },
      debugPick: (x: number, y: number) => {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((x - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((y - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.rig.camera);
        const unitHits = this.raycaster.intersectObject(this.fleet.group, true).map((hit) => ({
          name: hit.object.name,
          unitId: hit.object.userData.unitId,
          distance: hit.distance,
        }));
        const terrainHits = this.raycaster.intersectObject(this.world.terrain.mesh, false).map((hit) => ({
          name: hit.object.name,
          distance: hit.distance,
        }));
        return { unitHits, terrainHits, units: this.fleet.snapshots().map((u) => ({ id: u.id, x: u.x, z: u.z })) };
      },
    };
    (window as unknown as { __cinderline: TestApi }).__cinderline = api;
  }
}

function createTileHighlight(): LineLoop {
  const geometry = new BufferGeometry();
  const positions = new Float32BufferAttribute(new Float32Array(5 * 3), 3);
  geometry.setAttribute('position', positions);
  const material = new LineBasicMaterial({ color: 0xffe8a8, transparent: true, opacity: 0.95, toneMapped: false });
  const loop = new LineLoop(geometry, material);
  loop.visible = false;
  loop.renderOrder = 10;
  loop.name = 'tile-highlight';
  return loop;
}

function createRoadPreview(): Line {
  const geometry = new BufferGeometry();
  const positions = new Float32BufferAttribute(new Float32Array(400 * 3), 3);
  geometry.setAttribute('position', positions);
  const material = new LineBasicMaterial({ color: 0xffc95c, transparent: true, opacity: 0.9, toneMapped: false });
  const line = new Line(geometry, material);
  line.visible = false;
  line.renderOrder = 10;
  line.name = 'road-preview';
  return line;
}

function createIncidentMarker(): Mesh {
  const geometry = new RingGeometry(1.1, 1.45, 28);
  const material = new MeshBasicMaterial({
    color: 0xffb44f,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 9;
  return mesh;
}

function fireStateLabel(state: number): string {
  switch (state) {
    case FireState.Igniting:
      return 'Igniting';
    case FireState.Burning:
      return 'Burning';
    case FireState.Smoldering:
      return 'Smoldering';
    case FireState.Burned:
      return 'Burned';
    case FireState.Cleared:
      return 'Fireline';
    default:
      return 'Unburned';
  }
}

const BUILDING_LABELS: Record<string, string> = {
  barn: 'Barn',
  cabin: 'Cabin',
  station: 'Fire station',
  store: 'Storefront',
  chapel: 'Chapel',
  ranch: 'Ranch house',
  twostory: 'Farmhouse',
};

function labelBuilding(kind: string): string {
  return BUILDING_LABELS[kind] ?? 'House';
}
