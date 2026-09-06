import { describe, expect, it } from 'vitest';
import { generateHeightmap } from '../../terrain/heightmap';
import { RoadsVisual } from '../visual';

function flatHeightmap() {
  return generateHeightmap(64, 64, 1, {
    seed: 'flat',
    frequency: 0,
    amplitude: 0,
    octaves: 1,
    persistence: 1,
  });
}

describe('RoadsVisual intersection metadata', () => {
  it('reports one stable intersection record for a self-crossing path', () => {
    const roads = new RoadsVisual(flatHeightmap());
    roads.addPath([
      { x: 12, z: 12 },
      { x: 28, z: 28 },
      { x: 12, z: 28 },
      { x: 28, z: 12 },
      { x: 12, z: 12 },
    ]);

    roads.buildIntersections();

    const intersections = roads.getIntersectionsForPath(0);
    expect(intersections).toHaveLength(2);
    expect(new Set(intersections.map((entry) => entry.id)).size).toBe(1);
    expect(Math.abs(intersections[0].s - intersections[1].s)).toBeGreaterThan(4);
  });

  it('shares one intersection id between two paths that cross in their interiors', () => {
    const roads = new RoadsVisual(flatHeightmap());
    roads.addPath([{ x: 8, z: 20 }, { x: 36, z: 20 }]);
    roads.addPath([{ x: 22, z: 8 }, { x: 22, z: 34 }]);

    roads.buildIntersections();

    const horizontal = roads.getIntersectionsForPath(0);
    const vertical = roads.getIntersectionsForPath(1);
    expect(horizontal).toHaveLength(1);
    expect(vertical).toHaveLength(1);
    expect(horizontal[0].id).toBe(vertical[0].id);
  });

  it('does not treat a simple shared endpoint as a controlled intersection', () => {
    const roads = new RoadsVisual(flatHeightmap());
    roads.addPath([{ x: 8, z: 20 }, { x: 22, z: 20 }]);
    roads.addPath([{ x: 22, z: 20 }, { x: 22, z: 34 }]);

    roads.buildIntersections();

    expect(roads.getIntersectionsForPath(0)).toHaveLength(0);
    expect(roads.getIntersectionsForPath(1)).toHaveLength(0);
  });

  it('creates one stop sign per incoming approach for an X crossing', () => {
    const roads = new RoadsVisual(flatHeightmap());
    roads.addPath([{ x: 8, z: 32 }, { x: 56, z: 32 }]);
    roads.addPath([{ x: 32, z: 8 }, { x: 32, z: 56 }]);

    roads.buildIntersections();

    expect(roads.getStopSignApproaches()).toHaveLength(4);
    expect(roads.group.getObjectByName('road-stop-sign-boards')).toMatchObject({ count: 4 });
  });

  it('creates three stop signs for a T junction and none for a simple join', () => {
    const roads = new RoadsVisual(flatHeightmap());
    roads.addPath([{ x: 8, z: 32 }, { x: 56, z: 32 }]);
    roads.addPath([{ x: 32, z: 8 }, { x: 32, z: 32 }]);
    roads.buildIntersections();

    expect(roads.getStopSignApproaches()).toHaveLength(3);

    const joined = new RoadsVisual(flatHeightmap());
    joined.addPath([{ x: 8, z: 32 }, { x: 32, z: 32 }]);
    joined.addPath([{ x: 32, z: 32 }, { x: 32, z: 56 }]);
    joined.buildIntersections();
    expect(joined.getStopSignApproaches()).toHaveLength(0);
  });

  it('creates four unique stop signs for a self-crossing path', () => {
    const roads = new RoadsVisual(flatHeightmap());
    roads.addPath([
      { x: 12, z: 12 },
      { x: 52, z: 52 },
      { x: 12, z: 52 },
      { x: 52, z: 12 },
      { x: 12, z: 12 },
    ]);

    roads.buildIntersections();

    expect(roads.getStopSignApproaches()).toHaveLength(4);
    expect(new Set(roads.getStopSignApproaches().map((entry) => `${entry.intersectionId}:${entry.direction.x.toFixed(3)}:${entry.direction.z.toFixed(3)}`)).size).toBe(4);
  });

  it('places every stop sign beyond the drivable half-width and at a common stop distance', () => {
    const roads = new RoadsVisual(flatHeightmap());
    roads.addPath([{ x: 8, z: 32 }, { x: 56, z: 32 }]);
    roads.addPath([{ x: 32, z: 8 }, { x: 32, z: 56 }]);
    roads.buildIntersections();

    for (const sign of roads.getStopSignApproaches()) {
      expect(Math.hypot(sign.stopPos.x - sign.intersectionPos.x, sign.stopPos.z - sign.intersectionPos.z)).toBeGreaterThan(2);
      expect(Math.hypot(sign.signPos.x - sign.stopPos.x, sign.signPos.z - sign.stopPos.z)).toBeGreaterThan(0.8);
    }
  });
});
