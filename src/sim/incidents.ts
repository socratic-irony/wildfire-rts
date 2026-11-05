import { distance } from '../core/math';
import { GRID_SIZE, tileToWorld } from '../world/constants';
import { Fleet } from './units';
import { QUERY_BURNING, QUERY_WILD, Wildfire } from './fire';
import { IncidentView, NotifyFn } from './types';

export interface Incident extends IncidentView {
  severity: number;
  assigned: Set<number>;
  quietTimer: number;
  source: 'lightning' | 'manual' | 'spot';
}

/** Units auto-dispatch will commit to one incident (manual orders may exceed). */
const MAX_AUTO_UNITS = 4;
/** An incident follows wildfire within this many tiles of its centre. */
const TRACK_RADIUS_TILES = 18;
/** Seconds between incident tracking passes (centre, severity, quiet timer). */
const TRACK_INTERVAL = 0.2;
/** Seconds between lookout sweeps for untracked spot fires. */
const SPOT_SWEEP_SECONDS = 2;

export class IncidentSystem {
  readonly incidents: Incident[] = [];
  autoDispatch = true;
  onResolved: ((incident: Incident) => void) | null = null;
  /** Called when the lookout finds wildfire that no incident is tracking. */
  onSpotDetected: ((incident: Incident) => void) | null = null;
  private nextId = 1;
  private dispatchTimer = 0.5;
  private sweepTimer = SPOT_SWEEP_SECONDS;
  private trackTimer = 0;

  constructor(
    private readonly fire: Wildfire,
    private readonly notify: NotifyFn,
  ) {}

  get activeIncidents(): Incident[] {
    return this.incidents.filter((incident) => !incident.resolved);
  }

  get unresolvedCount(): number {
    return this.activeIncidents.length;
  }

  createAt(tx: number, tz: number, source: Incident['source'] = 'manual'): Incident {
    const world = tileToWorld(tx, tz);
    const existing = this.incidents.find(
      (incident) => !incident.resolved && distance(incident.x, incident.z, world.x, world.z) < 16,
    );
    if (existing) {
      existing.quietTimer = 0;
      return existing;
    }
    const incident: Incident = {
      id: this.nextId,
      x: world.x,
      z: world.z,
      tx,
      tz,
      resolved: false,
      severity: 1,
      assigned: new Set(),
      quietTimer: 0,
      source,
    };
    this.nextId += 1;
    this.incidents.push(incident);
    return incident;
  }

  update(dt: number, fleet: Fleet): void {
    this.trackTimer += dt;
    if (this.trackTimer >= TRACK_INTERVAL) {
      const elapsed = this.trackTimer;
      this.trackTimer = 0;
      this.track(elapsed, fleet);
    }

    this.sweepTimer -= dt;
    if (this.sweepTimer <= 0) {
      this.sweepTimer = SPOT_SWEEP_SECONDS;
      this.sweepForSpotFires();
    }

    if (this.autoDispatch) {
      this.dispatchTimer -= dt;
      if (this.dispatchTimer <= 0) {
        this.dispatchTimer = 1.15;
        this.runAutoDispatch(fleet);
      }
    }
  }

  /** Follow each incident's fire, update severity, and resolve quiet ones. */
  private track(dt: number, fleet: Fleet): void {
    for (const incident of this.incidents) {
      if (incident.resolved) continue;
      const nearest = this.fire.nearestActive(incident.x, incident.z, TRACK_RADIUS_TILES, QUERY_WILD);
      if (nearest) {
        const world = tileToWorld(nearest.x, nearest.z);
        const blend = Math.min(1, dt * 0.8);
        incident.x += (world.x - incident.x) * blend;
        incident.z += (world.z - incident.z) * blend;
        incident.tx = nearest.x;
        incident.tz = nearest.z;
        incident.quietTimer = 0;
        incident.severity = Math.max(1, this.fire.activeCountNear(incident.x, incident.z, 11, QUERY_WILD));
      } else {
        incident.quietTimer += dt;
        incident.severity = 0;
        if (incident.quietTimer > 6) {
          this.resolve(incident, fleet);
          continue;
        }
      }
      for (const id of incident.assigned) {
        const unit = fleet.unitById(id);
        if (unit === null || unit.incidentId !== incident.id) incident.assigned.delete(id);
      }
    }
  }

  /**
   * Fire lookout: open an incident for the first burning wildfire tile that
   * no active incident is tracking (escaped spot fires, runaway backburns).
   */
  private sweepForSpotFires(): void {
    const active = this.activeIncidents;
    let foundX = -1;
    let foundZ = -1;
    this.fire.forEachActive((index) => {
      if (foundX >= 0) return;
      const tx = index % GRID_SIZE;
      const tz = (index - tx) / GRID_SIZE;
      for (const incident of active) {
        if (Math.abs(incident.tx - tx) <= TRACK_RADIUS_TILES && Math.abs(incident.tz - tz) <= TRACK_RADIUS_TILES) return;
      }
      foundX = tx;
      foundZ = tz;
    }, QUERY_WILD | QUERY_BURNING);
    if (foundX < 0) return;
    const incident = this.createAt(foundX, foundZ, 'spot');
    this.onSpotDetected?.(incident);
  }

