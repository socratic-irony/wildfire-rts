import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';
import { angleLerp, clamp, distance } from '../core/math';
import { GRID_SIZE, TILE_SIZE, tileToWorld, worldToTile } from '../world/constants';
import { World } from '../world/world';
import { FireState, Wildfire } from './fire';
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

interface UnitConfig {
  kind: UnitKind;
  name: string;
  maxSpeed: number;
  capacity: number;
  sprayRate: number;
  refillRate: number;
  cruiseAltitude: number;
  lane: number;
}

interface LineTask {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  phase: 'toStart' | 'cut';
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
  maxSpeed: number;
  capacity: number;
  water: number;
  sprayRate: number;
  refillRate: number;
  cruiseAltitude: number;
  lane: number;
  state: UnitState;
  status: string;
  incidentId: number | null;
  path: Array<{ x: number; z: number }>;
  pathIndex: number;
  repathTimer: number;
  hydrantConnected: boolean;
  refillMode: 'hydrant' | 'base' | null;
  refillHydrantId: number | null;
  refillTimer: number;
  lineTask: LineTask | null;
  manualTarget: { x: number; z: number } | null;
  dustTimer: number;
  homeX: number;
  homeZ: number;
  /** Aircraft only: 0 = flying at cruise altitude, 1 = settled on the pad. */
  parked: number;
  airBaseX: number;
  airBaseZ: number;
  airBaseGround: number;
  busyTimer: number;
}

const HOSE_RANGE = 12.5;
/** Engines drive on the right-hand side of the road centreline. */
const ENGINE_LANE = 0.24;
/** Ground units within this distance of home are parked. */
const HOME_RADIUS = 2.2;
/** Seconds between retries when a route home cannot be planned. */
const REPATH_RETRY = 2;

export class Fleet {
  readonly group = new Group();
  readonly units: Unit[] = [];
  private readonly selectionRing: Mesh;
  private readonly destinationRing: Mesh;
  private readonly hydrantLine: Line;
  private selectedId: number | null = null;
  private time = 0;
  private readonly scratchTarget = { x: 0, z: 0 };
  private readonly avoidMask = new Uint8Array(GRID_SIZE * GRID_SIZE);

