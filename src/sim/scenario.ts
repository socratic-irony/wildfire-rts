import { Rng } from '../core/rng';
import { GRID_SIZE, tileIndex } from '../world/constants';
import { World } from '../world/world';
import { Terrain } from '../world/biomes';
import { Wildfire } from './fire';
import { IncidentSystem } from './incidents';
import { NotifyFn } from './types';

export type ScenarioStatus = 'briefing' | 'running' | 'won' | 'lost';

export interface ScenarioResult {
  status: ScenarioStatus;
  elapsed: number;
  remaining: number;
  structuresStanding: number;
  structuresLost: number;
  burnedHectares: number;
  incidentsContained: number;
  score: number;
  reason: string;
}

const SHIFT_SECONDS = 8 * 60;
const IGNITION_TIMES = [26, 94, 172, 266];
const WIND_SHIFT_TIMES = [70, 190, 310, 420];

export class Scenario {
  status: ScenarioStatus = 'briefing';
  time = 0;
  windDirection = Math.PI * 1.32;
  windSpeed = 5.4;
  private windGoalDirection = Math.PI * 1.32;
  private windGoalSpeed = 5.4;
  private ignitionCursor = 0;
  private windCursor = 0;
  private containmentTimer = 0;
  private hasStartedFire = false;
  private readonly candidates: Array<{ tx: number; tz: number; score: number }> = [];
  private readonly rng: Rng;
  private containedIncidents = 0;
  private readonly result: ScenarioResult;

  constructor(
    private readonly world: World,
    private readonly fire: Wildfire,
    private readonly incidents: IncidentSystem,
    private readonly notify: NotifyFn,
    seed: number,
  ) {
    this.rng = new Rng(seed ^ 0xa5f1e2d3);
    this.buildCandidates();
    this.result = {
      status: 'briefing',
      elapsed: 0,
      remaining: SHIFT_SECONDS,
      structuresStanding: world.buildings.intactCount,
      structuresLost: 0,
      burnedHectares: 0,
      incidentsContained: 0,
      score: 0,
      reason: '',
    };
    this.fire.setWind(this.windDirection, this.windSpeed);
  }

  start(): void {
    if (this.status === 'briefing') {
      this.status = 'running';
      this.notify('Shift started. Watch the dry fuel along the ridge.', 'info');
    }
  }

  get secondsRemaining(): number {
    return Math.max(0, SHIFT_SECONDS - this.time);
  }

  get shiftProgress(): number {
    return Math.min(1, this.time / SHIFT_SECONDS);
  }

  get ignitionsRemaining(): number {
    return Math.max(0, IGNITION_TIMES.length - this.ignitionCursor);
  }

  get currentResult(): ScenarioResult {
    this.result.status = this.status;
    this.result.elapsed = this.time;
    this.result.remaining = this.secondsRemaining;
    this.result.structuresStanding = this.world.buildings.intactCount;
    this.result.structuresLost = this.world.buildings.destroyedCount;
    this.result.burnedHectares = this.fire.stats().burnedHectares;
    this.result.incidentsContained = this.containedIncidents;
    this.result.score = this.computeScore();
    this.result.reason = this.result.reason || this.reasonText();
    return this.result;
  }

  update(dt: number): void {
    if (this.status !== 'running') return;
    this.time += dt;
    this.windDirection += (this.windGoalDirection - this.windDirection) * Math.min(1, dt * 0.14);
    this.windSpeed += (this.windGoalSpeed - this.windSpeed) * Math.min(1, dt * 0.2);
    this.fire.setWind(this.windDirection, this.windSpeed);

    while (this.ignitionCursor < IGNITION_TIMES.length) {
      const nextTime = IGNITION_TIMES[this.ignitionCursor];
      if (nextTime === undefined || this.time < nextTime) break;
      this.ignitionCursor += 1;
      this.startScriptedFire();
    }

    while (this.windCursor < WIND_SHIFT_TIMES.length) {
      const nextTime = WIND_SHIFT_TIMES[this.windCursor];
      if (nextTime === undefined || this.time < nextTime) break;
      this.windCursor += 1;
      this.shiftWind();
    }

    const active = this.fire.activeFireCount;
    if (this.hasStartedFire && active === 0) {
      this.containmentTimer += dt;
    } else {
      this.containmentTimer = 0;
    }

    if (
      this.hasStartedFire &&
      this.ignitionCursor >= IGNITION_TIMES.length &&
      this.containmentTimer > 7 &&
      this.incidents.unresolvedCount === 0
    ) {
      this.finish('won', 'All fires contained. The ridge holds.');
      return;
    }
    if (this.fire.stats().burnedHectares > 1.6) {
      this.finish('lost', 'The fire burned past containment. Too much country lost.');
      return;
    }
    if (this.world.buildings.destroyedCount >= 10) {
      this.finish('lost', 'Too many structures lost. The town is overrun.');
      return;
    }
    if (this.time >= SHIFT_SECONDS) {
      if (this.fire.activeFireCount > 0) {
        this.finish('lost', 'The shift ended with fire still on the ridge.');
      } else {
        this.finish('won', 'Shift complete. Every fire is out.');
      }
    }
  }

  registerFireStarted(): void {
    this.hasStartedFire = true;
    this.containmentTimer = 0;
  }

  registerIncidentContained(): void {
    this.containedIncidents += 1;
  }

