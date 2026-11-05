import {
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  Vector3,
} from 'three';
import { angleLerp, clamp, distance } from '../core/math';
import { GRID_SIZE, TILE_SIZE, tileIndex, tileToWorld, WORLD_SIZE, worldToTile } from '../world/constants';
import { WATER_LEVEL } from '../world/heightmap';
import { Terrain } from '../world/biomes';
import { World } from '../world/world';
import { FireState, QUERY_BURNING, QUERY_WILD, Wildfire } from './fire';
import { createVehicleModel, UnitKind, VehicleModel } from './vehicleModels';
import { ParticleSystem } from './particles';
import { IncidentView, NotifyFn, UnitSnapshot } from './types';

export type UnitState =
  | 'idle'
  | 'moving'
  | 'holding'
  | 'toIncident'
  | 'attacking'
  | 'refilling'
  | 'returning'
  | 'cutting';

interface UnitSpec {
  maxSpeed: number;
  capacity: number;
  sprayRate: number;
  refillRate: number;
  cruiseAltitude: number;
}

export const UNIT_SPECS: Record<UnitKind, UnitSpec> = {
  firetruck: { maxSpeed: 7.2, capacity: 4000, sprayRate: 62, refillRate: 620, cruiseAltitude: 0 },
  dozer: { maxSpeed: 3.3, capacity: 0, sprayRate: 0, refillRate: 0, cruiseAltitude: 0 },
  helicopter: { maxSpeed: 18, capacity: 1400, sprayRate: 0, refillRate: 900, cruiseAltitude: 13 },
  tanker: { maxSpeed: 26, capacity: 6000, sprayRate: 0, refillRate: 1200, cruiseAltitude: 19 },
};

/**
 * The station's own fleet. Ground units park nose to tail along the kerb of
 * the station street, in the lane on the station side; `offset` is along the
 * street from the tile in front of the station.
 */
const HOME_FLEET: Array<{ kind: UnitKind; name: string; offset: number }> = [
  { kind: 'firetruck', name: 'Engine 7', offset: -3.1 },
  { kind: 'firetruck', name: 'Engine 12', offset: 0.1 },
  { kind: 'dozer', name: 'Dozer 3', offset: 3.1 },
  { kind: 'helicopter', name: 'Helicopter 1', offset: 0 },
  { kind: 'tanker', name: 'Tanker 9', offset: 0 },
];

const MUTUAL_AID_NAMES: Record<UnitKind, string[]> = {
  firetruck: ['Engine 21', 'Engine 33', 'Engine 41'],
  dozer: ['Dozer 8', 'Dozer 14', 'Dozer 19'],
  helicopter: ['Helicopter 4', 'Helicopter 6', 'Helicopter 8'],
  tanker: ['Tanker 15', 'Tanker 22', 'Tanker 30'],
};

/**
 * Helicopter parking, relative to the helipad centre: the first helicopter
 * sits on the pad; later ones beside it, on the side away from the station
 * (x is multiplied by the layout's station side).
 */
const HELI_SLOTS: Array<[number, number]> = [
  [0, 0],
  [5.6, 0],
  [5.6, 5.6],
  [5.6, -5.6],
];
/**
 * Air tankers are far too big for a town helipad (a 22 m wingspan), so they
 * work from an air-tanker base just off the edge of the map, as real ones
 * do, and are hidden while parked there.
 */
const TANKER_BASE_OFFSET = 18;

interface LineTask {
  phase: 'toStart' | 'cut';
  /** Off-road tile path the dozer clears. */
  cut: Array<{ x: number; z: number }>;
  /** Player-drawn lines hold at the far end; automatic lines return home. */
  manual: boolean;
}

interface Unit {
  id: number;
  kind: UnitKind;
  name: string;
  model: VehicleModel;
  group: Group;
  x: number;
  z: number;
  y: number;
  heading: number;
  /** Ground units turn to this heading once parked at home. */
  homeHeading: number;
  maxSpeed: number;
  capacity: number;
  water: number;
  sprayRate: number;
  refillRate: number;
  cruiseAltitude: number;
  state: UnitState;
  status: string;
  incidentId: number | null;
  path: Array<{ x: number; z: number }>;
  pathIndex: number;
  repathTimer: number;
  hydrantConnected: boolean;
  refillMode: 'hydrant' | 'base' | 'water' | null;
  refillHydrantId: number | null;
  /** Lake dip point for helicopters refilling from open water. */
  refillTarget: { x: number; z: number } | null;
  lineTask: LineTask | null;
  manualTarget: { x: number; z: number } | null;
  dustTimer: number;
  homeX: number;
  homeZ: number;
  /** Aircraft only: 0 = flying at cruise altitude, 1 = settled on the pad. */
  parked: number;
  /** Helicopter only: 0 = cruise, 1 = hovering low over the lake. */
  dip: number;
  airBaseX: number;
  airBaseZ: number;
  airBaseGround: number;
  /** Heat stress from standing in fire; a burnover happens at 1. */
  exposure: number;
  /** Seconds until a unit pulled out by a burnover is available again. */
  outOfService: number;
  mutualAid: boolean;
  /** Seconds until a dozer next checks its route for fire. */
  hazardTimer: number;
  /** Auto-dispatch may claim this unit whenever it is free. */
  auto: boolean;
  /** Visual only: smoothed body pitch/roll and last position for banking. */
  pitch: number;
  roll: number;
  lastX: number;
  lastZ: number;
  lastHeading: number;
}

/** Selection ring size per kind (the ring mesh has a ~2 unit radius). */
const RING_SCALE: Record<UnitKind, number> = { firetruck: 0.8, dozer: 0.68, helicopter: 1.32, tanker: 2.1 };

/** Ground vehicles ride this far above the sampled terrain. */
const GROUND_CLEARANCE = 0.02;
/** Helicopter skids rest on the pad surface. */
const HELI_PAD_HEIGHT = 0.08;

/** Off-map air-tanker base for a helipad position: beyond the nearest map edge. */
export function tankerBase(padX: number, padZ: number): { x: number; z: number } {
  const edges = [
    { d: padX, x: -TANKER_BASE_OFFSET, z: padZ },
    { d: WORLD_SIZE - padX, x: WORLD_SIZE + TANKER_BASE_OFFSET, z: padZ },
    { d: padZ, x: padX, z: -TANKER_BASE_OFFSET },
    { d: WORLD_SIZE - padZ, x: padX, z: WORLD_SIZE + TANKER_BASE_OFFSET },
  ];
  edges.sort((a, b) => a.d - b.d);
  return { x: edges[0]!.x, z: edges[0]!.z };
}

/** Hose reach in world units. */
const HOSE_RANGE = 12.5;
/**
 * Engines drive in the right-hand lane: a road tile is two lanes of one world
 * unit each, so the lane centre is about half a unit off the centreline.
 */
const ENGINE_LANE = 0.48;
/** Ground units within this distance of home are parked. */
const HOME_RADIUS = 2.2;
/** Seconds between retries when a route home cannot be planned. */
const REPATH_RETRY = 2;
/** Helicopter bucket fill rate while hovering over open water (L/s). */
const DIP_RATE = 700;
/** Hover height above the lake surface while dipping. */
const DIP_ALTITUDE = 2.6;
/** Dozer speed while cutting, relative to its travel speed. */
const CUT_SPEED_SCALE = 0.85;
/** Exposure gained per second on a burning tile, scaled by (0.4 + heat). */
const BURNOVER_RATE = 0.6;
/** How often a dozer looks ahead along its route for fire. */
const HAZARD_CHECK_SECONDS = 0.5;
/** Waypoints ahead a dozer checks for fire. */
const HAZARD_LOOKAHEAD = 4;
const EXPOSURE_RECOVERY = 0.3;
const OUT_OF_SERVICE_SECONDS = 25;
/** Simulated seconds an incident's attack positions stay cached. */
const ATTACK_CACHE_SECONDS = 1;
/** Longest dozer line a single order will cut, in tiles. */
const MAX_LINE_TILES = 60;

function airBaseName(kind: UnitKind): string {
  return kind === 'tanker' ? 'tanker base' : 'helipad';
}

function isAirKind(kind: UnitKind): boolean {
  return kind === 'helicopter' || kind === 'tanker';
}

export type LineOrderResult = { ok: boolean; message: string; unitId?: number };
export type FleetEvent = 'waterDrop' | 'retardant' | 'burnover' | 'lineDone' | 'dip' | 'hydrantRefill';

