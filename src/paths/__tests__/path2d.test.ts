import { describe, expect, it } from 'vitest';
import { Path2D } from '../path2d';

describe('Path2D.projectAll', () => {
  it('returns both arc positions where a path crosses the same point', () => {
    const path = new Path2D([
      { x: 0, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
      { x: 10, z: 0 },
    ]);

    const hits = path.projectAll({ x: 5, z: 5 }, 0.01);

    expect(hits).toHaveLength(2);
    expect(hits[0].dist).toBeLessThan(0.01);
    expect(hits[1].dist).toBeLessThan(0.01);
    expect(hits[1].s - hits[0].s).toBeGreaterThan(10);
  });
});