  private startScriptedFire(): void {
    const candidate = this.pickCandidate(this.ignitionCursor <= 1 ? [13, 25] : this.ignitionCursor === 2 ? [18, 34] : this.ignitionCursor === 3 ? [18, 42] : [24, 50]);
    if (!candidate) return;
    const index = tileIndex(candidate.tx, candidate.tz);
    let lit = false;
    if (this.fire.state[index] === 0) {
      lit = this.fire.ignite(candidate.tx, candidate.tz);
    }
    const clusterRadius = this.ignitionCursor <= 1 ? 1 : this.ignitionCursor <= 2 ? 1 : 2;
    for (let dz = -clusterRadius; dz <= clusterRadius; dz += 1) {
      for (let dx = -clusterRadius; dx <= clusterRadius; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        if (Math.abs(dx) + Math.abs(dz) > clusterRadius + 1) continue;
        if (this.rng.next() > 0.58) continue;
        if (this.fire.ignite(candidate.tx + dx, candidate.tz + dz)) lit = true;
      }
    }
    if (!lit && this.incidents.activeIncidents.some((incident) => Math.hypot(incident.x - (candidate.tx + 0.5) * 2, incident.z - (candidate.tz + 0.5) * 2) < 16)) return;
    this.incidents.createAt(candidate.tx, candidate.tz, 'lightning');
    this.registerFireStarted();
    this.notify(`Lightning strike — ${this.world.sectorName(candidate.tx, candidate.tz)}.`, 'danger');
  }

  private pickCandidate(distanceWindow: [number, number]): { tx: number; tz: number } | null {
    const [minDistance, maxDistance] = distanceWindow;
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < this.candidates.length; i += 1) {
        const candidate = this.candidates[i];
        if (!candidate) continue;
        const town = this.world.heightmap.layout.town;
        const distanceToTown = Math.hypot(candidate.tx - town.x, candidate.tz - town.z);
        if (pass === 0 && (distanceToTown < minDistance || distanceToTown > maxDistance)) continue;
        const index = tileIndex(candidate.tx, candidate.tz);
        if (this.fire.state[index] !== 0) continue;
        if (this.world.roads.has(candidate.tx, candidate.tz)) continue;
        if (this.world.buildings.isOccupied(candidate.tx, candidate.tz)) continue;
        this.candidates.splice(i, 1);
        return candidate;
      }
    }
    return null;
  }

  private shiftWind(): void {
    const angle = this.rng.range(0, Math.PI * 2);
    const speed = this.rng.range(4.2, 9.4);
    this.windGoalDirection = angle;
    this.windGoalSpeed = speed;
    this.notify(`Wind shift — now ${this.compass(angle)} at ${speed.toFixed(1)} m/s.`, 'warning');
  }

  private finish(status: 'won' | 'lost', reason: string): void {
    if (this.status !== 'running') return;
    this.status = status;
    this.result.reason = reason;
    this.notify(reason, status === 'won' ? 'success' : 'danger');
  }

  private computeScore(): number {
    const stats = this.fire.stats();
    const standing = this.world.buildings.intactCount * 120;
    const lost = this.world.buildings.destroyedCount * 240;
    const timeBonus = this.status === 'won' ? Math.round(this.secondsRemaining * 4) : 0;
    const firePenalty = Math.round(stats.burnedHectares * 18);
    const incidentBonus = this.containedIncidents * 200;
    return Math.max(0, standing - lost + timeBonus + incidentBonus - firePenalty);
  }

  private reasonText(): string {
    if (this.status === 'won') return 'All fires contained. The ridge holds.';
    if (this.status === 'lost') return 'The fire outran the response.';
    if (this.time < 30) return 'Protect the town and contain every wildfire before the shift ends.';
    return 'Contain every active fire and hold the line.';
  }

  private buildCandidates(): void {
    const town = this.world.heightmap.layout.town;
    const windX = Math.sin(this.windDirection);
    const windZ = Math.cos(this.windDirection);
    for (let tz = 3; tz < GRID_SIZE - 3; tz += 1) {
      for (let tx = 3; tx < GRID_SIZE - 3; tx += 1) {
        const index = tileIndex(tx, tz);
        const type = this.world.biomes.types[index] ?? Terrain.Grass;
        if (type !== Terrain.Forest && type !== Terrain.Brush) continue;
        if (this.world.roads.has(tx, tz) || this.world.buildings.isOccupied(tx, tz)) continue;
        const townDistance = Math.hypot(tx - town.x, tz - town.z);
        if (townDistance < 13 || townDistance > 48) continue;
        let score = this.rng.range(0, 20);
        if (type === Terrain.Forest) score += 8;
        if (townDistance > 20 && townDistance < 38) score += 6;
        const upwind = -((tx - town.x) * windX + (tz - town.z) * windZ);
        if (upwind > 0) score += upwind * 0.75;
        const edgeDistance = Math.min(tx, tz, GRID_SIZE - tx, GRID_SIZE - tz);
        if (edgeDistance < 10) score -= 8;
        this.candidates.push({ tx, tz, score });
      }
    }
    this.candidates.sort((a, b) => b.score - a.score);
  }

  private compass(angle: number): string {
    const normal = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const index = Math.round(normal / (Math.PI / 4)) % 8;
    return ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'][index] ?? 'S';
  }
}
