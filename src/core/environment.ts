import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MathUtils,
  Mesh,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/** Warm late-afternoon horizon tint; fog and scene background align to it. */
export const HORIZON_COLOR = '#e6d9bd';
/** Replaces the boot-time FogExp2 density (0.008) with distant haze. */
export const FOG_DENSITY = 0.0018;
/** Default sky-dome half extent (world units); must stay inside the camera far plane. */
export const DEFAULT_WORLD_RADIUS = 900;

/**
 * Pure helper: unit vector pointing toward the sun for a given elevation and
 * azimuth in degrees. Elevation 90 is straight up (+Y); azimuth 0 faces +Z,
 * increasing clockwise viewed from above (toward +X at 90). Matches the
 * `setFromSphericalCoords` convention used by the Sky example.
 */
export function computeSunVector(elevDeg: number, azDeg: number): Vector3 {
  const phi = MathUtils.degToRad(90 - elevDeg);
  const theta = MathUtils.degToRad(azDeg);
  return new Vector3().setFromSphericalCoords(1, phi, theta);
}

export type EnvironmentOptions = {
  sunLight?: DirectionalLight;
  hemiLight?: HemisphereLight;
  /** Dome half extent; keep below the camera far plane (main.ts raises far to >=2000). */
  worldRadius?: number;
  /** Nudge passed light intensities for warmer contrast (default true). */
  retuneLights?: boolean;
};

export type EnvironmentHandle = {
  sky: Mesh;
  uniforms: ShaderMaterial['uniforms'];
  setSunDirection: (elevDeg: number, azDeg: number) => void;
};

/**
 * Adds the procedural Sky dome and retunes fog/lights owned elsewhere.
 * Never mutates scene.ts — lights are reached through the passed refs and the
 * FogExp2 instance is read/replaced on the live scene object.
 */
export function createEnvironment(scene: Scene, opts: EnvironmentOptions = {}): EnvironmentHandle {
  const worldRadius = opts.worldRadius ?? DEFAULT_WORLD_RADIUS;
  const sunLight = opts.sunLight;

  const sky = new Sky();
  // BoxGeometry(1,1,1) spans ±0.5 per axis, so scale == dome half extent.
  sky.scale.setScalar(worldRadius);
  scene.add(sky);

  const uniforms = (sky.material as ShaderMaterial).uniforms;
  // Warm late-afternoon look: hazier air, stronger forward scattering.
  uniforms.turbidity.value = 8;
  uniforms.rayleigh.value = 2.2;
  uniforms.mieCoefficient.value = 0.005;
  uniforms.mieDirectionalG.value = 0.8;

  // Retune fog to match the sky horizon (read/replace — main.ts owns creation).
  const horizonColor = new Color(HORIZON_COLOR);
  if (scene.fog instanceof FogExp2) {
    scene.fog.color.copy(horizonColor);
    scene.fog.density = FOG_DENSITY;
  } else {
    scene.fog = new FogExp2(horizonColor.getHex(), FOG_DENSITY);
  }
  if ((scene.background as Color | null) instanceof Color) {
    (scene.background as Color).copy(horizonColor);
  }

  if (opts.retuneLights !== false) {
    if (sunLight) sunLight.intensity = 1.25;
    if (opts.hemiLight) opts.hemiLight.intensity = 0.5;
  }

  function setSunDirection(elevDeg: number, azDeg: number) {
    const dir = computeSunVector(elevDeg, azDeg);
    uniforms.sunPosition.value.copy(dir);
    if (sunLight) {
      const dist = sunLight.position.length() || 244.9;
      sunLight.position.copy(dir).multiplyScalar(dist);
    }
  }

  // Seed from the existing light so sky and shadows start aligned.
  if (sunLight) {
    const p = sunLight.position;
    const elev = 90 - MathUtils.radToDeg(Math.acos(MathUtils.clamp(p.y / p.length(), -1, 1)));
    const az = MathUtils.radToDeg(Math.atan2(p.x, p.z));
    setSunDirection(elev, az);
  } else {
    setSunDirection(35, 45);
  }

  return { sky, uniforms, setSunDirection };
}
