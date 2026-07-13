import { describe, expect, it } from 'vitest';
import { Group, Material, Mesh, Object3D, Texture } from 'three';
import { createSuppressionDecals } from '../fire/decals';
import { createFireViz } from '../fire/viz';
import { createFlipbookParticles } from '../particles/flipbook';
import { createFireRibbon } from '../particles/ribbon';
import { generateHeightmap } from '../terrain/heightmap';

function disposeMaterial(material: Material) {
  const uniforms = (material as Material & { uniforms?: Record<string, { value?: unknown }> }).uniforms;
  if (uniforms) {
    for (const uniform of Object.values(uniforms)) {
      if (uniform.value instanceof Texture) uniform.value.dispose();
    }
  }
  material.dispose();
}

function disposeObject(root: Object3D) {
  root.traverse((object) => {
    const mesh = object as Mesh;
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach(disposeMaterial);
    else if (mesh.material) disposeMaterial(mesh.material);
  });
}

describe('visual factory callable surfaces', () => {
  it('characterizes suppression decal callable wiring', () => {
    const hm = generateHeightmap(2, 2, 1, {
      seed: 'visual-surface',
      frequency: 0,
      amplitude: 0,
      octaves: 1,
      persistence: 1,
    });
    const decals = createSuppressionDecals(hm);
    const root = new Group();
    decals.addToScene(root);

    expect(Object.keys(decals)).toEqual([
      'water',
      'retardant',
      'update',
      'addToScene',
      'setOffsetY',
      'setDepthTest',
      'updateTerrain',
    ]);
    expect(decals.updateTerrain).toBeTypeOf('function');

    disposeObject(root);
  });

  it('characterizes fire visualization callable wiring', () => {
    const hm = generateHeightmap(2, 2, 1, {
      seed: 'visual-surface',
      frequency: 0,
      amplitude: 0,
      octaves: 1,
      persistence: 1,
    });
    const viz = createFireViz(hm, new Group());
    const root = new Group();
    viz.addToScene(root);

    expect(Object.keys(viz)).toEqual([
      'overlay',
      'setMode',
      'update',
      'addToScene',
      'getMode',
      'removeFromScene',
      'updateTerrain',
    ]);
    expect(viz.updateTerrain).toBeTypeOf('function');

    disposeObject(root);
  });

  it('characterizes flipbook particle callable wiring', () => {
    const hm = generateHeightmap(2, 2, 1, {
      seed: 'visual-surface',
      frequency: 0,
      amplitude: 0,
      octaves: 1,
      persistence: 1,
    });
    const particles = createFlipbookParticles(hm);

    expect(Object.keys(particles)).toEqual(['group', 'update', 'setQuality', 'setEnabled', 'updateTerrain']);
    expect(particles.updateTerrain).toBeTypeOf('function');

    disposeObject(particles.group);
  });

  it('characterizes fire ribbon callable wiring', () => {
    const hm = generateHeightmap(2, 2, 1, {
      seed: 'visual-surface',
      frequency: 0,
      amplitude: 0,
      octaves: 1,
      persistence: 1,
    });
    const ribbon = createFireRibbon(hm);

    expect(Object.keys(ribbon)).toEqual([
      'mesh',
      'update',
      'setVisible',
      'setOpacity',
      'setWidth',
      'setSpeed',
      'updateTerrain',
    ]);
    expect(ribbon.updateTerrain).toBeTypeOf('function');

    disposeObject(ribbon.mesh);
  });
});
