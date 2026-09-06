import { Path2D, type V2 } from '../paths/path2d';

export type TurnMovement = 'left' | 'through' | 'right';

export type TurnIntersection = {
  id: number;
  s: number;
  pos: { x: number; z: number };
};

export type TurnRoute = {
  /** A short, continuous path from the stop line through the turn. */
  path: Path2D;
  /** The road path to use after the rear clears the conflict area. */
  continuationPath: Path2D;
  continuationS: number;
  /** Intersections transformed into the continuation path's direction. */
  continuationIntersections: TurnIntersection[];
  movement: TurnMovement;
  intersectionId: number;
  /** End of the turn path; ownership is retained until this point. */
  clearS: number;
};

type Occurrence = TurnIntersection & { path: Path2D; pathIndex: number };
type Candidate = Occurrence & { direction: 1 | -1; movement: TurnMovement; exitS: number };

const TURN_PREFERENCE: TurnMovement[] = ['right', 'through', 'left'];
const OUTBOUND_CLEARANCE = 8;
const U_TURN_DOT = -0.86;
const THROUGH_ANGLE = Math.PI / 6;

/**
 * Directed, topology-only routing for visible civilian followers.
 *
 * An intersection occurrence is considered connected only to other
 * occurrences carrying the same stable intersection id. This deliberately
 * prevents a vehicle from selecting a visually nearby but unrelated road.
 */
