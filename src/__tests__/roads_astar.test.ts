import { describe, it, expect } from 'vitest';
import { aStarPath, type CostField } from '../roads/astar';

describe('roads aStarPath', () => {
  it('finds shortest path avoiding obstacles', () => {
    const field: CostField = {
      width: 3,
      height: 3,
      costAt: (x, z) => {
        if (x === 1 && z === 1) return Infinity; // obstacle
        return 1;
      },
    };
    const path = aStarPath(field, { x: 0, z: 0 }, { x: 2, z: 2 });
    expect(path[0]).toEqual({ x: 0, z: 0 });
    expect(path[path.length - 1]).toEqual({ x: 2, z: 2 });
    expect(path.find((p) => p.x === 1 && p.z === 1)).toBeUndefined();
  });

  it('applies turn penalty to favor straighter paths', () => {
    const field: CostField = {
      width: 3,
      height: 2,
      costAt: (_x, _z, step, prev) => {
        const base = 1;
        if (!prev) return base;
        const turned = prev.dx !== step.dx || prev.dz !== step.dz;
        return turned ? base + 5 : base;
      },
    };
    const path = aStarPath(
      field,
      { x: 0, z: 0 },
      { x: 2, z: 1 },
      { diag: false, heuristic: 'manhattan' }
    );
    expect(path).toEqual([
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 1 },
    ]);
  });
});