  constructor(
    private readonly world: World,
    private readonly fire: Wildfire,
    private readonly particles: ParticleSystem,
    private readonly notify: NotifyFn,
  ) {
    this.group.name = 'fleet';
    const station = world.stationRoad;
    const configs: UnitConfig[] = [
      {
        kind: 'firetruck',
        name: 'Engine 7',
        maxSpeed: 7.2,
        capacity: 4000,
        sprayRate: 62,
        refillRate: 620,
        cruiseAltitude: 0,
        lane: 0.45,
      },
      {
        kind: 'firetruck',
        name: 'Engine 12',
        maxSpeed: 7.2,
        capacity: 4000,
        sprayRate: 62,
        refillRate: 620,
        cruiseAltitude: 0,
        lane: -0.45,
      },
      {
        kind: 'dozer',
        name: 'Dozer 3',
        maxSpeed: 3.3,
        capacity: 0,
        sprayRate: 0,
        refillRate: 0,
        cruiseAltitude: 0,
        lane: 0,
      },
      {
        kind: 'helicopter',
        name: 'Helicopter 1',
        maxSpeed: 18,
        capacity: 1400,
        sprayRate: 0,
        refillRate: 900,
        cruiseAltitude: 13,
        lane: 0,
      },
      {
        kind: 'tanker',
        name: 'Tanker 9',
        maxSpeed: 26,
        capacity: 6000,
        sprayRate: 0,
        refillRate: 1200,
        cruiseAltitude: 19,
        lane: 0,
      },
    ];
    const airbase = world.airbase;
    let groundSlot = 0;
    for (const config of configs) {
      const id = this.units.length + 1;
      const model = createVehicleModel(config.kind);
      const group = new Group();
      group.name = config.name;
      group.add(model.group);
      group.userData.unitId = id;
      group.traverse((child) => {
        child.userData.unitId = id;
      });
      const isAir = config.kind === 'helicopter' || config.kind === 'tanker';
      let x: number;
      let z: number;
      if (isAir) {
        x = airbase.x + (config.kind === 'helicopter' ? -3.2 : 4.5);
        z = airbase.z + (config.kind === 'helicopter' ? 2.5 : -3.4);
      } else {
        const offset = (groundSlot - 1) * 2.2;
        groundSlot += 1;
        x = station.wx + offset + config.lane;
        z = station.wz + (config.lane < 0 ? 0.28 : -0.28);
      }
      const ground = world.heightmap.heightAt(x, z);
      const y = isAir ? ground + (config.kind === 'helicopter' ? 0.12 : 0.3) : ground + 0.08;
      const unit: Unit = {
        id,
        kind: config.kind,
        name: config.name,
        model,
        group,
        x,
        z,
        y,
        heading: 0,
        maxSpeed: config.maxSpeed,
        capacity: config.capacity,
        water: config.capacity,
        sprayRate: config.sprayRate,
        refillRate: config.refillRate,
        cruiseAltitude: config.cruiseAltitude,
        lane: config.lane,
        state: 'idle',
        status: isAir ? 'Ready at helipad' : 'Ready at station',
        incidentId: null,
        path: [],
        pathIndex: 0,
        repathTimer: 0,
        hydrantConnected: false,
        refillMode: null,
        refillHydrantId: null,
        refillTimer: 0,
        lineTask: null,
        manualTarget: null,
        dustTimer: 0,
        homeX: x,
        homeZ: z,
        parked: isAir ? 1 : 0,
        airBaseX: x,
        airBaseZ: z,
        airBaseGround: ground,
        busyTimer: 0,
      };
      group.position.set(x, y, z);
      group.scale.setScalar(1.3);
      this.units.push(unit);
      this.group.add(group);
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

    const hydrantGeometry = new BufferGeometry();
    hydrantGeometry.setAttribute(
      'position',
      new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
    );
    this.hydrantLine = new Line(
      hydrantGeometry,
      new LineBasicMaterial({ color: 0x6fe4ff, transparent: true, opacity: 0.8 }),
    );
    this.hydrantLine.visible = false;
    this.hydrantLine.name = 'hydrant-link';
    this.group.add(this.selectionRing, this.destinationRing, this.hydrantLine);
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
    }));
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

  assignToIncident(unitId: number, incident: IncidentView): void {
    const unit = this.unitById(unitId);
    if (!unit) return;
    unit.incidentId = incident.id;
    unit.manualTarget = null;
    unit.path = [];
    unit.pathIndex = 0;
    unit.repathTimer = 0;
    unit.lineTask = null;
    if (unit.kind === 'dozer') {
      unit.state = 'cutting';
      unit.status = 'Cutting line';
    } else if (unit.kind === 'helicopter' || unit.kind === 'tanker') {
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

  bestIdle(incident: IncidentView, category: 'ground' | 'air' | 'dozer' | 'any'): { id: number; kind: UnitKind; distance: number } | null {
    let best: { id: number; kind: UnitKind; distance: number } | null = null;
    for (const unit of this.units) {
      if (unit.state !== 'idle') continue;
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

  assignBest(incident: IncidentView, category: 'ground' | 'air' | 'dozer' | 'any'): boolean {
    const best = this.bestIdle(incident, category);
    if (!best) return false;
    this.assignToIncident(best.id, incident);
    return true;
  }

  canReach(unitId: number, incident: IncidentView): boolean {
    const unit = this.unitById(unitId);
    if (!unit) return false;
    if (unit.kind === 'helicopter' || unit.kind === 'tanker' || unit.kind === 'dozer') return true;
    const road = this.world.roads.nearest(incident.tx, incident.tz, 6);
    if (!road) return false;
    const current = this.currentRoadTile(unit);
    if (!current) return false;
    return this.world.roads.findPath(current, road) !== null;
  }

  orderMove(unitId: number, wx: number, wz: number): { ok: boolean; message?: string } {
    const unit = this.unitById(unitId);
    if (!unit) return { ok: false };
    unit.incidentId = null;
    unit.manualTarget = { x: wx, z: wz };
    unit.lineTask = null;
    unit.hydrantConnected = false;
    if (unit.kind === 'helicopter' || unit.kind === 'tanker') {
      unit.state = 'moving';
      unit.status = 'Airborne';
      unit.path = [];
      return { ok: true };
    }
    const tile = worldToTile(wx, wz);
    if (unit.kind === 'dozer') {
      const current = worldToTile(unit.x, unit.z);
      const path = this.world.findOffroadPath(current, tile);
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

  returnHome(unitId: number): void {
    const unit = this.unitById(unitId);
    if (!unit) return;
    unit.incidentId = null;
    unit.manualTarget = null;
    unit.lineTask = null;
    unit.hydrantConnected = false;
    unit.state = 'returning';
    unit.status = unit.kind === 'helicopter' || unit.kind === 'tanker' ? 'Returning to helipad' : 'Returning to station';
    if (unit.kind === 'firetruck' || unit.kind === 'dozer') {
      unit.path = [];
      unit.pathIndex = 0;
      unit.repathTimer = 0;
      if (!this.planHomePath(unit)) unit.repathTimer = REPATH_RETRY;
    }
  }

  hold(unitId: number): void {
    const unit = this.unitById(unitId);
    if (!unit) return;
    unit.incidentId = null;
    unit.manualTarget = null;
    unit.lineTask = null;
    unit.path = [];
    unit.state = 'holding';
    unit.status = 'Holding position';
  }

  update(dt: number, incidentLookup: Map<number, IncidentView>): void {
    this.time += dt;
    for (const unit of this.units) {
      unit.busyTimer = Math.max(0, unit.busyTimer - dt);
      unit.repathTimer -= dt;
      this.updateAnimations(unit, dt);
      if (unit.state === 'idle') this.updateIdle(unit, dt);
      else if (unit.state === 'moving') this.updateMoving(unit, dt);
      else if (unit.state === 'holding') this.updateHolding(unit, dt);
      else if (unit.state === 'cutting') this.updateDozerLine(unit, incidentLookup, dt);
      else if (unit.state === 'toIncident') this.updateToIncident(unit, incidentLookup, dt);
      else if (unit.state === 'attacking') this.updateAttacking(unit, incidentLookup, dt);
      else if (unit.state === 'refilling') this.updateRefilling(unit, incidentLookup, dt);
      else if (unit.state === 'returning') this.updateReturning(unit, incidentLookup, dt);
      this.applyTransform(unit, dt);
    }
    this.updateMarkers();
  }

  private updateIdle(unit: Unit, dt: number): void {
    if (unit.kind === 'helicopter' || unit.kind === 'tanker') {
      this.flyTo(unit, unit.airBaseX, unit.airBaseZ, dt, true);
      unit.status = unit.water >= unit.capacity ? 'Ready at helipad' : 'Refilling at helipad';
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
    } else if (unit.water < unit.capacity) {
      unit.water = Math.min(unit.capacity, unit.water + unit.refillRate * 0.65 * dt);
      unit.status = unit.water >= unit.capacity ? 'Ready at station' : 'Refilling at station';
    } else {
      unit.status = 'Ready at station';
    }
    unit.hydrantConnected = false;
  }

  private updateMoving(unit: Unit, dt: number): void {
    if (unit.kind === 'helicopter' || unit.kind === 'tanker') {
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
    unit.status = unit.kind === 'dozer' ? 'Moving' : 'Driving';
    if (unit.kind === 'dozer') this.cutUnderDozer(unit, dt);
    if (arrived) {
      unit.state = 'holding';
      unit.status = unit.kind === 'dozer' ? 'Holding position' : 'Holding position';
    }
  }

  private updateHolding(unit: Unit, dt: number): void {
    if (unit.kind === 'helicopter' || unit.kind === 'tanker') {
      const target = unit.manualTarget;
      if (target) this.flyTo(unit, target.x, target.z, dt, true);
      unit.status = 'Holding orbit';
    } else {
      unit.status = 'Holding position';
    }
    // Ground units at station slowly top off, so holding near the station stays useful.
    if (unit.kind !== 'helicopter' && unit.kind !== 'tanker' && distance(unit.x, unit.z, unit.homeX, unit.homeZ) < 2.5) {
      unit.water = Math.min(unit.capacity, unit.water + unit.refillRate * 0.6 * dt);
    }
  }

  private updateToIncident(unit: Unit, incidents: Map<number, IncidentView>, dt: number): void {
    const incident = this.incidentFor(unit, incidents);
    if (!incident) return;
    if (unit.kind === 'helicopter' || unit.kind === 'tanker') {
      const target =
        this.fire.headTileNear(incident.x, incident.z, 38) ?? this.fire.nearestActive(unit.x, unit.z, 40) ?? { x: incident.tx, z: incident.tz, distance: 0 };
      const world = tileToWorld(target.x, target.z);
      const arrived = this.flyTo(unit, world.x, world.z, dt, false);
      unit.status = 'Flying to drop';
      if (arrived) {
        if (unit.kind === 'helicopter') this.dropHelicopterWater(unit, world.x, world.z);
        else this.dropTankerRetardant(unit, world.x, world.z);
        unit.state = 'returning';
        unit.status = 'Returning to helipad';
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

    const target = this.fire.nearestActive(unit.x, unit.z, 20) ?? this.fire.nearestActive(incident.x, incident.z, 24);
    if (!target) {
      unit.state = 'returning';
      this.returnHome(unit.id);
      return;
    }
    const targetWorld = tileToWorld(target.x, target.z);
    const dist = distance(unit.x, unit.z, targetWorld.x, targetWorld.z);
    if (dist <= HOSE_RANGE) {
      unit.state = 'attacking';
      unit.path = [];
      return;
    }
    if (unit.repathTimer <= 0 || unit.path.length === 0) {
      const road = this.world.roads.nearest(target.x, target.z, 6);
      if (!road) {
        this.notify(`${unit.name} cannot reach the fire by road.`, 'warning');
        this.returnHome(unit.id);
        return;
      }
      const current = this.currentRoadTile(unit);
      const path = current ? this.world.roads.findPath(current, road) : null;
      if (!path) {
        this.notify(`${unit.name} has no connected road route.`, 'warning');
        this.returnHome(unit.id);
        return;
      }
      unit.path = path;
      unit.pathIndex = path.length > 1 ? 1 : 0;
      unit.repathTimer = 2.2;
    }
    this.followGroundPath(unit, dt);
    unit.status = 'Driving to fire';
    if (this.fire.nearestActive(unit.x, unit.z, HOSE_RANGE) !== null) {
      unit.state = 'attacking';
      unit.path = [];
    }
  }

  private updateAttacking(unit: Unit, incidents: Map<number, IncidentView>, dt: number): void {
    const incident = this.incidentFor(unit, incidents);
    if (!incident) return;
    if (unit.water <= 0.5) {
      this.beginRefill(unit);
      return;
    }
    const target = this.fire.nearestActive(unit.x, unit.z, 24);
    if (!target) {
      unit.state = 'returning';
      this.returnHome(unit.id);
      return;
    }
    const targetWorld = tileToWorld(target.x, target.z);
    const dist = distance(unit.x, unit.z, targetWorld.x, targetWorld.z);
    if (dist > HOSE_RANGE) {
      unit.state = 'toIncident';
      unit.repathTimer = 0;
      return;
    }
    const hydrant = this.world.hydrants.findNearest(unit.x, unit.z, 4.6);
    unit.hydrantConnected = hydrant !== null;
    const power = hydrant ? 1.15 : 0.9;
    this.fire.applyWater(targetWorld.x, targetWorld.z, 5.2, power, dt);
    const headingX = Math.sin(unit.heading);
    const headingZ = Math.cos(unit.heading);
    const nozzleX = unit.x + headingX * 0.9;
    const nozzleZ = unit.z + headingZ * 0.9;
    const nozzleY = unit.y + 0.85;
    this.particles.emitWaterSpray(nozzleX, nozzleY, nozzleZ, targetWorld.x, targetWorld.z, dt);
    if (!hydrant) {
      unit.water = Math.max(0, unit.water - unit.sprayRate * dt);
    }
    unit.status = hydrant ? 'Hydrant feed' : 'Spraying water';
    if (unit.water <= 0.5) this.beginRefill(unit);
  }

  private updateRefilling(unit: Unit, incidents: Map<number, IncidentView>, dt: number): void {
    if (unit.kind === 'helicopter' || unit.kind === 'tanker') {
      const arrived = this.flyTo(unit, unit.airBaseX, unit.airBaseZ, dt, true);
      if (arrived) {
        unit.water = Math.min(unit.capacity, unit.water + unit.refillRate * dt);
        unit.status = 'Refilling at helipad';
        if (unit.water >= unit.capacity) {
          unit.water = unit.capacity;
          const incident = this.incidentFor(unit, incidents, false);
          if (incident && !incident.resolved) {
            unit.state = 'toIncident';
            unit.status = 'Airborne to fire';
          } else {
            unit.state = 'idle';
            unit.status = 'Ready at helipad';
          }
        }
      } else {
        unit.status = 'Returning to helipad';
      }
      return;
    }

    if (unit.refillMode === 'hydrant' && unit.refillHydrantId !== null) {
      const hydrant = this.world.hydrants.hydrants.find((h) => h.id === unit.refillHydrantId);
      if (!hydrant || !hydrant.active) {
        unit.refillHydrantId = null;
        unit.refillMode = 'base';
        this.planHomePath(unit);
        unit.status = 'Hydrant lost — returning to station';
        return;
      }
      if (distance(unit.x, unit.z, hydrant.x, hydrant.z) > 4.8) {
        this.followGroundPath(unit, dt);
        unit.status = 'Driving to hydrant';
        return;
      }
      unit.water = Math.min(unit.capacity, unit.water + unit.refillRate * dt);
      unit.status = 'Refilling at hydrant';
      if (unit.water >= unit.capacity) {
        unit.water = unit.capacity;
        unit.refillHydrantId = null;
        const incident = this.incidentFor(unit, incidents, false);
        if (incident && !incident.resolved) {
          unit.state = 'toIncident';
          unit.repathTimer = 0;
          unit.status = 'Driving to fire';
        } else {
          unit.state = 'idle';
          unit.status = 'Ready at hydrant';
        }
      }
      return;
    }

    if (unit.capacity <= 0) {
      unit.state = 'idle';
      unit.refillMode = null;
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
      const incident = this.incidentFor(unit, incidents, false);
      if (incident && !incident.resolved) {
        unit.state = 'toIncident';
        unit.repathTimer = 0;
        unit.status = 'Driving to fire';
      } else {
        unit.state = 'idle';
        unit.status = 'Ready at station';
      }
    }
  }

  private updateReturning(unit: Unit, incidents: Map<number, IncidentView>, dt: number): void {
    if (unit.kind === 'helicopter' || unit.kind === 'tanker') {
      const arrived = this.flyTo(unit, unit.airBaseX, unit.airBaseZ, dt, true);
      unit.status = 'Returning to helipad';
      if (arrived) {
        unit.state = 'refilling';
        unit.refillMode = 'base';
        unit.status = 'Refilling at helipad';
      }
      return;
    }
    const arrived = distance(unit.x, unit.z, unit.homeX, unit.homeZ) <= HOME_RADIUS || this.driveHome(unit, dt);
    if (!arrived) return;
    const incident = this.incidentFor(unit, incidents, false);
    if (incident && !incident.resolved && unit.capacity > 0 && unit.water > unit.capacity * 0.1) {
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
    unit.status = 'Returning to station';
    return this.followGroundPath(unit, dt);
  }

  private updateDozerLine(unit: Unit, incidents: Map<number, IncidentView>, dt: number): void {
    const incident = this.incidentFor(unit, incidents, false);
    if (!unit.lineTask) {
      if (!incident || incident.resolved) {
        unit.state = 'returning';
        this.returnHome(unit.id);
        return;
      }
      this.startDozerLine(unit, incident);
      return;
    }
    if (unit.lineTask.phase === 'toStart') {
      const arrived = this.followGroundPath(unit, dt);
      unit.status = 'Driving to line start';
      if (unit.path.length === 0 || arrived) {
        unit.lineTask.phase = 'cut';
        unit.path = [];
        unit.status = 'Cutting fireline';
      }
      return;
    }
    const task = unit.lineTask;
    const dx = task.bx - unit.x;
    const dz = task.bz - unit.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.4) {
      unit.lineTask = null;
      unit.state = 'returning';
      this.returnHome(unit.id);
      this.notify(`${unit.name} finished a fireline.`, 'success');
      return;
    }
    const heading = Math.atan2(dx, dz);
    unit.heading = angleLerp(unit.heading, heading, 1 - Math.exp(-8 * dt));
    const step = Math.min(dist, unit.maxSpeed * 0.82 * dt);
    unit.x += (dx / dist) * step;
    unit.z += (dz / dist) * step;
    unit.y = this.world.heightmap.heightAt(unit.x, unit.z) + 0.08;
    unit.dustTimer -= dt;
    if (unit.dustTimer <= 0) {
      unit.dustTimer = 0.18;
      this.particles.burstDust(unit.x, unit.z);
      this.fire.clearLine(unit.x, unit.z, 2.1);
    }
    unit.status = 'Cutting fireline';
  }

  private updateMarkers(): void {
    const unit = this.selectedUnit;
    if (unit) {
      const ground = this.world.heightmap.heightAt(unit.x, unit.z);
      this.selectionRing.position.set(unit.x, ground + 0.16, unit.z);
      this.selectionRing.visible = true;
      const destination = unit.manualTarget ?? (unit.path[unit.path.length - 1]
        ? tileToWorld(unit.path[unit.path.length - 1]!.x, unit.path[unit.path.length - 1]!.z)
        : null);
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

    const connected = this.units.find((u) => u.hydrantConnected);
    if (connected) {
      const hydrant = this.world.hydrants.findNearest(connected.x, connected.z, 5);
      if (hydrant) {
        const positions = this.hydrantLine.geometry.getAttribute('position');
        positions.setXYZ(0, connected.x, connected.y + 0.6, connected.z);
        positions.setXYZ(1, hydrant.x, this.world.heightmap.heightAt(hydrant.x, hydrant.z) + 0.8, hydrant.z);
        positions.needsUpdate = true;
        this.hydrantLine.visible = true;
        return;
      }
    }
    this.hydrantLine.visible = false;
  }

  private updateAnimations(unit: Unit, dt: number): void {
    if (unit.model.rotor) unit.model.rotor.rotation.y += dt * 22;
    if (unit.model.tailRotor) unit.model.tailRotor.rotation.x += dt * 30;
    const active = unit.state === 'toIncident' || unit.state === 'attacking' || unit.state === 'cutting';
    if (unit.model.redLight) {
      unit.model.redLight.emissiveIntensity = active ? 1.4 + Math.sin(this.time * 14) * 1.1 : 0.5;
    }
    if (unit.model.blueLight) {
      unit.model.blueLight.emissiveIntensity = active ? 1.4 + Math.cos(this.time * 14) * 1.1 : 0.5;
    }
  }

  private applyTransform(unit: Unit, dt: number): void {
    if (unit.kind === 'helicopter' || unit.kind === 'tanker') {
      // Idle/refilling aircraft settle onto the pad instead of hovering at
      // cruise altitude; they climb back out as soon as they are tasked.
      const atBase = distance(unit.x, unit.z, unit.airBaseX, unit.airBaseZ) < 1.5;
      const resting = unit.state === 'idle' || (unit.state === 'refilling' && unit.refillMode === 'base');
      const target = atBase && resting ? 1 : 0;
      const rate = target > unit.parked ? 0.45 : 1.6;
      unit.parked = clamp(unit.parked + Math.sign(target - unit.parked) * rate * Math.max(0, dt), 0, 1);
      const eased = unit.parked * unit.parked * (3 - 2 * unit.parked);
      const padY = unit.airBaseGround + (unit.kind === 'helicopter' ? 0.12 : 0.3);
      unit.y = unit.y + (padY - unit.y) * eased;
      if (unit.model.rotor) unit.model.rotor.rotation.y -= dt * 22 * eased * 0.85;
    }
    unit.group.position.set(unit.x, unit.y, unit.z);
    unit.group.rotation.y = unit.heading;
    if (unit.kind === 'helicopter' || unit.kind === 'tanker') {
      unit.group.position.y = unit.y + Math.sin(this.time * 2.2 + unit.id) * 0.12 * (1 - unit.parked);
    }
  }

  /**
   * Move along the tile path, spending this step's full travel distance and
   * passing through as many waypoints as it covers. Lane targets depend only
   * on the path geometry, never on the unit's current position, so arrival is
   * exact for any step size. Returns true once the final waypoint is reached.
   */
  private followGroundPath(unit: Unit, dt: number): boolean {
    if (unit.path.length === 0) return true;
    const speed = unit.maxSpeed * (unit.kind === 'dozer' ? 0.9 : 1);
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
    unit.y = this.world.heightmap.heightAt(unit.x, unit.z) + 0.08;
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
    target.x += (dz / length) * ENGINE_LANE;
    target.z -= (dx / length) * ENGINE_LANE;
    return target;
  }

  private flyTo(unit: Unit, tx: number, tz: number, dt: number, hover: boolean): boolean {
    const dx = tx - unit.x;
    const dz = tz - unit.z;
    const dist = Math.hypot(dx, dz);
    const speed = hover ? unit.maxSpeed * 0.5 : unit.maxSpeed;
    const targetY = this.world.heightmap.heightAt(unit.x, unit.z) + unit.cruiseAltitude;
    unit.y = targetY;
    if (dist < 1.1) {
      unit.heading = angleLerp(unit.heading, unit.heading, 1);
      return true;
    }
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
    unit.y = this.world.heightmap.heightAt(unit.x, unit.z) + 0.08;
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
          return;
        }
      }
    }
    unit.refillMode = 'base';
    this.planHomePath(unit);
    unit.status = 'Returning to station';
  }

  private startDozerLine(unit: Unit, incident: IncidentView): void {
    const head = this.fire.headTileNear(incident.x, incident.z, 40);
    const headWorld = head ? tileToWorld(head.x, head.z) : { x: incident.x, z: incident.z };
    const centroid = this.fire.centroid();
    const baseX = centroid.count > 0 ? headWorld.x : incident.x;
    const baseZ = centroid.count > 0 ? headWorld.z : incident.z;
    const wind = this.fire.windVector;
    const windLength = Math.hypot(wind.x, wind.z) || 1;
    const windX = wind.x / windLength;
    const windZ = wind.z / windLength;
    const perpX = -windZ;
    const perpZ = windX;
    const centerX = baseX + windX * 3.5;
    const centerZ = baseZ + windZ * 3.5;
    const halfLength = Math.min(24, 11 + this.fire.activeCountNear(incident.x, incident.z, 11) * 0.28);
    const ax = centerX - perpX * halfLength;
    const az = centerZ - perpZ * halfLength;
    const bx = centerX + perpX * halfLength;
    const bz = centerZ + perpZ * halfLength;
    unit.lineTask = { ax, az, bx, bz, phase: 'toStart' };
    const start = worldToTile(unit.x, unit.z);
    const target = worldToTile(ax, az);
    const path = this.world.findOffroadPath(start, target);
    if (path) {
      unit.path = path;
      unit.pathIndex = path.length > 1 ? 1 : 0;
    } else {
      unit.path = [];
    }
    unit.state = 'cutting';
    unit.status = 'Driving to line start';
  }

  private dropHelicopterWater(unit: Unit, x: number, z: number): void {
    this.fire.applyWater(x, z, 6.6, 2.1, 0.56);
    this.particles.burstWaterDrop(x, z, 4.4);
    unit.water = 0;
    unit.status = 'Water dropped';
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
      unit.state = 'returning';
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