export function createTurnRouter(
  entries: Array<{ path: Path2D; intersections: TurnIntersection[] }>,
) {
  const occurrencesById = new Map<number, Occurrence[]>();
  const pathIndices = new Map<Path2D, number>();
  const intersectionsByPath = new Map<Path2D, TurnIntersection[]>();
  let nextPathIndex = entries.length;
  for (let pathIndex = 0; pathIndex < entries.length; pathIndex++) {
    const entry = entries[pathIndex];
    registerPath(entry.path, entry.intersections, pathIndex);
  }

  function registerPath(path: Path2D, intersections: TurnIntersection[], pathIndex = nextPathIndex++) {
    if (pathIndices.has(path)) return;
    pathIndices.set(path, pathIndex);
    const unique = intersections.filter((intersection, index) => intersections.findIndex((other) => other.id === intersection.id && Math.abs(other.s - intersection.s) <= 1e-3) === index);
    intersectionsByPath.set(path, unique);
    for (const intersection of unique) {
      const occurrence = { ...intersection, path, pathIndex };
      const list = occurrencesById.get(intersection.id) ?? [];
      list.push(occurrence);
      occurrencesById.set(intersection.id, list);
    }
  }

  // Reciprocal directed paths. Keeping this as a path-to-path map is
  // important: every physical road gets exactly one reverse representation,
  // so same-direction leaders share identity and reversing twice is lossless.
  const reversePaths = new Map<Path2D, Path2D>();

  function chooseRoute(path: Path2D, startS: number, intersection: TurnIntersection, vehicleId: number): TurnRoute | null {
    const occurrences = occurrencesById.get(intersection.id) ?? [];
    const current = occurrences.find((occurrence) => occurrence.path === path && Math.abs(occurrence.s - intersection.s) < 1e-3);
    if (!current) return null;

    const incoming = tangentAt(path, intersection.s - 0.5);
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    for (const occurrence of occurrences) {
      for (const direction of [1, -1] as const) {
        // Reversing on the same occurrence is a U-turn. Other branches are
        // classified by their actual outgoing tangent and filtered below.
        const key = `${occurrence.pathIndex}:${occurrence.s.toFixed(3)}:${direction}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const exitS = advanceS(occurrence.path, occurrence.s, direction, OUTBOUND_CLEARANCE);
        if (exitS == null) continue;
        const outgoing = orientedTangentAt(occurrence.path, occurrence.s, direction);
        const movement = classifyMovement(incoming, outgoing);
        if (!movement) continue;
        candidates.push({ ...occurrence, direction, movement, exitS });
      }
    }

    if (!candidates.length) return null;
    const preferred = TURN_PREFERENCE[(Math.abs(vehicleId) + 0) % TURN_PREFERENCE.length];
    candidates.sort((a, b) => {
      const movementOrder = (a.movement === preferred ? 0 : 1) - (b.movement === preferred ? 0 : 1);
      if (movementOrder) return movementOrder;
      const stableOrder = a.movement.localeCompare(b.movement);
      return stableOrder || a.pathIndex - b.pathIndex || a.direction - b.direction;
    });
    const selected = candidates[0];
    // Continuing on the same directed edge needs no temporary path. Leaving
    // it as null preserves the existing centerline and its normal spacing.
    if (selected.path === current.path && Math.abs(selected.s - current.s) < 1e-3 && selected.direction > 0) return null;
    const continuation = getContinuation(selected);
    const start = path.sample(startS).p;
    const cross = intersection.pos;
    const exit = selected.path.sample(selected.exitS).p;
    const incomingDistance = Math.max(1, Math.hypot(cross.x - start.x, cross.z - start.z));
    const outgoing = orientedTangentAt(selected.path, selected.s, selected.direction);
    // Use one cubic from the stop line to the outbound clearance point. A
    // cubic that is forced to end at the crossing center while already
    // pointing down the exit road would briefly backtrack on a right/left
    // turn, which makes a Frenet follower lose forward projection speed.
    // The control polygon still passes within the conflict zone and gives a
    // continuous tangent at both ends.
    const entryControl = add(start, incoming, incomingDistance * 0.8);
    const endControl = add(exit, outgoing, -Math.min(3, Math.max(1, Math.hypot(exit.x - cross.x, exit.z - cross.z) * 0.35)));
    const points = sampleCubic(start, entryControl, endControl, exit, 16);
    const turnPath = new Path2D(dedupe(points));
    return {
      path: turnPath,
      continuationPath: continuation.path,
      continuationS: continuation.s,
      continuationIntersections: continuation.intersections,
      movement: selected.movement,
      intersectionId: intersection.id,
      clearS: turnPath.length,
    };
  }

  function getContinuation(selected: Candidate) {
    if (selected.direction > 0) return {
      path: selected.path,
      s: selected.exitS,
      intersections: intersectionsByPath.get(selected.path) ?? [],
    };
    const path = ensureReversePath(selected.path);
    const continuationS = selected.path.closed
      ? mod(path.length - selected.exitS, path.length)
      : path.length - selected.exitS;
    return { path, s: continuationS, intersections: intersectionsByPath.get(path) ?? [] };
  }

  function ensureReversePath(source: Path2D): Path2D {
    const existing = reversePaths.get(source);
    if (existing) return existing;
    const points = source.closed
      ? [source.pts[0], ...source.pts.slice(1).reverse()]
      : source.pts.slice().reverse();
    const reverse = new Path2D(points, { closed: source.closed });
    reversePaths.set(source, reverse);
    reversePaths.set(reverse, source);
    const transformed = (intersectionsByPath.get(source) ?? []).map((intersection) => ({
      ...intersection,
      s: source.closed ? mod(reverse.length - intersection.s, reverse.length) : reverse.length - intersection.s,
    }));
    registerPath(reverse, transformed);
    return reverse;
  }

  return { chooseRoute, getReversePath: ensureReversePath };
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function tangentAt(path: Path2D, s: number): V2 {
  return path.sample(s).t;
}

function orientedTangentAt(path: Path2D, s: number, direction: 1 | -1): V2 {
  const tangent = tangentAt(path, direction > 0 ? s + 0.5 : s - 0.5);
  return direction > 0 ? tangent : { x: -tangent.x, z: -tangent.z };
}

function classifyMovement(incoming: V2, outgoing: V2): TurnMovement | null {
  const dot = incoming.x * outgoing.x + incoming.z * outgoing.z;
  if (dot < U_TURN_DOT) return null;
  if (Math.acos(Math.max(-1, Math.min(1, dot))) <= THROUGH_ANGLE) return 'through';
  const cross = incoming.x * outgoing.z - incoming.z * outgoing.x;
  return cross > 0 ? 'right' : 'left';
}

function advanceS(path: Path2D, s: number, direction: 1 | -1, distance: number): number | null {
  const next = s + direction * distance;
  if (path.closed) return next;
  if (next < 0 || next > path.length) return null;
  return next;
}

function add(a: V2, direction: V2, distance: number): V2 {
  return { x: a.x + direction.x * distance, z: a.z + direction.z * distance };
}

function sampleCubic(p0: V2, p1: V2, p2: V2, p3: V2, count: number): V2[] {
  const result: V2[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const u = 1 - t;
    result.push({
      x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
      z: u ** 3 * p0.z + 3 * u ** 2 * t * p1.z + 3 * u * t ** 2 * p2.z + t ** 3 * p3.z,
    });
  }
  return result;
}

function dedupe(points: V2[]): V2[] {
  const result: V2[] = [];
  for (const point of points) {
    if (!result.length || Math.hypot(result[result.length - 1].x - point.x, result[result.length - 1].z - point.z) > 1e-4) result.push(point);
  }
  return result;
}