export class Fleet {
  readonly group = new Group();
  readonly units: Unit[] = [];
  /** Notified of moments worth a sound or a screen shake. */
  onEvent: ((event: FleetEvent, x: number, z: number, unitId?: number) => void) | null = null;
  private readonly selectionRing: Mesh;
  private readonly destinationRing: Mesh;
  /** Hoses from a hydrant to each engine filling from or fed by it. */
  private readonly hoses: Mesh[] = [];
  /** Pulsing rings on hydrants that engines are driving to or filling from. */
  private readonly refillRings: Mesh[] = [];
  private readonly hoseGroup = new Group();
  private readonly hoseGeometry = new CylinderGeometry(0.045, 0.045, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  private readonly hoseMaterial = new MeshStandardMaterial({ color: 0xd8c27a, roughness: 0.7, emissive: 0x2a2208 });
  private readonly refillRingGeometry = new RingGeometry(0.6, 0.82, 24).rotateX(-Math.PI / 2);
  private readonly refillRingMaterial = new MeshBasicMaterial({
    color: 0x9cf0ff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  private readonly hoseFrom = new Vector3();
  private readonly hoseTo = new Vector3();
  private selectedId: number | null = null;
  private time = 0;
  private readonly scratchTarget = { x: 0, z: 0 };
  private readonly avoidMask = new Uint8Array(GRID_SIZE * GRID_SIZE);
  private readonly waterPoints: Array<{ x: number; z: number }> = [];
  private readonly mutualAidCount: Record<UnitKind, number> = { firetruck: 0, dozer: 0, helicopter: 0, tanker: 0 };
  private readonly attackCache = new Map<string, { time: number; positions: Array<{ x: number; z: number; score: number }> }>();
  /** Auto setting given to units that join the fleet (mutual aid). */
  autoDefault = true;

  constructor(
    private readonly world: World,
    private readonly fire: Wildfire,
    private readonly particles: ParticleSystem,
    private readonly notify: NotifyFn,
  ) {
    this.group.name = 'fleet';
    const station = world.stationRoad;
    // The station sits on the +z side of its street tile; park in that lane.
    const alongX = world.roads.has(station.x - 1, station.z) || world.roads.has(station.x + 1, station.z);
    for (const entry of HOME_FLEET) {
      if (isAirKind(entry.kind)) {
        const home = this.airHome(entry.kind);
        this.spawn(entry.kind, entry.name, home.x, home.z, false);
      } else if (alongX) {
        this.spawn(entry.kind, entry.name, station.wx + entry.offset, station.wz + ENGINE_LANE, false, Math.PI / 2);
      } else {
        this.spawn(entry.kind, entry.name, station.wx - ENGINE_LANE, station.wz + entry.offset, false, 0);
      }
    }

    for (let tz = 0; tz < GRID_SIZE; tz += 1) {
      for (let tx = 0; tx < GRID_SIZE; tx += 1) {
        if (world.biomes.types[tileIndex(tx, tz)] === Terrain.Water) this.waterPoints.push(tileToWorld(tx, tz));
      }
    }

    const ringGeometry = new RingGeometry(1.8, 2.08, 32);
    this.selectionRing = new Mesh(
      ringGeometry,
      new MeshBasicMaterial({
        color: 0xffd56a,
        transparent: true,
        opacity: 0.95,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.renderOrder = 8;
    this.selectionRing.visible = false;
    this.selectionRing.name = 'selection-ring';

    this.destinationRing = new Mesh(
      new RingGeometry(0.55, 0.78, 24),
      new MeshBasicMaterial({
        color: 0x8ee8d2,
        transparent: true,
        opacity: 0.8,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    this.destinationRing.rotation.x = -Math.PI / 2;
    this.destinationRing.renderOrder = 8;
    this.destinationRing.visible = false;
    this.destinationRing.name = 'destination-ring';

    this.hoseGroup.name = 'hydrant-hoses';
    this.group.add(this.selectionRing, this.destinationRing, this.hoseGroup);
  }

  private spawn(kind: UnitKind, name: string, x: number, z: number, mutualAid: boolean, heading = 0): Unit {
    const spec = UNIT_SPECS[kind];
    const id = this.units.length + 1;
    const model = createVehicleModel(kind);
    const group = new Group();
    group.name = name;
    group.add(model.group);
    group.userData.unitId = id;
    group.traverse((child) => {
      child.userData.unitId = id;
    });
    const isAir = isAirKind(kind);
    const ground = this.world.heightmap.heightAt(x, z);
    const y = isAir ? ground + (kind === 'helicopter' ? HELI_PAD_HEIGHT : 0.3) : ground + GROUND_CLEARANCE;
    const unit: Unit = {
      id,
      kind,
      name,
      model,
      group,
      x,
      z,
      y,
      heading,
      homeHeading: heading,
      maxSpeed: spec.maxSpeed,
      capacity: spec.capacity,
      water: spec.capacity,
      sprayRate: spec.sprayRate,
      refillRate: spec.refillRate,
      cruiseAltitude: spec.cruiseAltitude,
      state: 'idle',
      status: kind === 'tanker' ? 'Ready at tanker base' : isAir ? 'Ready at helipad' : 'Ready at station',
      incidentId: null,
      path: [],
      pathIndex: 0,
      repathTimer: 0,
      hydrantConnected: false,
      refillMode: null,
      refillHydrantId: null,
      refillTarget: null,
      lineTask: null,
      manualTarget: null,
      dustTimer: 0,
      homeX: x,
      homeZ: z,
      parked: isAir ? 1 : 0,
      dip: 0,
      airBaseX: x,
      airBaseZ: z,
      airBaseGround: ground,
      exposure: 0,
      outOfService: 0,
      mutualAid,
      hazardTimer: 0,
      auto: this.autoDefault,
      pitch: 0,
      roll: 0,
      lastX: x,
      lastZ: z,
      lastHeading: heading,
    };
    group.position.set(x, y, z);
    group.rotation.order = 'YXZ';
    if (kind === 'tanker') group.visible = false;
    this.units.push(unit);
    this.group.add(group);
    return unit;
  }

  /** Reserve the call sign for the next mutual-aid unit of this kind. */
  reserveMutualAidName(kind: UnitKind): string {
    const names = MUTUAL_AID_NAMES[kind];
    const name = names[this.mutualAidCount[kind] % names.length] ?? `${kind} ${this.units.length + 1}`;
    this.mutualAidCount[kind] += 1;
    return name;
  }

  /** Bring a mutual-aid unit into service at the station (ground) or helipad (air). */
  addUnit(kind: UnitKind, name = this.reserveMutualAidName(kind)): { id: number; name: string } {
    if (isAirKind(kind)) {
      const home = this.airHome(kind);
      const unit = this.spawn(kind, name, home.x, home.z, true);
      return { id: unit.id, name };
    }
    const home = this.freeRoadParking();
    const unit = this.spawn(kind, name, home.x, home.z, true, home.heading);
    return { id: unit.id, name };
  }

  /** Parking spot for the next aircraft of a kind (see HELI_SLOTS and TANKER_BASE_OFFSET). */
  private airHome(kind: UnitKind): { x: number; z: number } {
    const pad = this.world.airbase;
    if (kind === 'tanker') return tankerBase(pad.x, pad.z);
    const count = this.units.filter((unit) => unit.kind === 'helicopter').length;
    const slot = HELI_SLOTS[count % HELI_SLOTS.length] ?? [0, 0];
    const side = this.world.heightmap.layout.side;
    return { x: pad.x + slot[0] * side, z: pad.z + slot[1] };
  }

  /** A kerbside spot on a road tile near the station that no ground unit is parked on. */
  private freeRoadParking(): { x: number; z: number; heading: number } {
    const station = this.world.stationRoad;
    const start = { x: station.x, z: station.z };
    const seen = new Uint8Array(GRID_SIZE * GRID_SIZE);
    const queue: Array<{ x: number; z: number; depth: number }> = [{ ...start, depth: 0 }];
    seen[tileIndex(start.x, start.z)] = 1;
    while (queue.length > 0) {
      const tile = queue.shift()!;
      const world = tileToWorld(tile.x, tile.z);
      const alongX = this.world.roads.has(tile.x - 1, tile.z) || this.world.roads.has(tile.x + 1, tile.z);
      const spot = alongX
        ? { x: world.x, z: world.z + ENGINE_LANE, heading: Math.PI / 2 }
        : { x: world.x - ENGINE_LANE, z: world.z, heading: 0 };
      const taken = this.units.some(
        (unit) => !isAirKind(unit.kind) && distance(unit.homeX, unit.homeZ, spot.x, spot.z) < 2.6,
      );
      if (tile.depth >= 2 && !taken) return spot;
      for (const next of this.world.roads.neighbors(tile.x, tile.z)) {
        const index = tileIndex(next.x, next.z);
        if (seen[index]) continue;
        seen[index] = 1;
        queue.push({ x: next.x, z: next.z, depth: tile.depth + 1 });
      }
    }
    return { x: station.wx, z: station.wz + 2, heading: 0 };
  }

  snapshots(): UnitSnapshot[] {
    return this.units.map((unit) => ({
      id: unit.id,
      kind: unit.kind,
      name: unit.name,
      state: unit.state,
      status: unit.status,
      water: unit.water,
      capacity: unit.capacity,
      x: unit.x,
      z: unit.z,
      incidentId: unit.incidentId,
      hydrantConnected: unit.hydrantConnected,
      selected: unit.id === this.selectedId,
      outOfService: unit.outOfService,
      exposure: unit.exposure,
      mutualAid: unit.mutualAid,
      auto: unit.auto,
      heading: unit.heading,
      refill: this.refillSnapshot(unit),
    }));
  }

  private refillSnapshot(unit: Unit): { x: number; z: number; filling: boolean } | null {
    if (unit.state !== 'refilling' || unit.refillMode !== 'hydrant' || unit.refillHydrantId === null) return null;
    const hydrant = this.world.hydrants.byId(unit.refillHydrantId);
    if (!hydrant) return null;
    return { x: hydrant.x, z: hydrant.z, filling: unit.status === 'Refilling at hydrant' };
  }

  /** Let auto-dispatch claim a unit (or stop it from doing so). */
  setAuto(unitId: number, enabled: boolean): void {
    const unit = this.unitById(unitId);
    if (unit) unit.auto = enabled;
  }

  /** Put every unit, and units that arrive later, on auto or manual. */
  setAllAuto(enabled: boolean): void {
    this.autoDefault = enabled;
    for (const unit of this.units) unit.auto = enabled;
  }

  /** 'all' when every unit is on auto, 'none' when none are, otherwise 'some'. */
  get autoMode(): 'all' | 'some' | 'none' {
    let on = 0;
    for (const unit of this.units) if (unit.auto) on += 1;
    return on === this.units.length ? 'all' : on === 0 ? 'none' : 'some';
  }

  get selectedUnit(): Unit | null {
    return this.units.find((unit) => unit.id === this.selectedId) ?? null;
  }

  unitById(id: number): Unit | null {
    return this.units.find((unit) => unit.id === id) ?? null;
  }

  select(id: number | null): void {
    this.selectedId = id;
    this.selectionRing.visible = id !== null;
  }

  /** Number of engines currently putting water on fire. */
  get sprayingCount(): number {
    let count = 0;
    for (const unit of this.units) if (unit.state === 'attacking' && unit.kind === 'firetruck') count += 1;
    return count;
  }

  assignToIncident(unitId: number, incident: IncidentView): void {
    const unit = this.unitById(unitId);
    if (!unit) return;
    unit.incidentId = incident.id;
    unit.manualTarget = null;
    unit.path = [];
    unit.pathIndex = 0;
    unit.repathTimer = 0;
    unit.lineTask = null;
    unit.refillTarget = null;
    if (unit.kind === 'dozer') {
      unit.state = 'cutting';
      unit.status = 'Planning a line';
    } else if (isAirKind(unit.kind)) {
      unit.state = 'toIncident';
      unit.status = 'Airborne to fire';
    } else {
      unit.state = 'toIncident';
      unit.status = 'Driving to fire';
    }
  }

  assignedCount(incidentId: number): number {
    return this.units.filter((unit) => unit.incidentId === incidentId && unit.state !== 'idle').length;
  }

  assignedKinds(incidentId: number): Set<UnitKind> {
    const kinds = new Set<UnitKind>();
    for (const unit of this.units) {
      if (unit.incidentId === incidentId && unit.state !== 'idle') kinds.add(unit.kind);
    }
    return kinds;
  }

  /**
   * Nearest free unit of a category that can work the incident. With
   * `autoOnly`, only units on auto are considered, and an auto unit left
   * holding (it was switched back to auto after a manual order) counts as free.
   */
  bestIdle(
    incident: IncidentView,
    category: 'ground' | 'air' | 'dozer' | 'any',
    autoOnly = false,
  ): { id: number; kind: UnitKind; distance: number } | null {
    let best: { id: number; kind: UnitKind; distance: number } | null = null;
    for (const unit of this.units) {
      if (unit.outOfService > 0) continue;
      if (autoOnly) {
        if (!unit.auto) continue;
        if (unit.state !== 'idle' && unit.state !== 'holding') continue;
      } else if (unit.state !== 'idle') continue;
      if (unit.kind === 'firetruck') {
        if (category === 'air' || category === 'dozer') continue;
        if (unit.water < 80) continue;
        if (!this.canReach(unit.id, incident)) continue;
      } else if (unit.kind === 'dozer') {
        if (category === 'air' || category === 'ground') continue;
      } else {
        if (category === 'ground' || category === 'dozer') continue;
        if (unit.water < 40) continue;
      }
      const dist = Math.hypot(unit.x - incident.x, unit.z - incident.z);
      if (!best || dist < best.distance) best = { id: unit.id, kind: unit.kind, distance: dist };
    }
    return best;
  }

  assignBest(incident: IncidentView, category: 'ground' | 'air' | 'dozer' | 'any', autoOnly = false): boolean {
    const best = this.bestIdle(incident, category, autoOnly);
    if (!best) return false;
    this.assignToIncident(best.id, incident);
    return true;
  }

  canReach(unitId: number, incident: IncidentView): boolean {
    const unit = this.unitById(unitId);
    if (!unit) return false;
    if (unit.kind !== 'firetruck') return true;
    const current = this.currentRoadTile(unit);
    if (!current) return false;
    if (!this.fire.isActiveNear(incident.x, incident.z, 26, QUERY_WILD)) {
      // Nothing burning yet: plain road access near the incident is enough.
      const road = this.world.roads.nearest(incident.tx, incident.tz, 6);
      return road !== null && this.world.roads.connected(current, road);
    }
    const positions = this.attackPositions(incident.x, incident.z, null);
    return positions.some((position) => this.world.roads.connected(current, position));
  }

  orderMove(unitId: number, wx: number, wz: number): { ok: boolean; message?: string } {
    const unit = this.unitById(unitId);
    if (!unit) return { ok: false };
    if (unit.outOfService > 0) return { ok: false, message: `${unit.name} is out of service after a burnover.` };
    unit.incidentId = null;
    unit.manualTarget = { x: wx, z: wz };
    unit.lineTask = null;
    unit.refillTarget = null;
    unit.hydrantConnected = false;
    if (isAirKind(unit.kind)) {
      unit.state = 'moving';
      unit.status = 'Airborne';
      unit.path = [];
      return { ok: true };
    }
    const tile = worldToTile(wx, wz);
    if (unit.kind === 'dozer') {
      const current = worldToTile(unit.x, unit.z);
      const path = this.world.findOffroadPath(current, tile, this.fireAvoidMask()) ?? this.world.findOffroadPath(current, tile);
      if (!path) return { ok: false, message: 'No passable route for the dozer.' };
      unit.path = path;
      unit.pathIndex = path.length > 1 ? 1 : 0;
      unit.state = 'moving';
      unit.status = 'Moving';
      return { ok: true };
    }
    const road = this.world.roads.nearest(tile.x, tile.z, 14);
    if (!road) return { ok: false, message: 'No road near that position.' };
    const current = this.currentRoadTile(unit);
    if (!current) return { ok: false, message: 'Engine is off the road network.' };
    const path = this.world.roads.findPath(current, road);
    if (!path) return { ok: false, message: 'No connected road route.' };
    unit.path = path;
    unit.pathIndex = path.length > 1 ? 1 : 0;
    unit.state = 'moving';
    unit.status = 'Driving';
    return { ok: true };
  }

  /**
   * Order a dozer to cut a fireline between two tiles. Uses the given dozer
   * if it is one, otherwise the nearest dozer that is in service.
   */
  orderLine(unitId: number | null, start: { x: number; z: number }, end: { x: number; z: number }): LineOrderResult {
    const preferred = unitId !== null ? this.unitById(unitId) : null;
    let dozer = preferred && preferred.kind === 'dozer' && preferred.outOfService <= 0 ? preferred : null;
    if (!dozer) {
      let bestDistance = Infinity;
      const target = tileToWorld(start.x, start.z);
      for (const unit of this.units) {
        if (unit.kind !== 'dozer' || unit.outOfService > 0) continue;
        const busyPenalty = unit.lineTask ? 40 : 0;
        const d = distance(unit.x, unit.z, target.x, target.z) + busyPenalty;
        if (d < bestDistance) {
          bestDistance = d;
          dozer = unit;
        }
      }
    }
    if (!dozer) return { ok: false, message: 'No dozer is available to cut a line.' };
    const avoid = this.fireAvoidMask();
    const cut = this.world.findOffroadPath(start, end, avoid);
    if (!cut || cut.length < 2) return { ok: false, message: 'No clear ground for a line there.' };
    if (cut.length > MAX_LINE_TILES) return { ok: false, message: `Lines are limited to ${MAX_LINE_TILES} tiles.` };
    const here = worldToTile(dozer.x, dozer.z);
    const approach = this.world.findOffroadPath(here, start, avoid) ?? this.world.findOffroadPath(here, start);
    if (!approach) return { ok: false, message: `${dozer.name} cannot reach the start of that line.` };
    dozer.incidentId = null;
    dozer.manualTarget = null;
    dozer.lineTask = { phase: 'toStart', cut, manual: true };
    dozer.path = approach;
    dozer.pathIndex = approach.length > 1 ? 1 : 0;
    dozer.state = 'cutting';
    dozer.status = 'Driving to line start';
    return { ok: true, message: `${dozer.name} will cut a ${cut.length}-tile line.`, unitId: dozer.id };
  }

  /** Preview of the tiles a dozer line between two points would clear. */
  previewLine(start: { x: number; z: number }, end: { x: number; z: number }): Array<{ x: number; z: number }> | null {
    return this.world.findOffroadPath(start, end, this.fireAvoidMask());
  }

  returnHome(unitId: number): void {
    const unit = this.unitById(unitId);
    if (!unit) return;
    unit.incidentId = null;
    unit.manualTarget = null;
    unit.lineTask = null;
    unit.refillTarget = null;
    unit.hydrantConnected = false;
    unit.state = 'returning';
    unit.status = isAirKind(unit.kind) ? `Returning to ${airBaseName(unit.kind)}` : 'Returning to station';
    if (!isAirKind(unit.kind)) {
      unit.path = [];
      unit.pathIndex = 0;
      unit.repathTimer = 0;
      if (!this.planHomePath(unit)) unit.repathTimer = REPATH_RETRY;
    }
  }

  /** Send a unit to top up now: engines to the nearest reachable hydrant, aircraft to water or the pad. */
  orderRefill(unitId: number): { ok: boolean; message: string } {
    const unit = this.unitById(unitId);
    if (!unit) return { ok: false, message: 'No such unit.' };
    if (unit.capacity <= 0) return { ok: false, message: `${unit.name} has no tank to fill.` };
    if (unit.outOfService > 0) return { ok: false, message: `${unit.name} is out of service after a burnover.` };
    if (unit.water >= unit.capacity - 1) return { ok: false, message: `${unit.name} is already full.` };
    unit.incidentId = null;
    unit.manualTarget = null;
    unit.lineTask = null;
    unit.refillTarget = null;
    if (isAirKind(unit.kind)) {
      if (unit.kind === 'helicopter') this.beginAirRefill(unit);
      else {
        unit.state = 'returning';
        unit.status = `Returning to ${airBaseName(unit.kind)}`;
      }
      return {
        ok: true,
        message: unit.refillMode === 'water' ? `${unit.name} dipping at the lake.` : `${unit.name} returning to the ${airBaseName(unit.kind)} to reload.`,
      };
    }
    this.beginRefill(unit);
    return {
      ok: true,
      message:
        unit.refillMode === 'hydrant'
          ? `${unit.name} driving to the nearest hydrant to refill.`
          : `${unit.name} has no hydrant on its road network; returning to the station.`,
    };
  }

  hold(unitId: number): void {
    const unit = this.unitById(unitId);
    if (!unit) return;
    unit.incidentId = null;
    unit.manualTarget = null;
    unit.lineTask = null;
    unit.refillTarget = null;
    unit.path = [];
    unit.state = 'holding';
    unit.status = 'Holding position';
  }

  update(dt: number, incidentLookup: Map<number, IncidentView>): void {
    this.time += dt;
    for (const unit of this.units) {
      unit.repathTimer -= dt;
      this.updateAnimations(unit, dt);
      this.updateExposure(unit, dt);
      if (unit.kind === 'dozer') this.avoidFireAhead(unit, dt);
      if (unit.state === 'idle') this.updateIdle(unit, dt);
      else if (unit.state === 'moving') this.updateMoving(unit, dt);
      else if (unit.state === 'holding') this.updateHolding(unit, dt);
      else if (unit.state === 'cutting') this.updateDozerLine(unit, incidentLookup, dt);
      else if (unit.state === 'toIncident') this.updateToIncident(unit, incidentLookup, dt);
      else if (unit.state === 'attacking') this.updateAttacking(unit, incidentLookup, dt);
      else if (unit.state === 'refilling') this.updateRefilling(unit, incidentLookup, dt);
      else if (unit.state === 'returning') this.updateReturning(unit, incidentLookup, dt);
      if (unit.outOfService > 0 && unit.state === 'idle') unit.status = `Out of service ${Math.ceil(unit.outOfService)}s`;
      this.applyTransform(unit, dt);
    }
    this.updateMarkers();
  }

  /**
   * Ground crews caught on a burning tile accumulate heat stress. At full
   * exposure the crew pulls out and the unit is out of service for a while.
   */
  private updateExposure(unit: Unit, dt: number): void {
    if (unit.outOfService > 0) {
      unit.outOfService = Math.max(0, unit.outOfService - dt);
      if (unit.outOfService === 0) this.notify(`${unit.name} is back in service.`, 'info');
    }
    if (isAirKind(unit.kind)) return;
    const tile = worldToTile(unit.x, unit.z);
    const index = tileIndex(tile.x, tile.z);
    const state = this.fire.state[index];
    if (state === FireState.Burning || state === FireState.Igniting) {
      unit.exposure += dt * BURNOVER_RATE * (0.4 + (this.fire.heat[index] ?? 0));
    } else {
      unit.exposure = Math.max(0, unit.exposure - dt * EXPOSURE_RECOVERY);
    }
    if (unit.exposure < 1) return;
    unit.exposure = 0;
    if (unit.outOfService > 0) return;
    unit.outOfService = OUT_OF_SERVICE_SECONDS;
    this.notify(`Burnover! ${unit.name} pulled out of the fire. Out of service for ${OUT_OF_SERVICE_SECONDS} s.`, 'danger');
    this.onEvent?.('burnover', unit.x, unit.z);
    this.returnHome(unit.id);
    unit.status = 'Burnover — pulling out';
  }

  /** True if any of the next few waypoints is burning. */
  private routeAheadBurning(unit: Unit, lookahead = HAZARD_LOOKAHEAD): boolean {
    const end = Math.min(unit.path.length, unit.pathIndex + lookahead);
    for (let i = unit.pathIndex; i < end; i += 1) {
      const point = unit.path[i]!;
      const state = this.fire.state[tileIndex(point.x, point.z)];
      if (state === FireState.Burning || state === FireState.Igniting) return true;
    }
    return false;
  }

  /**
   * Dozers re-plan around fire that moves across their route, and stop
   * cutting when the fire reaches the line ahead of the blade.
   */
  private avoidFireAhead(unit: Unit, dt: number): void {
    unit.hazardTimer -= dt;
    if (unit.hazardTimer > 0 || unit.path.length === 0) return;
    unit.hazardTimer = HAZARD_CHECK_SECONDS;
    const task = unit.lineTask;
    if (unit.state === 'cutting' && task && task.phase === 'cut') {
      if (!this.routeAheadBurning(unit, 2)) return;
      unit.lineTask = null;
      unit.path = [];
      this.notify(`${unit.name} stopped cutting: the fire reached the line.`, 'warning');
      if (task.manual) {
        unit.state = 'holding';
        unit.status = 'Line cut short — holding';
      } else {
        this.returnHome(unit.id);
      }
      return;
    }
    if (!this.routeAheadBurning(unit)) return;
    const goal = unit.path[unit.path.length - 1]!;
    const here = worldToTile(unit.x, unit.z);
    const detour = this.world.findOffroadPath(here, goal, this.fireAvoidMask());
    if (!detour) return;
    unit.path = detour;
    unit.pathIndex = detour.length > 1 ? 1 : 0;
  }

  private updateIdle(unit: Unit, dt: number): void {
    if (isAirKind(unit.kind)) {
      this.flyTo(unit, unit.airBaseX, unit.airBaseZ, dt, true);
      unit.status = unit.water >= unit.capacity ? `Ready at ${airBaseName(unit.kind)}` : `Refilling at ${airBaseName(unit.kind)}`;
      if (unit.water < unit.capacity) {
        unit.water = Math.min(unit.capacity, unit.water + unit.refillRate * dt);
      }
      unit.hydrantConnected = false;
      return;
    }
    const homeDist = distance(unit.x, unit.z, unit.homeX, unit.homeZ);
    if (homeDist > 1.4) {
      this.moveHome(unit, dt);
      if (unit.status !== 'No route home') unit.status = 'Returning to station';
    } else if (homeDist > 0.05) {
      this.driveStraight(unit, unit.homeX, unit.homeZ, unit.maxSpeed * 0.3, dt);
    } else if (Math.abs(Math.atan2(Math.sin(unit.homeHeading - unit.heading), Math.cos(unit.homeHeading - unit.heading))) > 0.01) {
      // Square up to the kerb.
      unit.heading = angleLerp(unit.heading, unit.homeHeading, 1 - Math.exp(-4 * dt));
    } else if (unit.water < unit.capacity) {
      unit.water = Math.min(unit.capacity, unit.water + unit.refillRate * 0.65 * dt);
      unit.status = unit.water >= unit.capacity ? 'Ready at station' : 'Refilling at station';
    } else {
      unit.status = 'Ready at station';
    }
    unit.hydrantConnected = false;
  }

  private updateMoving(unit: Unit, dt: number): void {
    if (isAirKind(unit.kind)) {
      const target = unit.manualTarget;
      if (!target) {
        unit.state = 'holding';
        return;
      }
      const arrived = this.flyTo(unit, target.x, target.z, dt, false);
      unit.status = 'Airborne';
      if (arrived) {
        unit.state = 'holding';
        unit.status = 'Holding orbit';
      }
      return;
    }
    const arrived = this.followGroundPath(unit, dt);
    unit.status = unit.kind === 'dozer' ? 'Moving (cutting line)' : 'Driving';
    if (unit.kind === 'dozer') this.cutUnderDozer(unit, dt);
    if (arrived) {
      unit.state = 'holding';
      unit.status = 'Holding position';
    }
  }

  private updateHolding(unit: Unit, dt: number): void {
    if (isAirKind(unit.kind)) {
      const target = unit.manualTarget;
      if (target) this.flyTo(unit, target.x, target.z, dt, true);
      unit.status = 'Holding orbit';
    } else if (!unit.status.startsWith('Line ') && !unit.status.startsWith('Full ')) {
      unit.status = 'Holding position';
    }
    // Ground units at station slowly top off, so holding near the station stays useful.
    if (!isAirKind(unit.kind) && distance(unit.x, unit.z, unit.homeX, unit.homeZ) < 2.5) {
      unit.water = Math.min(unit.capacity, unit.water + unit.refillRate * 0.6 * dt);
    }
  }

  private updateToIncident(unit: Unit, incidents: Map<number, IncidentView>, dt: number): void {
    const incident = this.incidentFor(unit, incidents);
    if (!incident) return;
    if (isAirKind(unit.kind)) {
      const target =
        this.fire.headTileNear(incident.x, incident.z, 38, QUERY_WILD) ??
        this.fire.nearestActive(unit.x, unit.z, 40, QUERY_WILD) ?? { x: incident.tx, z: incident.tz, distance: 0 };
      const world = tileToWorld(target.x, target.z);
      const arrived = this.flyTo(unit, world.x, world.z, dt, false);
      unit.status = 'Flying to drop';
      if (arrived) {
        if (unit.kind === 'helicopter') {
          this.dropHelicopterWater(unit, world.x, world.z);
          this.beginAirRefill(unit);
        } else {
          this.dropTankerRetardant(unit, world.x, world.z);
          unit.state = 'returning';
          unit.status = `Returning to ${airBaseName(unit.kind)}`;
        }
      }
      return;
    }

    if (unit.kind === 'dozer') {
      this.startDozerLine(unit, incident);
      return;
    }

    if (unit.water <= 1) {
      this.beginRefill(unit);
      return;
    }

    if (this.hoseTarget(unit)) {
      unit.state = 'attacking';
      unit.path = [];
      return;
    }
    if (!this.fire.isActiveNear(incident.x, incident.z, 26, QUERY_WILD)) {
      this.returnHome(unit.id);
      return;
    }
    if (unit.repathTimer <= 0 || unit.path.length === 0) {
      const path = this.planAttackRoute(unit, incident);
      if (!path) {
        this.notify(`${unit.name} has no road within hose reach of the fire. Build a road or send aircraft.`, 'warning');
        this.returnHome(unit.id);
        return;
      }
      unit.path = path;
      unit.pathIndex = path.length > 1 ? 1 : 0;
      unit.repathTimer = 2.2;
    }
    this.followGroundPath(unit, dt);
    unit.status = 'Driving to fire';
    if (this.hoseTarget(unit)) {
      unit.state = 'attacking';
      unit.path = [];
    }
  }

  /**
   * Road tiles near a point from which an engine could put water on
   * wildfire, best first: burning fire before smoldering, closer flames,
   * a hydrant alongside (unlimited water), and a shorter drive.
   */
  private attackPositions(
    centerX: number,
    centerZ: number,
    unit: Unit | null,
  ): Array<{ x: number; z: number; score: number }> {
    const base = this.baseAttackPositions(centerX, centerZ);
    if (!unit) return base;
    const ranked = base.map((position) => {
      const world = tileToWorld(position.x, position.z);
      return { x: position.x, z: position.z, score: position.score + (distance(unit.x, unit.z, world.x, world.z) / TILE_SIZE) * 0.08 };
    });
    ranked.sort((a, b) => a.score - b.score);
    return ranked;
  }

  /**
   * Unit-independent attack positions around a point, cached for a second of
   * simulated time: auto-dispatch asks for the same incident many times.
   */
  private baseAttackPositions(centerX: number, centerZ: number): Array<{ x: number; z: number; score: number }> {
    // Incident centres drift a little every step; bucket them so the cache hits.
    const key = `${Math.round(centerX / 4)},${Math.round(centerZ / 4)}`;
    const cached = this.attackCache.get(key);
    if (cached && this.time - cached.time < ATTACK_CACHE_SECONDS) return cached.positions;
    if (this.attackCache.size > 64) this.attackCache.clear();
    const reach = HOSE_RANGE / TILE_SIZE - 0.3;
    const center = worldToTile(centerX, centerZ);
    const head = this.fire.headTileNear(centerX, centerZ, 30, QUERY_WILD);
    const radius = 26;
    const positions: Array<{ x: number; z: number; score: number }> = [];
    for (let z = Math.max(0, center.z - radius); z <= Math.min(GRID_SIZE - 1, center.z + radius); z += 1) {
      for (let x = Math.max(0, center.x - radius); x <= Math.min(GRID_SIZE - 1, center.x + radius); x += 1) {
        if (!this.world.roads.has(x, z)) continue;
        const target = this.nearestWildInReach(x, z, reach);
        if (!target) continue;
        const world = tileToWorld(x, z);
        const hydrant = this.world.hydrants.findNearest(world.x, world.z, 4.2) !== null;
        const atHead = head !== null && Math.hypot(target.x - head.x, target.z - head.z) < 6;
        const score = target.distance + (target.burning ? 0 : 3) + (hydrant ? -2.5 : 0) + (atHead ? -1.5 : 0);
        positions.push({ x, z, score });
      }
    }
    positions.sort((a, b) => a.score - b.score);
    this.attackCache.set(key, { time: this.time, positions });
    return positions;
  }

  /**
   * Nearest wildfire tile within `reach` tiles of a road tile, burning
   * preferred over smoldering. Scans only the small box around the tile, so
   * the cost does not grow with the size of the fire.
   */
  private nearestWildInReach(
    x: number,
    z: number,
    reach: number,
  ): { x: number; z: number; distance: number; burning: boolean } | null {
    const r = Math.ceil(reach);
    let burningDistance = Infinity;
    let burningIndex = -1;
    let smolderDistance = Infinity;
    let smolderIndex = -1;
    for (let dz = -r; dz <= r; dz += 1) {
      const fz = z + dz;
      if (fz < 0 || fz >= GRID_SIZE) continue;
      for (let dx = -r; dx <= r; dx += 1) {
        const fx = x + dx;
        if (fx < 0 || fx >= GRID_SIZE) continue;
        const d = Math.hypot(dx, dz);
        if (d > reach) continue;
        const index = fz * GRID_SIZE + fx;
        const state = this.fire.state[index];
        if (state !== FireState.Burning && state !== FireState.Igniting && state !== FireState.Smoldering) continue;
        if ((this.fire.controlled[index] ?? 0) > 0) continue;
        if (state === FireState.Smoldering) {
          if (d < smolderDistance) {
            smolderDistance = d;
            smolderIndex = index;
          }
        } else if (d < burningDistance) {
          burningDistance = d;
          burningIndex = index;
        }
      }
    }
    const index = burningIndex >= 0 ? burningIndex : smolderIndex;
    if (index < 0) return null;
    return {
      x: index % GRID_SIZE,
      z: Math.floor(index / GRID_SIZE),
      distance: burningIndex >= 0 ? burningDistance : smolderDistance,
      burning: burningIndex >= 0,
    };
  }

  /** Road route to the best reachable attack position, or null if the fire is out of reach. */
  private planAttackRoute(unit: Unit, incident: IncidentView): Array<{ x: number; z: number }> | null {
    const current = this.currentRoadTile(unit);
    if (!current) return null;
    const positions = this.attackPositions(incident.x, incident.z, unit);
    let tries = 0;
    for (const position of positions) {
      if (!this.world.roads.connected(current, position)) continue;
      const path = this.world.roads.findPath(current, position);
      if (path) return path;
      tries += 1;
      if (tries >= 3) break;
    }
    return null;
  }

  /** Wildfire tile within hose reach: burning first, then smoldering. */
  private hoseTarget(unit: Unit): { x: number; z: number } | null {
    const reach = HOSE_RANGE / TILE_SIZE;
    for (const flags of [QUERY_WILD | QUERY_BURNING, QUERY_WILD]) {
      const tile = this.fire.nearestActive(unit.x, unit.z, reach, flags);
      if (!tile) continue;
      const world = tileToWorld(tile.x, tile.z);
      if (distance(unit.x, unit.z, world.x, world.z) <= HOSE_RANGE) return tile;
    }
    return null;
  }

  private updateAttacking(unit: Unit, incidents: Map<number, IncidentView>, dt: number): void {
    const incident = this.incidentFor(unit, incidents);
    if (!incident) return;
    if (unit.water <= 0.5) {
      this.beginRefill(unit);
      return;
    }
    const target = this.hoseTarget(unit);
    if (!target) {
      if (this.fire.isActiveNear(incident.x, incident.z, 24, QUERY_WILD)) {
        unit.state = 'toIncident';
        unit.repathTimer = 0;
      } else {
        this.returnHome(unit.id);
      }
      return;
    }
    const targetWorld = tileToWorld(target.x, target.z);
    const hydrant = this.world.hydrants.findNearest(unit.x, unit.z, 4.6);
    unit.hydrantConnected = hydrant !== null;
    const power = hydrant ? 1.15 : 0.9;
    this.fire.applyWater(targetWorld.x, targetWorld.z, 5.2, power, dt);
    const headingX = Math.sin(unit.heading);
    const headingZ = Math.cos(unit.heading);
    // Bumper turret on the front of the engine.
    const nozzleX = unit.x + headingX * 1.4;
    const nozzleZ = unit.z + headingZ * 1.4;
    const nozzleY = unit.y + 0.45;
    this.particles.emitWaterSpray(nozzleX, nozzleY, nozzleZ, targetWorld.x, targetWorld.z, dt);
    if (!hydrant) {
      unit.water = Math.max(0, unit.water - unit.sprayRate * dt);
    }
    unit.status = hydrant ? 'Hydrant feed' : 'Spraying water';
    if (unit.water <= 0.5) this.beginRefill(unit);
  }

  private updateRefilling(unit: Unit, incidents: Map<number, IncidentView>, dt: number): void {
    if (unit.capacity <= 0) {
      unit.state = 'idle';
      unit.refillMode = null;
      return;
    }
    if (isAirKind(unit.kind)) {
      if (unit.refillMode === 'water' && unit.refillTarget) {
        this.updateLakeDip(unit, incidents, dt);
        return;
      }
      const arrived = this.flyTo(unit, unit.airBaseX, unit.airBaseZ, dt, true);
      if (arrived) {
        unit.water = Math.min(unit.capacity, unit.water + unit.refillRate * dt);
        unit.status = `Refilling at ${airBaseName(unit.kind)}`;
        if (unit.water >= unit.capacity) {
          unit.water = unit.capacity;
          this.resumeAfterRefill(unit, incidents, `Ready at ${airBaseName(unit.kind)}`);
        }
      } else {
        unit.status = `Returning to ${airBaseName(unit.kind)}`;
      }
      return;
    }

    if (unit.refillMode === 'hydrant' && unit.refillHydrantId !== null) {
      const hydrant = this.world.hydrants.hydrants.find((h) => h.id === unit.refillHydrantId);
      if (!hydrant || !hydrant.active) {
        unit.refillHydrantId = null;
        unit.refillMode = 'base';
        unit.path = [];
        this.planHomePath(unit);
        unit.status = 'Hydrant lost — returning to station';
        return;
      }
      if (distance(unit.x, unit.z, hydrant.x, hydrant.z) > 4.8) {
        if (this.followGroundPath(unit, dt) && distance(unit.x, unit.z, hydrant.x, hydrant.z) > 4.8) {
          unit.refillMode = 'base';
          unit.refillHydrantId = null;
        }
        unit.status = 'Driving to hydrant';
        return;
      }
      unit.water = Math.min(unit.capacity, unit.water + unit.refillRate * dt);
      unit.status = 'Refilling at hydrant';
      if (unit.water >= unit.capacity) {
        unit.water = unit.capacity;
        unit.refillHydrantId = null;
        this.resumeAfterRefill(unit, incidents, 'Ready at hydrant');
      }
      return;
    }

    if (distance(unit.x, unit.z, unit.homeX, unit.homeZ) > HOME_RADIUS) {
      if (!this.driveHome(unit, dt)) return;
      unit.status = 'Returning to station';
      return;
    }
    unit.water = Math.min(unit.capacity, unit.water + unit.refillRate * dt);
    unit.status = 'Refilling at station';
    if (unit.water >= unit.capacity) {
      unit.water = unit.capacity;
      this.resumeAfterRefill(unit, incidents, 'Ready at station');
    }
  }

  /** After a full tank, rejoin the incident if it is still burning, otherwise stand down. */
  private resumeAfterRefill(unit: Unit, incidents: Map<number, IncidentView>, readyStatus: string): void {
    unit.refillMode = null;
    unit.refillTarget = null;
    const incident = this.incidentFor(unit, incidents, false);
    if (incident && !incident.resolved) {
      unit.state = 'toIncident';
      unit.repathTimer = 0;
      unit.status = isAirKind(unit.kind) ? 'Airborne to fire' : 'Driving to fire';
    } else if (isAirKind(unit.kind) && unit.dip > 0) {
      unit.state = 'returning';
      unit.status = `Returning to ${airBaseName(unit.kind)}`;
    } else if (!unit.auto && !isAirKind(unit.kind) && readyStatus === 'Ready at hydrant') {
      // A manual engine stays at the hydrant for its next order.
      unit.state = 'holding';
      unit.status = 'Full — holding at hydrant';
    } else {
      unit.state = 'idle';
      unit.status = readyStatus;
    }
  }

  /** Helicopter bucket refill from the nearest open water. */
  private updateLakeDip(unit: Unit, incidents: Map<number, IncidentView>, dt: number): void {
    const target = unit.refillTarget!;
    const arrived = this.flyTo(unit, target.x, target.z, dt, false);
    if (!arrived) {
      unit.status = 'Flying to lake';
      return;
    }
    unit.status = 'Dipping at lake';
    if (unit.dip < 0.85) return;
    if (unit.water === 0) this.onEvent?.('dip', unit.x, unit.z);
    unit.water = Math.min(unit.capacity, unit.water + DIP_RATE * dt);
    unit.dustTimer -= dt;
    if (unit.dustTimer <= 0) {
      unit.dustTimer = 0.32;
      this.particles.burstWaterDrop(unit.x, unit.z, 1.1);
    }
    if (unit.water >= unit.capacity) {
      unit.water = unit.capacity;
      this.resumeAfterRefill(unit, incidents, `Ready at ${airBaseName(unit.kind)}`);
    }
  }

  private updateReturning(unit: Unit, incidents: Map<number, IncidentView>, dt: number): void {
    if (isAirKind(unit.kind)) {
      const arrived = this.flyTo(unit, unit.airBaseX, unit.airBaseZ, dt, true);
      unit.status = `Returning to ${airBaseName(unit.kind)}`;
      if (arrived) {
        unit.state = 'refilling';
        unit.refillMode = 'base';
        unit.status = `Refilling at ${airBaseName(unit.kind)}`;
      }
      return;
    }
    const arrived = distance(unit.x, unit.z, unit.homeX, unit.homeZ) <= HOME_RADIUS || this.driveHome(unit, dt);
    if (!arrived) return;
    const incident = this.incidentFor(unit, incidents, false);
    if (incident && !incident.resolved && unit.capacity > 0 && unit.water > unit.capacity * 0.1 && unit.outOfService <= 0) {
      unit.state = 'toIncident';
      unit.repathTimer = 0;
      return;
    }
    if (unit.capacity <= 0 || unit.water >= unit.capacity) {
      unit.state = 'idle';
      unit.status = 'Ready at station';
      return;
    }
    unit.state = 'refilling';
    unit.refillMode = 'base';
    unit.status = 'Refilling at station';
  }

  /**
   * Advance a ground unit along its route home, planning (and periodically
   * re-planning) the route when it has none. Returns true once the route is
   * complete. Sets a visible status when no route exists.
   */
  private driveHome(unit: Unit, dt: number): boolean {
    if (unit.path.length === 0) {
      if (distance(unit.x, unit.z, unit.homeX, unit.homeZ) <= HOME_RADIUS) return true;
      if (unit.repathTimer > 0 || !this.planHomePath(unit)) {
        if (unit.repathTimer <= 0) unit.repathTimer = REPATH_RETRY;
        unit.status = 'No route home';
        return false;
      }
    }
    if (unit.outOfService <= 0) unit.status = 'Returning to station';
    return this.followGroundPath(unit, dt);
  }

  private updateDozerLine(unit: Unit, incidents: Map<number, IncidentView>, dt: number): void {
    const task = unit.lineTask;
    if (!task) {
      const incident = this.incidentFor(unit, incidents, false);
      if (!incident || incident.resolved) {
        this.returnHome(unit.id);
        return;
      }
      this.startDozerLine(unit, incident);
      return;
    }
    if (task.phase === 'toStart') {
      const arrived = this.followGroundPath(unit, dt);
      unit.status = 'Driving to line start';
      if (arrived) {
        task.phase = 'cut';
        unit.path = task.cut;
        unit.pathIndex = 0;
        unit.status = 'Cutting fireline';
      }
      return;
    }
    const done = this.followGroundPath(unit, dt, CUT_SPEED_SCALE);
    unit.status = 'Cutting fireline';
    unit.dustTimer -= dt;
    if (unit.dustTimer <= 0 || done) {
      unit.dustTimer = 0.18;
      this.particles.burstDust(unit.x, unit.z);
      this.fire.clearLine(unit.x, unit.z, 2.1);
    }
    if (!done) return;
    unit.lineTask = null;
    this.notify(`${unit.name} finished a ${task.cut.length}-tile fireline.`, 'success');
    this.onEvent?.('lineDone', unit.x, unit.z);
    if (task.manual) {
      unit.state = 'holding';
      unit.path = [];
      unit.status = 'Line complete — holding';
    } else {
      this.returnHome(unit.id);
    }
  }

  private updateMarkers(): void {
    const unit = this.selectedUnit;
    if (unit) {
      const ground = this.world.heightmap.heightAt(unit.x, unit.z);
      this.selectionRing.position.set(unit.x, ground + 0.16, unit.z);
      this.selectionRing.scale.setScalar(RING_SCALE[unit.kind]);
      this.selectionRing.visible = true;
      const last = unit.path[unit.path.length - 1];
      const destination = unit.manualTarget ?? unit.refillTarget ?? (last ? tileToWorld(last.x, last.z) : null);
      if (destination && unit.state !== 'attacking') {
        this.destinationRing.position.set(
          destination.x,
          this.world.heightmap.heightAt(destination.x, destination.z) + 0.2,
          destination.z,
        );
        this.destinationRing.visible = true;
      } else {
        this.destinationRing.visible = false;
      }
    } else {
      this.selectionRing.visible = false;
      this.destinationRing.visible = false;
    }

    this.updateHoses();
  }

  /**
   * Show the hydrant link: a ring on every hydrant an engine is heading to,
   * and a hose to every engine filling from a hydrant or fed by one while it
   * sprays. Pooled meshes; nothing is allocated per step.
   */
  private updateHoses(): void {
    let hoses = 0;
    let rings = 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
    for (const unit of this.units) {
      if (unit.kind !== 'firetruck') continue;
      let hydrant = null;
      let filling = false;
      if (unit.state === 'refilling' && unit.refillMode === 'hydrant' && unit.refillHydrantId !== null) {
        hydrant = this.world.hydrants.byId(unit.refillHydrantId);
        filling = unit.status === 'Refilling at hydrant';
      } else if (unit.hydrantConnected) {
        hydrant = this.world.hydrants.findNearest(unit.x, unit.z, 5);
        filling = true;
      }
      if (!hydrant) continue;
      const ground = this.world.heightmap.heightAt(hydrant.x, hydrant.z);
      const ring = this.refillRings[rings] ?? this.addRefillRing();
      rings += 1;
      ring.position.set(hydrant.x, ground + 0.09, hydrant.z);
      ring.scale.setScalar(filling ? 1 : 1 + pulse * 0.35);
      ring.visible = true;
      if (!filling) continue;
      const hose = this.hoses[hoses] ?? this.addHose();
      hoses += 1;
      this.hoseFrom.set(hydrant.x, ground + 0.2, hydrant.z);
      const dx = hydrant.x - unit.x;
      const dz = hydrant.z - unit.z;
      const length = Math.hypot(dx, dz) || 1;
      this.hoseTo.set(unit.x + (dx / length) * 0.38, unit.y + 0.3, unit.z + (dz / length) * 0.38);
      hose.position.copy(this.hoseFrom);
      hose.lookAt(this.hoseTo);
      hose.scale.set(1, 1, this.hoseFrom.distanceTo(this.hoseTo));
      hose.visible = true;
    }
    for (let i = hoses; i < this.hoses.length; i += 1) this.hoses[i]!.visible = false;
    for (let i = rings; i < this.refillRings.length; i += 1) this.refillRings[i]!.visible = false;
    this.refillRingMaterial.opacity = 0.6 + pulse * 0.35;
  }

  private addHose(): Mesh {
    const hose = new Mesh(this.hoseGeometry, this.hoseMaterial);
    hose.name = 'hydrant-hose';
    hose.castShadow = false;
    this.hoses.push(hose);
    this.hoseGroup.add(hose);
    return hose;
  }

  private addRefillRing(): Mesh {
    const ring = new Mesh(this.refillRingGeometry, this.refillRingMaterial);
    ring.name = 'refill-target';
    ring.renderOrder = 8;
    this.refillRings.push(ring);
    this.hoseGroup.add(ring);
    return ring;
  }

  private updateAnimations(unit: Unit, dt: number): void {
    if (unit.model.rotor) unit.model.rotor.rotation.y += dt * 22;
    if (unit.model.tailRotor) unit.model.tailRotor.rotation.x += dt * 30;
    for (const prop of unit.model.props) prop.rotation.z += dt * 38;
    const spinning = isAirKind(unit.kind) && unit.parked < 0.95;
    for (const disc of unit.model.blurDiscs) disc.visible = spinning;
    const active = unit.state === 'toIncident' || unit.state === 'attacking' || unit.state === 'cutting';
    if (unit.model.redLight) {
      unit.model.redLight.emissiveIntensity = active ? 1.4 + Math.sin(this.time * 14) * 1.1 : 0.5;
    }
    if (unit.model.blueLight) {
      unit.model.blueLight.emissiveIntensity = active ? 1.4 + Math.cos(this.time * 14) * 1.1 : 0.5;
    }
  }

  private applyTransform(unit: Unit, dt: number): void {
    if (isAirKind(unit.kind)) {
      this.applyAirTransform(unit, dt);
      return;
    }
    // Sit the vehicle on the terrain: pitch from the ground under its front
    // and back, roll from its left and right, so it climbs ramps nose-up.
    const h = this.world.heightmap;
    const fx = Math.sin(unit.heading);
    const fz = Math.cos(unit.heading);
    const half = unit.model.length / 2;
    const side = unit.model.width / 2;
    const front = h.heightAt(unit.x + fx * half, unit.z + fz * half);
    const back = h.heightAt(unit.x - fx * half, unit.z - fz * half);
    const left = h.heightAt(unit.x + fz * side, unit.z - fx * side);
    const right = h.heightAt(unit.x - fz * side, unit.z + fx * side);
    const targetPitch = Math.atan2(back - front, unit.model.length);
    const targetRoll = Math.atan2(left - right, unit.model.width);
    const blend = 1 - Math.exp(-14 * Math.max(0, dt));
    unit.pitch += (targetPitch - unit.pitch) * blend;
    unit.roll += (targetRoll - unit.roll) * blend;
    const centre = h.heightAt(unit.x, unit.z);
    const y = Math.max(centre, (front + back) / 2) + GROUND_CLEARANCE;
    unit.group.position.set(unit.x, y, unit.z);
    unit.group.rotation.set(unit.pitch, unit.heading, unit.roll);
  }

  /** Aircraft: settle on the pad, dip, bank into turns, and (helicopters) lean into forward flight. */
  private applyAirTransform(unit: Unit, dt: number): void {
    const atBase = distance(unit.x, unit.z, unit.airBaseX, unit.airBaseZ) < 1.5;
    const resting = unit.state === 'idle' || (unit.state === 'refilling' && unit.refillMode === 'base');
    const target = atBase && resting ? 1 : 0;
    const rate = target > unit.parked ? 0.45 : 1.6;
    unit.parked = clamp(unit.parked + Math.sign(target - unit.parked) * rate * Math.max(0, dt), 0, 1);
    const eased = unit.parked * unit.parked * (3 - 2 * unit.parked);
    if (unit.kind === 'helicopter') {
      const padY = unit.airBaseGround + HELI_PAD_HEIGHT;
      // Helicopters sink to bucket height over open water while dipping.
      const dipping =
        unit.state === 'refilling' &&
        unit.refillMode === 'water' &&
        unit.refillTarget !== null &&
        distance(unit.x, unit.z, unit.refillTarget.x, unit.refillTarget.z) < 1.2;
      unit.dip = clamp(unit.dip + (dipping ? 0.9 : -1.4) * Math.max(0, dt), 0, 1);
      const dipEase = unit.dip * unit.dip * (3 - 2 * unit.dip);
      const dipY = Math.max(WATER_LEVEL, this.world.heightmap.heightAt(unit.x, unit.z)) + DIP_ALTITUDE;
      unit.y = unit.y + (dipY - unit.y) * dipEase;
      unit.y = unit.y + (padY - unit.y) * eased;
      if (unit.model.rotor) unit.model.rotor.rotation.y -= dt * 22 * eased * 0.85;
    } else {
      // The tanker is parked out of sight at its off-map base.
      unit.group.visible = eased < 0.5;
    }
    const step = Math.max(1e-4, dt);
    const speed = Math.hypot(unit.x - unit.lastX, unit.z - unit.lastZ) / step;
    let turn = unit.heading - unit.lastHeading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn)) / step;
    unit.lastX = unit.x;
    unit.lastZ = unit.z;
    unit.lastHeading = unit.heading;
    const airborne = 1 - eased;
    const maxBank = unit.kind === 'tanker' ? 0.7 : 0.4;
    const targetRoll = clamp(-turn * (unit.kind === 'tanker' ? 0.55 : 0.3), -maxBank, maxBank) * airborne;
    const targetPitch = unit.kind === 'helicopter' ? clamp(speed / unit.maxSpeed, 0, 1) * 0.16 * airborne : 0;
    const blend = 1 - Math.exp(-4 * step);
    unit.roll += (targetRoll - unit.roll) * blend;
    unit.pitch += (targetPitch - unit.pitch) * blend;
    const bob = Math.sin(this.time * 2.2 + unit.id) * 0.12 * airborne;
    unit.group.position.set(unit.x, unit.y + bob, unit.z);
    unit.group.rotation.set(unit.pitch, unit.heading, unit.roll);
  }

  /**
   * Move along the tile path, spending this step's full travel distance and
   * passing through as many waypoints as it covers. Lane targets depend only
   * on the path geometry, never on the unit's current position, so arrival is
   * exact for any step size. Returns true once the final waypoint is reached.
   */
  private followGroundPath(unit: Unit, dt: number, speedScale = 1): boolean {
    if (unit.path.length === 0) return true;
    const speed = unit.maxSpeed * (unit.kind === 'dozer' ? 0.9 : 1) * speedScale;
    let budget = speed * Math.max(0, dt);
    let dirX = 0;
    let dirZ = 0;
    let moved = false;
    while (unit.pathIndex < unit.path.length) {
      const target = this.waypointTarget(unit, unit.pathIndex);
      const dx = target.x - unit.x;
      const dz = target.z - unit.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-6) {
        dirX = dx / dist;
        dirZ = dz / dist;
      }
      if (dist <= budget) {
        unit.x = target.x;
        unit.z = target.z;
        budget -= dist;
        moved = moved || dist > 1e-6;
        unit.pathIndex += 1;
        continue;
      }
      unit.x += dirX * budget;
      unit.z += dirZ * budget;
      moved = true;
      break;
    }
    if (moved && (dirX !== 0 || dirZ !== 0)) {
      unit.heading = angleLerp(unit.heading, Math.atan2(dirX, dirZ), 1 - Math.exp(-10 * dt));
    }
    unit.y = this.world.heightmap.heightAt(unit.x, unit.z) + GROUND_CLEARANCE;
    if (unit.pathIndex >= unit.path.length) {
      unit.path = [];
      unit.pathIndex = 0;
      return true;
    }
    return false;
  }

  /** World target for path waypoint `i`, offset into the right lane for engines. */
  private waypointTarget(unit: Unit, i: number): { x: number; z: number } {
    const point = unit.path[i]!;
    const target = this.scratchTarget;
    target.x = (point.x + 0.5) * TILE_SIZE;
    target.z = (point.z + 0.5) * TILE_SIZE;
    if (unit.kind !== 'firetruck') return target;
    const prev = unit.path[i - 1];
    const next = unit.path[i + 1];
    let dx = 0;
    let dz = 0;
    if (prev) {
      dx = point.x - prev.x;
      dz = point.z - prev.z;
    } else if (next) {
      dx = next.x - point.x;
      dz = next.z - point.z;
    }
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return target;
    // Right of travel direction (dx, dz) with y up is (-dz, dx).
    target.x -= (dz / length) * ENGINE_LANE;
    target.z += (dx / length) * ENGINE_LANE;
    return target;
  }

  private flyTo(unit: Unit, tx: number, tz: number, dt: number, hover: boolean): boolean {
    const dx = tx - unit.x;
    const dz = tz - unit.z;
    const dist = Math.hypot(dx, dz);
    const speed = hover ? unit.maxSpeed * 0.5 : unit.maxSpeed;
    unit.y = this.world.heightmap.heightAt(unit.x, unit.z) + unit.cruiseAltitude;
    if (dist < 1.1) return true;
    const move = Math.min(dist, speed * dt);
    unit.heading = angleLerp(unit.heading, Math.atan2(dx, dz), 1 - Math.exp(-3.4 * dt));
    unit.x += (dx / dist) * move;
    unit.z += (dz / dist) * move;
    return false;
  }

  /** Idle ground units drift back to their exact parking spot. */
  private moveHome(unit: Unit, dt: number): void {
    const homeDist = distance(unit.x, unit.z, unit.homeX, unit.homeZ);
    if (homeDist < 3.5) {
      unit.path = [];
      this.driveStraight(unit, unit.homeX, unit.homeZ, unit.maxSpeed * 0.4, dt);
      return;
    }
    this.driveHome(unit, dt);
  }

  private driveStraight(unit: Unit, x: number, z: number, speed: number, dt: number): boolean {
    const dx = x - unit.x;
    const dz = z - unit.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return true;
    const step = Math.min(dist, speed * dt);
    unit.x += (dx / dist) * step;
    unit.z += (dz / dist) * step;
    unit.heading = angleLerp(unit.heading, Math.atan2(dx, dz), 1 - Math.exp(-8 * dt));
    unit.y = this.world.heightmap.heightAt(unit.x, unit.z) + GROUND_CLEARANCE;
    return step >= dist;
  }

  /**
   * Route home: engines use the road graph; dozers plan off-road so a line
   * cut deep in the brush never strands them. Returns false if no route.
   */
  private planHomePath(unit: Unit): boolean {
    const home = worldToTile(unit.homeX, unit.homeZ);
    let path: Array<{ x: number; z: number }> | null = null;
    if (unit.kind === 'dozer') {
      const here = worldToTile(unit.x, unit.z);
      path = this.world.findOffroadPath(here, home, this.fireAvoidMask()) ?? this.world.findOffroadPath(here, home);
    } else {
      const current = this.currentRoadTile(unit);
      path = current ? this.world.roads.findPath(current, home) : null;
    }
    if (!path) return false;
    unit.path = path;
    unit.pathIndex = path.length > 1 ? 1 : 0;
    return true;
  }

  /** Tiles a ground crew should not drive through: anything actively burning. */
  private fireAvoidMask(): Uint8Array {
    const mask = this.avoidMask;
    for (let i = 0; i < mask.length; i += 1) {
      const state = this.fire.state[i];
      mask[i] = state === FireState.Burning || state === FireState.Igniting ? 1 : 0;
    }
    return mask;
  }

  private beginRefill(unit: Unit): void {
    unit.hydrantConnected = false;
    unit.state = 'refilling';
    unit.refillMode = null;
    unit.refillHydrantId = null;
    const current = this.currentRoadTile(unit);
    if (unit.kind === 'firetruck' && current) {
      const options = this.world.hydrants.hydrants
        .map((hydrant) => ({ hydrant, dist: distance(unit.x, unit.z, hydrant.x, hydrant.z) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 6);
      for (const option of options) {
        const path = this.world.roads.findPath(current, { x: option.hydrant.tileX, z: option.hydrant.tileZ });
        if (path) {
          unit.refillMode = 'hydrant';
          unit.refillHydrantId = option.hydrant.id;
          unit.path = path;
          unit.pathIndex = path.length > 1 ? 1 : 0;
          unit.status = 'Driving to hydrant';
          this.onEvent?.('hydrantRefill', option.hydrant.x, option.hydrant.z, unit.id);
          return;
        }
      }
    }
    unit.refillMode = 'base';
    unit.path = [];
    this.planHomePath(unit);
    unit.status = 'Returning to station';
  }

  /**
   * After a drop, a helicopter refills from whichever is closer: open water
   * (a quick bucket dip) or the helipad.
   */
  private beginAirRefill(unit: Unit): void {
    const lake = this.nearestWater(unit.x, unit.z);
    const baseDistance = distance(unit.x, unit.z, unit.airBaseX, unit.airBaseZ);
    if (lake && distance(unit.x, unit.z, lake.x, lake.z) < baseDistance * 0.9) {
      unit.state = 'refilling';
      unit.refillMode = 'water';
      unit.refillTarget = lake;
      unit.status = 'Flying to lake';
      return;
    }
    unit.state = 'returning';
    unit.status = `Returning to ${airBaseName(unit.kind)}`;
  }

  nearestWater(x: number, z: number): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestDistance = Infinity;
    for (const point of this.waterPoints) {
      const d = distance(x, z, point.x, point.z);
      if (d < bestDistance) {
        bestDistance = d;
        best = point;
      }
    }
    return best ? { x: best.x, z: best.z } : null;
  }

  private startDozerLine(unit: Unit, incident: IncidentView): void {
    const head = this.fire.headTileNear(incident.x, incident.z, 40, QUERY_WILD);
    const headWorld = head ? tileToWorld(head.x, head.z) : { x: incident.x, z: incident.z };
    const wind = this.fire.windVector;
    const windLength = Math.hypot(wind.x, wind.z) || 1;
    const windX = wind.x / windLength;
    const windZ = wind.z / windLength;
    const perpX = -windZ;
    const perpZ = windX;
    const centerX = headWorld.x + windX * 3.5;
    const centerZ = headWorld.z + windZ * 3.5;
    const halfLength = Math.min(24, 11 + this.fire.activeCountNear(incident.x, incident.z, 11, QUERY_WILD) * 0.28);
    const a = worldToTile(centerX - perpX * halfLength, centerZ - perpZ * halfLength);
    const b = worldToTile(centerX + perpX * halfLength, centerZ + perpZ * halfLength);
    const avoid = this.fireAvoidMask();
    const cut = this.world.findOffroadPath(a, b, avoid);
    const here = worldToTile(unit.x, unit.z);
    const approach = cut ? this.world.findOffroadPath(here, a, avoid) ?? this.world.findOffroadPath(here, a) : null;
    if (!cut || cut.length < 2 || cut.length > MAX_LINE_TILES || !approach) {
      this.returnHome(unit.id);
      return;
    }
    unit.lineTask = { phase: 'toStart', cut, manual: false };
    unit.path = approach;
    unit.pathIndex = approach.length > 1 ? 1 : 0;
    unit.state = 'cutting';
    unit.status = 'Driving to line start';
  }

  private dropHelicopterWater(unit: Unit, x: number, z: number): void {
    this.fire.applyWater(x, z, 6.6, 2.1, 0.56);
    this.particles.burstWaterDrop(x, z, 4.4);
    unit.water = 0;
    unit.status = 'Water dropped';
    this.onEvent?.('waterDrop', x, z);
  }

  private dropTankerRetardant(unit: Unit, x: number, z: number): void {
    const wind = this.fire.windVector;
    const length = Math.hypot(wind.x, wind.z) || 1;
    const perpX = -wind.z / length;
    const perpZ = wind.x / length;
    const ax = x - perpX * 12;
    const az = z - perpZ * 12;
    const bx = x + perpX * 12;
    const bz = z + perpZ * 12;
    this.fire.applyRetardantLine(ax, az, bx, bz, 5.2, 1);
    this.particles.burstRetardant(ax, az, bx, bz);
    unit.water = 0;
    unit.status = 'Retardant line laid';
    this.onEvent?.('retardant', x, z);
  }

  private cutUnderDozer(unit: Unit, dt: number): void {
    const tile = worldToTile(unit.x, unit.z);
    if (this.world.roads.has(tile.x, tile.z)) return;
    unit.dustTimer -= dt;
    if (unit.dustTimer > 0) return;
    unit.dustTimer = 0.24;
    this.fire.clearLine(unit.x, unit.z, 1.35);
    this.particles.burstDust(unit.x, unit.z);
  }

  private currentRoadTile(unit: Unit): { x: number; z: number } | null {
    const tile = worldToTile(unit.x, unit.z);
    return this.world.roads.nearest(tile.x, tile.z, 8);
  }

  private incidentFor(
    unit: Unit,
    incidents: Map<number, IncidentView>,
    releaseIfResolved = true,
  ): IncidentView | null {
    if (unit.incidentId === null) return null;
    const incident = incidents.get(unit.incidentId) ?? null;
    if ((!incident || incident.resolved) && releaseIfResolved) {
      unit.incidentId = null;
      this.returnHome(unit.id);
      return null;
    }
    return incident;
  }
}

export function unitKindLabel(kind: UnitKind): string {
  switch (kind) {
    case 'firetruck':
      return 'Fire engine';
    case 'dozer':
      return 'Bulldozer';
    case 'helicopter':
      return 'Helicopter';
    case 'tanker':
      return 'Air tanker';
  }
}
