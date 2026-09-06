import { describe, expect, it } from 'vitest';
import { Path2D } from '../../paths/path2d';
import { createTurnRouter } from '../turnRouting';

function crossingNetwork() {
  const eastWest = new Path2D([{ x: 0, z: 50 }, { x: 100, z: 50 }]);
  const northSouth = new Path2D([{ x: 50, z: 0 }, { x: 50, z: 100 }]);
  const info = { id: 3, s: 50, pos: { x: 50, z: 50 } };
  return {
    eastWest,
    northSouth,
    router: createTurnRouter([
      { path: eastWest, intersections: [{ ...info, s: 50 }] },
      { path: northSouth, intersections: [{ ...info, s: 50 }] },
    ]),
    info,
  };
}

describe('connected-road turn routing', () => {
  it('selects a deterministic connected movement without a U-turn', () => {
    const { eastWest, router, info } = crossingNetwork();

    const first = router.chooseRoute(eastWest, 48.5, info, 0);
    const same = router.chooseRoute(eastWest, 48.5, info, 0);

    expect(first).not.toBeNull();
    expect(first?.movement).toBe(same?.movement);
    expect(first?.movement).not.toBe('uturn');
    expect(first?.continuationPath).toBeDefined();
  });

  it('switches onto a real connected branch with continuous position and yaw', () => {
    const { eastWest, northSouth, router, info } = crossingNetwork();
    const route = router.chooseRoute(eastWest, 48.5, info, 0);

    expect(route).not.toBeNull();
    expect(route?.continuationPath === eastWest || route?.continuationPath === northSouth).toBe(true);
    const start = route!.path.sample(0);
    const end = route!.path.sample(route!.path.length);
    const continuationStart = route!.continuationPath.sample(route!.continuationS);
    expect(Math.hypot(start.p.x - 48.5, start.p.z - 50)).toBeLessThan(1e-6);
    expect(Math.hypot(end.p.x - continuationStart.p.x, end.p.z - continuationStart.p.z)).toBeLessThan(1e-6);

    const turnTangent = route!.path.sample(Math.max(0, route!.path.length - 0.01)).t;
    const exitTangent = continuationStart.t;
    expect(turnTangent.x * exitTangent.x + turnTangent.z * exitTangent.z).toBeGreaterThan(0.85);
  });

  it('does not invent an exit for an unrelated road', () => {
    const eastWest = new Path2D([{ x: 0, z: 50 }, { x: 100, z: 50 }]);
    const unrelated = new Path2D([{ x: 0, z: 0 }, { x: 100, z: 0 }]);
    const router = createTurnRouter([
      { path: eastWest, intersections: [{ id: 8, s: 50, pos: { x: 50, z: 50 } }] },
      { path: unrelated, intersections: [] },
    ]);

    expect(router.chooseRoute(eastWest, 48.5, { id: 8, s: 50, pos: { x: 50, z: 50 } }, 2)).toBeNull();
  });

  it('registers transformed intersections on a reverse directed continuation', () => {
    const { northSouth, router, info } = crossingNetwork();
    const route = router.chooseRoute(northSouth, 48.5, info, 2);

    expect(route?.movement).toBe('left');
    expect(route?.continuationPath).not.toBe(northSouth);
    expect(route?.continuationIntersections).toEqual([
      expect.objectContaining({ id: info.id }),
    ]);
    const sameDirection = router.chooseRoute(northSouth, 48.5, info, 5);
    expect(sameDirection?.continuationPath).toBe(route?.continuationPath);
    const transformed = route!.continuationIntersections[0];
    const followUp = router.chooseRoute(route!.continuationPath, transformed.s, transformed, 0);
    expect(followUp).not.toBeNull();
  });

  it('shares one whole-road reverse path across exits and maps back to the original', () => {
    const source = new Path2D([{ x: 50, z: 0 }, { x: 50, z: 100 }]);
    const westAt30 = new Path2D([{ x: 0, z: 30 }, { x: 100, z: 30 }]);
    const westAt70 = new Path2D([{ x: 0, z: 70 }, { x: 100, z: 70 }]);
    const i30 = { id: 30, s: 30, pos: { x: 50, z: 30 } };
    const i70 = { id: 70, s: 50, pos: { x: 50, z: 70 } };
    const router = createTurnRouter([
      { path: source, intersections: [{ ...i30, s: 30 }, { ...i70, s: 70 }] },
      { path: westAt30, intersections: [i30] },
      { path: westAt70, intersections: [i70] },
    ]);

    const first = router.chooseRoute(westAt30, 48.5, i30, 2);
    const second = router.chooseRoute(westAt70, 48.5, i70, 2);
    expect(first?.continuationPath).toBe(second?.continuationPath);
    const mapped = first!.continuationIntersections.find((entry) => entry.id === i30.id)!;
    const mappedPoint = first!.continuationPath.sample(mapped.s).p;
    expect(Math.hypot(mappedPoint.x - i30.pos.x, mappedPoint.z - i30.pos.z)).toBeLessThan(1e-6);
    expect(router.getReversePath(first!.continuationPath)).toBe(source);
  });
});
