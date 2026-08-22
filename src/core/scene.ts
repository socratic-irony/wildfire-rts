import { Color, DirectionalLight, HemisphereLight, Scene, FogExp2 } from 'three';

export type CreateSceneOptions = {
  /** World-space center of the play area; sun target and shadow box center on it. */
  worldCenter?: { x: number; z: number };
  /** Half-extent (world units) of the shadow camera ortho box around the target. */
  shadowExtent?: number;
};

const DEFAULT_WORLD_CENTER = { x: 64, z: 64 };
const DEFAULT_SHADOW_EXTENT = 96;

export function createScene(opts: CreateSceneOptions = {}): Scene {
  const center = opts.worldCenter ?? DEFAULT_WORLD_CENTER;
  const extent = opts.shadowExtent ?? DEFAULT_SHADOW_EXTENT;

  const scene = new Scene();
  scene.background = new Color('#DDEBFF');
  scene.fog = new FogExp2(scene.background as Color, 0.008);

  const hemi = new HemisphereLight('#DDEBFF', '#CBBBA0', 0.6);
  scene.add(hemi);

  const sun = new DirectionalLight('#ffd7a1', 1.1);
  sun.position.set(center.x + 100, 200, center.z + 100);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 600;
  sun.target.position.set(center.x, 0, center.z);
  scene.add(sun.target);
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -extent;
  shadowCam.right = extent;
  shadowCam.top = extent;
  shadowCam.bottom = -extent;
  shadowCam.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  return scene;
}