  dispatchOne(incidentId: number, fleet: Fleet): boolean {
    const incident = this.incidents.find((item) => item.id === incidentId);
    if (!incident || incident.resolved) return false;
    const assigned = fleet.assignedCount(incident.id);
    if (assigned >= 3) {
      this.notify('All available slots for this incident are filled.', 'warning');
      return false;
    }
    const kinds = fleet.assignedKinds(incident.id);
    if (!kinds.has('firetruck') && fleet.assignBest(incident, 'ground')) {
      this.registerAssignment(incident, fleet);
      return true;
    }
    if (!kinds.has('helicopter') && !kinds.has('tanker') && fleet.assignBest(incident, 'air')) {
      this.registerAssignment(incident, fleet);
      return true;
    }
    if (!kinds.has('dozer') && fleet.assignBest(incident, 'dozer')) {
      this.registerAssignment(incident, fleet);
      return true;
    }
    if (fleet.assignBest(incident, 'ground') || fleet.assignBest(incident, 'air')) {
      this.registerAssignment(incident, fleet);
      return true;
    }
    this.notify('No available unit can reach this incident.', 'warning');
    return false;
  }

  viewMap(): Map<number, IncidentView> {
    const map = new Map<number, IncidentView>();
    for (const incident of this.incidents) {
      map.set(incident.id, {
        id: incident.id,
        x: incident.x,
        z: incident.z,
        tx: incident.tx,
        tz: incident.tz,
        resolved: incident.resolved,
      });
    }
    return map;
  }

  private runAutoDispatch(fleet: Fleet): void {
    const active = this.activeIncidents.sort((a, b) => b.severity - a.severity);
    for (const incident of active) {
      const assigned = fleet.assignedCount(incident.id);
      if (assigned >= MAX_AUTO_UNITS) continue;
      const kinds = fleet.assignedKinds(incident.id);
      if (assigned === 0) {
        if (fleet.bestIdle(incident, 'ground')) {
          if (fleet.assignBest(incident, 'ground')) this.registerAssignment(incident, fleet);
        } else if (fleet.assignBest(incident, 'air')) {
          this.registerAssignment(incident, fleet);
        }
        continue;
      }
      if (assigned < 3 && !kinds.has('firetruck') && incident.severity >= 6) {
        if (fleet.assignBest(incident, 'ground')) this.registerAssignment(incident, fleet);
      }
      if (assigned < 3 && incident.severity >= 12 && !kinds.has('helicopter') && !kinds.has('tanker')) {
        if (fleet.assignBest(incident, 'air')) this.registerAssignment(incident, fleet);
      }
      if (assigned < 3 && incident.severity >= 28 && !kinds.has('dozer')) {
        if (fleet.assignBest(incident, 'dozer')) this.registerAssignment(incident, fleet);
      }
      // Nothing on the roads can reach this fire: it is air and dozer work.
      if (!fleet.assignedKinds(incident.id).has('firetruck') && fleet.bestIdle(incident, 'ground') === null) {
        const airborne = fleet.units.filter(
          (unit) => unit.incidentId === incident.id && unit.state !== 'idle' && (unit.kind === 'helicopter' || unit.kind === 'tanker'),
        ).length;
        if (airborne < 2 && incident.severity >= 3 && fleet.assignedCount(incident.id) < MAX_AUTO_UNITS) {
          if (fleet.assignBest(incident, 'air')) this.registerAssignment(incident, fleet);
        }
        if (
          incident.severity >= 10 &&
          !fleet.assignedKinds(incident.id).has('dozer') &&
          fleet.assignedCount(incident.id) < MAX_AUTO_UNITS
        ) {
          if (fleet.assignBest(incident, 'dozer')) this.registerAssignment(incident, fleet);
        }
      }
      // A large fire gets a second engine once the first wave is committed.
      if (
        fleet.assignedCount(incident.id) >= 3 &&
        fleet.assignedCount(incident.id) < MAX_AUTO_UNITS &&
        incident.severity >= 20 &&
        this.activeIncidents.length === 1
      ) {
        if (fleet.assignBest(incident, 'ground')) this.registerAssignment(incident, fleet);
      }
    }
  }

  private registerAssignment(incident: Incident, fleet: Fleet): void {
    for (const unit of fleet.units) {
      if (unit.incidentId === incident.id && unit.state !== 'idle') incident.assigned.add(unit.id);
    }
  }

  private resolve(incident: Incident, fleet: Fleet): void {
    incident.resolved = true;
    incident.severity = 0;
    for (const id of incident.assigned) {
      const unit = fleet.unitById(id);
      if (unit && unit.incidentId === incident.id) fleet.returnHome(id);
    }
    incident.assigned.clear();
    if (this.onResolved) this.onResolved(incident);
    else this.notify('Incident contained. Crews are returning.', 'success');
  }
}
