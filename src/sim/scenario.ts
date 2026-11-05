import { Rng } from '../core/rng';
import { GRID_SIZE, tileIndex } from '../world/constants';
import { World } from '../world/world';
import { Terrain } from '../world/biomes';
import { QUERY_BURNING, QUERY_WILD, Wildfire } from './fire';
import { IncidentSystem } from './incidents';
import { NotifyFn } from './types';
import { DIFFICULTIES, Difficulty, DifficultyId } from './difficulty';

export type ScenarioStatus = 'briefing' | 'running' | 'won' | 'lost';
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface ScenarioResult {
  status: ScenarioStatus;
  difficulty: DifficultyId;
  elapsed: number;
  remaining: number;
  structuresStanding: number;
  structuresLost: number;
  burnedHectares: number;
  backburnHectares: number;
  incidentsContained: number;
  score: number;
  grade: Grade | null;
  reason: string;
}

export interface WindShift {
  time: number;
  direction: number;
  speed: number;
}

export const SHIFT_SECONDS = 8 * 60;
/** Seconds of warning before a forecast wind shift arrives. */
const WIND_WARNING_SECONDS = 15;
/** Strike-distance windows (tiles from town) for successive lightning strikes. */
const STRIKE_WINDOWS: Array<[number, number]> = [
  [13, 25],
  [18, 34],
  [18, 42],
  [24, 50],
];

export class Scenario {
  status: ScenarioStatus = 'briefing';
  time = 0;
  windDirection = Math.PI * 1.32;
  windSpeed = 5.4;
  /** Called when a scripted lightning strike lands. */
  onLightning: ((tx: number, tz: number) => void) | null = null;
  /** Called when a wind shift begins blowing in. */
  onWindShift: ((shift: WindShift) => void) | null = null;
  private windGoalDirection = Math.PI * 1.32;
  private windGoalSpeed = 5.4;
  private ignitionCursor = 0;
  private windCursor = 0;
  private windWarned = 0;
  private containmentTimer = 0;
  private hasStartedFire = false;
  private readonly candidates: Array<{ tx: number; tz: number; score: number }> = [];
  private readonly rng: Rng;
  private containedIncidents = 0;
  private readonly result: ScenarioResult;
  private config: Difficulty = DIFFICULTIES.standard;
  /** Won at the bell with a small fire left for the night crew. */
  private corralled = false;
  private schedule: WindShift[] = [];

  constructor(
    private readonly world: World,
    private readonly fire: Wildfire,
    private readonly incidents: IncidentSystem,
    private readonly notify: NotifyFn,
    private readonly seed: number,
    difficulty: DifficultyId = 'standard',
  ) {
    this.rng = new Rng(seed ^ 0xa5f1e2d3);
    this.buildCandidates();
    this.result = {
      status: 'briefing',
      difficulty,
      elapsed: 0,
      remaining: SHIFT_SECONDS,
      structuresStanding: world.buildings.intactCount,
      structuresLost: 0,
      burnedHectares: 0,
      backburnHectares: 0,
      incidentsContained: 0,
      score: 0,
      grade: null,
      reason: '',
    };
    this.setDifficulty(difficulty);
  }

  get difficulty(): Difficulty {
    return this.config;
  }

  /** Choose the preset before the shift starts; it fixes the forecast and fire behaviour. */
  setDifficulty(id: DifficultyId): void {
    if (this.status !== 'briefing') return;
    this.config = DIFFICULTIES[id];
    this.result.difficulty = id;
    this.fire.spreadMultiplier = this.config.spreadMultiplier;
    this.fire.spotMultiplier = this.config.spotMultiplier;
    this.windSpeed = this.config.startWindSpeed;
    this.windGoalSpeed = this.config.startWindSpeed;
    this.windDirection = Math.PI * 1.32;
    this.windGoalDirection = this.windDirection;
    const windRng = new Rng(this.seed ^ 0x3c6ef372);
    const [minSpeed, maxSpeed] = this.config.windSpeedRange;
    this.schedule = this.config.windShiftTimes.map((time) => ({
      time,
      direction: windRng.range(0, Math.PI * 2),
      speed: windRng.range(minSpeed, maxSpeed),
    }));
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
    return Math.max(0, this.config.ignitionTimes.length - this.ignitionCursor);
  }

  get windForecast(): ReadonlyArray<WindShift> {
    return this.schedule;
  }

  /** The next wind shift that has not yet begun, if any. */
  nextWindShift(): WindShift | null {
    return this.schedule[this.windCursor] ?? null;
  }

  /** Seconds until the next scripted lightning strike, or null when the storm has passed. */
  nextStrikeIn(): number | null {
    const next = this.config.ignitionTimes[this.ignitionCursor];
    return next === undefined ? null : Math.max(0, next - this.time);
  }

  get currentResult(): ScenarioResult {
    const stats = this.fire.stats();
    this.result.status = this.status;
    this.result.elapsed = this.time;
    this.result.remaining = this.secondsRemaining;
    this.result.structuresStanding = this.world.buildings.intactCount;
    this.result.structuresLost = this.world.buildings.destroyedCount;
    this.result.burnedHectares = stats.burnedHectares;
    this.result.backburnHectares = stats.backburnHectares;
    this.result.incidentsContained = this.containedIncidents;
    this.result.score = this.computeScore();
    this.result.grade = this.status === 'won' || this.status === 'lost' ? this.computeGrade() : null;
    this.result.reason = this.result.reason || this.reasonText();
    return this.result;
  }

