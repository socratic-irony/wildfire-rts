/**
 * Uniform-grid spatial index over road midline segments.
 *
 * Built from the polylines exposed by RoadsVisual.getMidlinesXZ(). Each query
 * returns the closest segment plus its tangent/normal — used by Frenet
 * controllers for yaw smoothing and by upcoming fire-aware re-pathing
 * (ROADMAP item 5).
 */

export type Point2 = { x: number; z: number };

export type MidlineQueryResult = {
  pathIdx: number;
  segIdx: number;
  /** Parametric position along the segment in [0,1]. */
  t: number;
  /** Closest point on the segment. */
  point: Point2;
  /** Euclidean distance from query to closest point. */
  distance: number;
  /** Unit tangent of the segment (direction of travel). */
  tangent: Point2;
  /** Unit normal (rotated 90° CCW from tangent). */
  normal: Point2;
};

type Segment = {
  pathIdx: number;
  segIdx: number;
  ax: number; az: number;
  bx: number; bz: number;
  /** Length squared, cached for projection. */
  len2: number;
};

export class MidlineIndex {
  private segs: Segment[] = [];
  private cellSize = 0;
  private minX = 0;
  private minZ = 0;
  private cols = 0;
  private rows = 0;
  private cells: number[][] = []; // each cell holds indices into this.segs

  /**
   * @param paths   Polylines as exposed by RoadsVisual.getMidlinesXZ().
   * @param cellSize  Bucket size in world units. ~2-4× the typical road segment
   *                  length is a good starting point.
   */
  build(paths: ReadonlyArray<ReadonlyArray<Point2>>, cellSize: number): void {
    this.segs = [];
    this.cellSize = Math.max(cellSize, 1e-3);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let pi = 0; pi < paths.length; pi++) {
      const pts = paths[pi];
      for (let si = 0; si < pts.length - 1; si++) {
        const a = pts[si], b = pts[si + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len2 = dx * dx + dz * dz;
        if (len2 < 1e-12) continue;
        this.segs.push({ pathIdx: pi, segIdx: si, ax: a.x, az: a.z, bx: b.x, bz: b.z, len2 });
        if (a.x < minX) minX = a.x; if (b.x < minX) minX = b.x;
        if (a.x > maxX) maxX = a.x; if (b.x > maxX) maxX = b.x;
        if (a.z < minZ) minZ = a.z; if (b.z < minZ) minZ = b.z;
        if (a.z > maxZ) maxZ = a.z; if (b.z > maxZ) maxZ = b.z;
      }
    }

    if (this.segs.length === 0) {
      this.cols = this.rows = 0;
      this.cells = [];
      return;
    }

    this.minX = minX;
    this.minZ = minZ;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / this.cellSize) + 1);
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / this.cellSize) + 1);
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];

    for (let si = 0; si < this.segs.length; si++) {
      const s = this.segs[si];
      const c0 = this.cellCoord(s.ax, s.az);
      const c1 = this.cellCoord(s.bx, s.bz);
      const minC = Math.min(c0.col, c1.col), maxC = Math.max(c0.col, c1.col);
      const minR = Math.min(c0.row, c1.row), maxR = Math.max(c0.row, c1.row);
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          this.cells[r * this.cols + c].push(si);
        }
      }
    }
  }

  size(): number { return this.segs.length; }

  /**
   * Find the closest midline segment to a world XZ point.
   * Returns null when the index is empty.
   */
  nearest(x: number, z: number): MidlineQueryResult | null {
    if (this.segs.length === 0) return null;

    // Expand the search radius in cell rings until we find a candidate, then do
    // one more ring to confirm — guarantees we don't miss a closer segment that
    // happens to live in a neighboring bucket.
    const seen = new Set<number>();
    let bestSi = -1;
    let bestD2 = Infinity;

    const { col: c0, row: r0 } = this.cellCoord(x, z);
    const maxRing = Math.max(this.cols, this.rows);

    for (let ring = 0; ring <= maxRing; ring++) {
      const before = bestD2;
      this.scanRing(c0, r0, ring, seen, x, z, (si, d2) => {
        if (d2 < bestD2) { bestD2 = d2; bestSi = si; }
      });
      // If we already have a hit and this ring's worst-case distance to the
      // query exceeds our current best, we can stop.
      if (bestSi >= 0 && ring > 0) {
        const ringMin = (ring - 1) * this.cellSize;
        if (ringMin * ringMin > bestD2) break;
      }
      // Avoid infinite loop when grid is tiny
      if (bestSi >= 0 && before === bestD2 && ring > 0 && (ring * this.cellSize) * (ring * this.cellSize) > bestD2) break;
    }

    if (bestSi < 0) {
      // Fallback: brute-force (only hit if grid is empty for this query area)
      for (let si = 0; si < this.segs.length; si++) {
        const d2 = this.distance2ToSeg(this.segs[si], x, z);
        if (d2 < bestD2) { bestD2 = d2; bestSi = si; }
      }
      if (bestSi < 0) return null;
    }

    return this.buildResult(bestSi, x, z, bestD2);
  }

  private scanRing(
    c0: number, r0: number, ring: number,
    seen: Set<number>,
    x: number, z: number,
    visit: (si: number, d2: number) => void
  ): void {
    const minC = Math.max(0, c0 - ring), maxC = Math.min(this.cols - 1, c0 + ring);
    const minR = Math.max(0, r0 - ring), maxR = Math.min(this.rows - 1, r0 + ring);
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (ring > 0 && c !== minC && c !== maxC && r !== minR && r !== maxR) continue;
        const list = this.cells[r * this.cols + c];
        for (const si of list) {
          if (seen.has(si)) continue;
          seen.add(si);
          const d2 = this.distance2ToSeg(this.segs[si], x, z);
          visit(si, d2);
        }
      }
    }
  }

  private cellCoord(x: number, z: number) {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.minX) / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor((z - this.minZ) / this.cellSize)));
    return { col, row };
  }

  private distance2ToSeg(s: Segment, x: number, z: number): number {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    let t = ((x - s.ax) * dx + (z - s.az) * dz) / s.len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const px = s.ax + t * dx, pz = s.az + t * dz;
    const ex = x - px, ez = z - pz;
    return ex * ex + ez * ez;
  }

  private buildResult(si: number, x: number, z: number, d2: number): MidlineQueryResult {
    const s = this.segs[si];
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    let t = ((x - s.ax) * dx + (z - s.az) * dz) / s.len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const px = s.ax + t * dx, pz = s.az + t * dz;
    const len = Math.sqrt(s.len2);
    const tx = dx / len, tz = dz / len;
    return {
      pathIdx: s.pathIdx,
      segIdx: s.segIdx,
      t,
      point: { x: px, z: pz },
      distance: Math.sqrt(d2),
      tangent: { x: tx, z: tz },
      normal: { x: -tz, z: tx },
    };
  }
}
