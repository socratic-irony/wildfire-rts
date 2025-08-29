import { Color, DirectionalLight, HemisphereLight, Scene, FogExp2 } from 'three';

export function createScene(): Scene {
  const scene = new Scene();
  scene.background = new Color('#DDEBFF');
  scene.fog = new FogExp2(scene.background as Color, 0.008);

  const hemi = new HemisphereLight('#DDEBFF', '#CBBBA0', 0.6);
  scene.add(hemi);

  const sun = new DirectionalLight('#ffd7a1', 1.1);
  sun.position.set(100, 200, 100);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 600;
  scene.add(sun);

  return scene;
}