  update(dt: number): void {
    if (this.status !== 'running') return;
    this.time += dt;
    this.windDirection += angleStep(this.windDirection, this.windGoalDirection, Math.min(1, dt * 0.14));
    this.windSpeed += (this.windGoalSpeed - this.windSpeed) * Math.min(1, dt * 0.2);
    this.fire.setWind(this.windDirection, this.windSpeed);

    const ignitions = this.config.ignitionTimes;
    while (this.ignitionCursor < ignitions.length) {
      const nextTime = ignitions[this.ignitionCursor];
      if (nextTime === undefined || this.time < nextTime) break;
      this.ignitionCursor += 1;
      this.startScriptedFire();
    }

    const upcoming = this.schedule[this.windCursor];
    if (upcoming && this.windWarned <= this.windCursor && this.time >= upcoming.time - WIND_WARNING_SECONDS) {
      this.windWarned = this.windCursor + 1;
      this.notify(
        `Forecast: wind shifting to ${compass(upcoming.direction)} ${upcoming.speed.toFixed(1)} m/s in ${WIND_WARNING_SECONDS} s.`,
        'warning',
      );
    }
    while (this.windCursor < this.schedule.length) {
      const shift = this.schedule[this.windCursor];
      if (!shift || this.time < shift.time) break;
      this.windCursor += 1;
      this.windGoalDirection = shift.direction;
      this.windGoalSpeed = shift.speed;
      this.notify(`Wind shift — now ${compass(shift.direction)} at ${shift.speed.toFixed(1)} m/s.`, 'warning');
      this.onWindShift?.(shift);
    }

    const stats = this.fire.stats();
    if (this.hasStartedFire && stats.wildActive === 0) {
      this.containmentTimer += dt;
    } else {
      this.containmentTimer = 0;
    }

    if (
      this.hasStartedFire &&
      this.ignitionCursor >= ignitions.length &&
      this.containmentTimer > 7 &&
      this.incidents.unresolvedCount === 0
    ) {
      this.finish('won', 'All fires contained. The ridge holds.');
      return;
    }
    if (stats.burnedHectares > this.config.burnLimitHectares) {
      this.finish('lost', 'The fire burned past containment. Too much country lost.');
      return;
    }
    if (this.world.buildings.destroyedCount >= this.config.structureLossLimit) {
      this.finish('lost', 'Too many structures lost. The town is overrun.');
      return;
    }
    if (this.time >= SHIFT_SECONDS) {
      if (stats.wildActive === 0) {
        this.finish('won', 'Shift complete. Every fire is out.');
      } else if (stats.wildActive <= this.config.corralledTiles && !this.structuresThreatened()) {
        this.corralled = true;
        this.finish('won', 'Shift over. The fire is corralled and the night crew will mop up.');
      } else {
        this.finish('lost', 'The shift ended with fire still on the ridge.');
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
    const window = STRIKE_WINDOWS[Math.min(this.ignitionCursor, STRIKE_WINDOWS.length) - 1] ?? [24, 50];
    const candidate = this.pickCandidate(window);
    if (!candidate) return;
    const index = tileIndex(candidate.tx, candidate.tz);
    let lit = false;
    if (this.fire.state[index] === 0) {
      lit = this.fire.ignite(candidate.tx, candidate.tz);
    }
    const clusterRadius = this.ignitionCursor <= 2 ? 1 : 2;
    for (let dz = -clusterRadius; dz <= clusterRadius; dz += 1) {
      for (let dx = -clusterRadius; dx <= clusterRadius; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        if (Math.abs(dx) + Math.abs(dz) > clusterRadius + 1) continue;
        if (this.rng.next() > 0.58) continue;
        if (this.fire.ignite(candidate.tx + dx, candidate.tz + dz)) lit = true;
      }
    }
    this.onLightning?.(candidate.tx, candidate.tz);
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
    const firePenalty = Math.round(stats.burnedHectares * 180 + stats.backburnHectares * 60);
    const incidentBonus = this.containedIncidents * 200;
    const raw = Math.max(0, standing - lost + timeBonus + incidentBonus - firePenalty);
    return Math.round(raw * this.config.scoreMultiplier);
  }

  /** Any standing structure burning, or with burning wildfire within 7 tiles. */
  private structuresThreatened(): boolean {
    for (const building of this.world.buildings.buildings) {
      if (building.state === 'destroyed') continue;
      if (building.state === 'burning') return true;
      if (this.fire.nearestActive(building.centerX, building.centerZ, 7, QUERY_WILD | QUERY_BURNING)) return true;
    }
    return false;
  }

  private computeGrade(): Grade {
    const lost = this.world.buildings.destroyedCount;
    const burned = this.fire.stats().burnedHectares;
    if (this.status === 'won' && this.corralled) return lost <= 3 ? 'B' : 'C';
    if (this.status === 'won') {
      if (lost === 0 && burned < 0.4) return 'S';
      if (lost <= 1 && burned < 0.9) return 'A';
      if (lost <= 3) return 'B';
      return 'C';
    }
    return this.time >= SHIFT_SECONDS * 0.8 ? 'D' : 'F';
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
}

/** Shortest signed rotation from `from` toward `to`, scaled by `t`. */
function angleStep(from: number, to: number, t: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta * t;
}

export function compass(angle: number): string {
  const normal = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const index = Math.round(normal / (Math.PI / 4)) % 8;
  return ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'][index] ?? 'S';
}
