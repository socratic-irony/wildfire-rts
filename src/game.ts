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
import { FireState, Wildfire } from './sim/fire';
import { ParticleSystem } from './sim/particles';
import { Fleet } from './sim/units';
import { Incident, IncidentSystem } from './sim/incidents';
import { Scenario } from './sim/scenario';
import { NotifyFn, NotifyTone } from './sim/types';
import { Hud, HudState, Tool } from './ui/hud';

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

  constructor(viewport: HTMLElement, seed: number) {
    this.viewport = viewport;
    this.seed = seed;
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

    this.notify = (message: string, tone: NotifyTone = 'info') => {
      this.hud?.toast(message, tone);
    };

    this.hud = new Hud(
      document.getElementById('ui') as HTMLElement,
      this.world,
      this.fire,
      {
        onStart: () => this.startShift(),
        onTool: (tool) => this.setTool(tool),
        onSpeed: (speed) => this.setSpeed(speed),
        onPause: () => this.togglePause(),
        onAutoDispatch: (enabled) => this.setAutoDispatch(enabled),
        onIncidentFocus: (id) => this.focusIncident(id),
        onIncidentDispatch: (id) => this.dispatchIncident(id),
        onUnitSelect: (id) => this.selectUnit(id),
        onUnitAction: (id, action) => this.unitAction(id, action),
        onMinimapFocus: (x, z) => this.rig.focus(x, z),
        onHelp: () => {
          this.keys.clear();
        },
        onRestart: () => this.restart(),
      },
      seed,
    );

    this.particles = new ParticleSystem(this.world.heightmap);
    this.scene.add(this.particles.group);
    this.fleet = new Fleet(this.world, this.fire, this.particles, this.notify);
    this.scene.add(this.fleet.group);
    this.incidents = new IncidentSystem(this.fire, this.notify);
    this.scenario = new Scenario(this.world, this.fire, this.incidents, this.notify, seed);
    this.incidents.onResolved = () => {
      this.scenario.registerIncidentContained();
    };
    this.scene.add(this.markerGroup);
    this.markerGroup.name = 'incident-markers';

    this.tileHighlight = createTileHighlight();
    this.scene.add(this.tileHighlight);
    this.roadPreview = createRoadPreview();
    this.scene.add(this.roadPreview);

    this.hud.setTool(this.tool);
    this.bindEvents();
    this.installTestApi();
    this.hud.update(this.hudState(), true);
    requestAnimationFrame(this.frame);
  }

  private startShift(): void {
    if (this.started) return;
    this.started = true;
    this.scenario.start();
    this.setTool('select');
    this.rig.zoom(0.9);
    this.hud.update(this.hudState(), true);
  }

  private restart(): void {
    const nextSeed = (Math.random() * 0xffffffff) >>> 0;
    window.location.href = `${window.location.pathname}?seed=${nextSeed}`;
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.roadStart = null;
    this.roadPreview.visible = false;
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
      this.hud.update(this.hudState(), true);
    }
  }

  private unitAction(id: number, action: 'home' | 'hold' | 'attack'): void {
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
    this.hudTimer -= realDt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.16;
      this.updateHudCamera();
      this.hud.update(this.hudState());
    }
    this.renderer.render(this.scene, this.rig.camera);
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
      this.hud.update(this.hudState(), true);
    }
  }

  /** One fixed step of the gameplay simulation. Visual-only updates live in simulate(). */
  private stepSimulation(dt: number): void {
    this.scenario.update(dt);
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
      this.roadPreview.visible = false;
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
      if (this.roadStart) {
        this.roadStart = null;
        this.roadPreview.visible = false;
        this.hud.update(this.hudState(), true);
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
    if (key === 'v') {
      this.setTool('select');
      return;
    }
    if (key === 'i') {
      this.setTool('ignite');
      return;
    }
    if (key === 'b') {
      this.setTool('road');
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
      this.roadPreview.visible = false;
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
    if (this.tool === 'ignite') {
      this.manualIgnite(tile.x, tile.z);
      return;
    }
    if (this.tool === 'road') {
      this.handleRoadClick(tile);
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
    // Direct orders are never capped: the player may commit the whole fleet.
    const incident = this.incidents.createAt(tx, tz, 'manual');
    if (unit.kind === 'firetruck' && !this.fleet.canReach(this.selectedUnitId, incident)) {
      this.notify(`${unit.name} cannot reach that fire by road. Use an aircraft.`, 'warning');
      return;
    }
    this.fleet.assignToIncident(this.selectedUnitId, incident);
    incident.assigned.add(this.selectedUnitId);
    this.notify(`${unit.name} ordered to ${this.world.sectorName(tx, tz)}.`, 'info');
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
    const path = this.layRoad(this.roadStart, tile);
    if (path) {
      this.notify(`Road laid: ${path.length} tiles.`, 'success');
      this.roadStart = null;
    } else {
      this.notify('No viable road route to that tile (crews will not pave through active fire).', 'warning');
    }
    this.roadPreview.visible = false;
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
    material.color.setHex(this.tool === 'ignite' ? 0xff8a3a : this.tool === 'road' ? 0xffcf5e : 0xffe8a8);
  }

  private updateRoadPreview(tile: { x: number; z: number }): void {
    if (
      this.tool !== 'road' ||
      !this.roadStart ||
      this.world.isReservedForRoad(this.roadStart.x, this.roadStart.z) ||
      this.world.isReservedForRoad(tile.x, tile.z)
    ) {
      this.roadPreview.visible = false;
      this.roadPreviewKey = '';
      return;
    }
    const key = `${this.roadStart.x},${this.roadStart.z}>${tile.x},${tile.z}`;
    if (key === this.roadPreviewKey && this.roadPreview.visible) return;
    this.roadPreviewKey = key;
    const path = this.world.findOffroadPath(this.roadStart, tile, this.activeFireMask());
    if (!path || path.length < 2) {
      this.roadPreview.visible = false;
      return;
    }
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
  const material = new LineBasicMaterial({ color: 0xffe8a8, transparent: true, opacity: 0.95 });
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
  const material = new LineBasicMaterial({ color: 0xffc95c, transparent: true, opacity: 0.9 });
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
