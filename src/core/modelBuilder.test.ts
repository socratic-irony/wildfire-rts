import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { ModelBuilder } from './modelBuilder';

/** Every face normal should point away from the model's centroid for a convex part. */
function outwardFraction(builder: ModelBuilder, centre: Vector3): number {
  const geometry = builder.build().get('body')!;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  let outward = 0;
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < position.count; i += 3) {
    p.fromBufferAttribute(position, i).add(new Vector3().fromBufferAttribute(position, i + 1)).add(new Vector3().fromBufferAttribute(position, i + 2)).multiplyScalar(1 / 3);
    n.fromBufferAttribute(normal, i);
    if (n.dot(p.sub(centre)) > 0) outward += 1;
  }
  return outward / (position.count / 3);
}

describe('model builder', () => {
  it('builds boxes and lofts with outward-facing flat normals', () => {
    const box = new ModelBuilder().box(1, 2, 3, 0xff0000, 0, 1, 0);
    expect(outwardFraction(box, new Vector3(0, 1, 0))).toBe(1);
    const loft = new ModelBuilder().loft(
      [
        { z: -1, w: 0.6, h: 0.6, y: 0, bevel: 0.4 },
        { z: 0, w: 1, h: 1, y: 0, bevel: 0.4 },
        { z: 1, w: 0.4, h: 0.4, y: 0, bevel: 0.4 },
      ],
      0x00ff00,
    );
    expect(outwardFraction(loft, new Vector3(0, 0, 0))).toBe(1);
  });

  it('builds roofs that face up and out', () => {
    const roof = new ModelBuilder().gableRoof(2, 2, 1, 0x884422, 0);
    const geometry = roof.build().get('body')!;
    const normal = geometry.getAttribute('normal');
    let up = 0;
    let down = 0;
    for (let i = 0; i < normal.count; i += 3) {
      if (normal.getY(i) > 0.1) up += 1;
      if (normal.getY(i) < -0.9) down += 1;
    }
    // Two slopes (2 triangles each) face up; the soffit (2 triangles) faces down.
    expect(up).toBe(4);
    expect(down).toBe(2);
  });

  it('keeps layers separate and keeps normals outward through rotated frames', () => {
    const builder = new ModelBuilder();
    builder.box(1, 1, 1, 0xffffff);
    builder.use('glass').box(0.5, 0.5, 0.5, 0x223344, 2, 0, 0);
    builder.use('body');
    const layers = builder.build();
    expect([...layers.keys()].sort()).toEqual(['body', 'glass']);
    const rotated = new ModelBuilder();
    rotated.push(3, 1, -2, { y: 0.7, x: 0.3 }, 0.5);
    rotated.box(1, 1, 1, 0xffffff, 0, 0, 0, { z: 0.4 });
    rotated.pop();
    expect(outwardFraction(rotated, new Vector3(3, 1, -2))).toBe(1);
  });
});
