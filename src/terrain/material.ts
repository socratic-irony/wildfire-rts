import { Color, MeshStandardMaterial } from 'three';

export function createTerrainMaterial() {
  const mat = new MeshStandardMaterial({
    color: new Color('#8ACB88'),
    flatShading: true,
    roughness: 0.75,
    metalness: 0.0,
  });
  mat.receiveShadow = true;
  return mat;
}

