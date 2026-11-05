import { BufferGeometry, Group, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { ModelBuilder, PartLayer } from './modelBuilder';

/**
 * Shared materials for models made with ModelBuilder. All colour comes from
 * vertex colours, so one material serves every vehicle, prop and building
 * part of a kind, and the renderer never switches programs between them.
 */
export const MODEL_BODY = new MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.74,
  metalness: 0.04,
});

/** Windows and windscreens: glossy, with an emissive term the atmosphere raises at dusk. */
export const MODEL_GLASS = new MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.16,
  metalness: 0.3,
  emissive: 0xffc77a,
  emissiveIntensity: 0,
});

/** Lamps that always read as lit (head/tail lights, beacons). */
export const MODEL_GLOW = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });

/** Window glow at dusk: 0 by day, ~1 at golden hour. */
export function setWindowGlow(amount: number): void {
  MODEL_GLASS.emissiveIntensity = Math.max(0, Math.min(1, amount)) * 0.55;
}

export interface ModelMaterials {
  body?: Material;
  glass?: Material;
  glow?: Material;
}

/** Turn a builder into meshes (one per non-empty layer) under a group. */
export function buildModel(builder: ModelBuilder, materials: ModelMaterials = {}, shadows = true): Group {
  const group = new Group();
  for (const [layer, geometry] of builder.build()) {
    const mesh = new Mesh(geometry, materialFor(layer, materials));
    mesh.name = layer;
    mesh.castShadow = shadows && layer === 'body';
    mesh.receiveShadow = layer === 'body';
    group.add(mesh);
  }
  return group;
}

/** Single mesh for one layer (for parts that animate on their own). */
export function buildPart(builder: ModelBuilder, material: Material = MODEL_BODY, shadows = false): Mesh | null {
  const geometry = builder.build().get('body');
  if (!geometry) return null;
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = shadows;
  return mesh;
}

function materialFor(layer: PartLayer, materials: ModelMaterials): Material {
  if (layer === 'glass') return materials.glass ?? MODEL_GLASS;
  if (layer === 'glow') return materials.glow ?? MODEL_GLOW;
  return materials.body ?? MODEL_BODY;
}

export function disposeGeometries(root: Group | Mesh): void {
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.isMesh) (mesh.geometry as BufferGeometry).dispose();
  });
}
