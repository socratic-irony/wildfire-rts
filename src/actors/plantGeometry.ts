import { BufferGeometry, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Bake a plant's static lobes/branches once, then instance the whole shape. */
export function mergePlantParts(parts: ReadonlyArray<{
  geometry: BufferGeometry;
  offsetX?: number; offsetY: number; offsetZ?: number;
  scaleX: number; scaleY: number; scaleZ: number; rotationZ?: number;
}>): BufferGeometry {
  const matrix = new Matrix4();
  const geometries = parts.map(part => {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    matrix.compose(
      new Vector3(part.offsetX ?? 0, part.offsetY, part.offsetZ ?? 0),
      new Quaternion().setFromEuler(new Euler(0, 0, part.rotationZ ?? 0)),
      new Vector3(part.scaleX, part.scaleY, part.scaleZ),
    );
    return geometry.applyMatrix4(matrix);
  });
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error('Plant components have incompatible geometry attributes');
  return merged;
}
