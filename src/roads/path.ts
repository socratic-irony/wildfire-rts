export type GridPoint = { x: number; z: number };

function clonePoint(p: GridPoint): GridPoint {
  return { x: p.x, z: p.z };
}

function dedupe(points: GridPoint[]): GridPoint[] {
  if (!points.length) return [];
  const out: GridPoint[] = [clonePoint(points[0])];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    if (prev.x === cur.x && prev.z === cur.z) continue;
    out.push(clonePoint(cur));
  }
  return out;
}

function areCollinear(a: GridPoint, b: GridPoint, c: GridPoint): boolean {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const bcx = c.x - b.x;
  const bcz = c.z - b.z;
  return abx * bcz === abz * bcx;
}

/**
 * Reduce a raw A* grid path into an angular polyline that snaps to tile centres.
 *
 * - Consecutive duplicate samples are removed.
 * - Collinear interior points are dropped so we only keep actual turns.
 *
 * The resulting path preserves the start/end tiles and only introduces
 * orthogonal segments when the caller disables diagonal moves in A*.
 */
export function makeAngularPath(points: GridPoint[]): GridPoint[] {
  if (points.length <= 2) return points.map(clonePoint);
  const deduped = dedupe(points);
  if (deduped.length <= 2) return deduped;
  const out: GridPoint[] = [clonePoint(deduped[0])];
  for (let i = 1; i < deduped.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = deduped[i];
    const next = deduped[i + 1];
    if (areCollinear(prev, cur, next)) continue;
    out.push(clonePoint(cur));
  }
  out.push(clonePoint(deduped[deduped.length - 1]));
  return out;
}
