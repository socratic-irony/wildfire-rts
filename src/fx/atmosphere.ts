import { Color, DirectionalLight, FogExp2, HemisphereLight, Mesh, Scene, ShaderMaterial } from 'three';
import { clamp, smoothstep } from '../core/math';
import { WORLD_SIZE } from '../world/constants';
import { setWindowGlow } from '../core/modelMaterials';

const DAY = {
  sun: new Color(0xffe6bf),
  hemiSky: new Color(0xd9ecff),
  zenith: new Color(0x6b9fc4),
  horizon: new Color(0xe7d6b8),
  fog: new Color(0xc5d2c2),
};
const DUSK = {
  sun: new Color(0xffa45e),
  hemiSky: new Color(0xf2cdb0),
  zenith: new Color(0x52668f),
  horizon: new Color(0xf3b07c),
  fog: new Color(0xd9b896),
};
const SMOKE = new Color(0x8f8374);

/**
 * The shift runs from late afternoon into golden hour: the sun lowers and
 * warms, and the sky and fog take on smoke as the fire grows. Purely visual.
 */
export class Atmosphere {
  private readonly sun: DirectionalLight | null;
  private readonly hemi: HemisphereLight | null;
  private readonly sky: ShaderMaterial | null;
  private readonly fog: FogExp2 | null;
  private readonly background: Color | null;
  private dusk = 0;
  private smoke = 0;
  private readonly scratch = new Color();

  constructor(scene: Scene) {
    this.sun = (scene.getObjectByName('sun') as DirectionalLight | undefined) ?? null;
    this.hemi = (scene.getObjectByName('hemi') as HemisphereLight | undefined) ?? null;
    const skyMesh = scene.getObjectByName('sky') as Mesh | undefined;
    this.sky = (skyMesh?.material as ShaderMaterial | undefined) ?? null;
    this.fog = scene.fog instanceof FogExp2 ? scene.fog : null;
    this.background = scene.background instanceof Color ? scene.background : null;
  }

  /** Ease toward the look for this point of the shift (0..1) and fire size (burning tiles). */
  update(dt: number, shiftProgress: number, burningTiles: number): void {
    const duskTarget = smoothstep(0.25, 1, shiftProgress);
    const smokeTarget = clamp(burningTiles / 700, 0, 1);
    const ease = 1 - Math.exp(-dt * 0.8);
    this.dusk += (duskTarget - this.dusk) * ease;
    this.smoke += (smokeTarget - this.smoke) * ease;
    const d = this.dusk;
    const s = this.smoke;
    if (this.sun) {
      this.sun.color.copy(DAY.sun).lerp(DUSK.sun, d);
      this.sun.intensity = 2.5 - 0.55 * d - 0.5 * s;
      const center = WORLD_SIZE / 2;
      this.sun.position.set(center + 72 + 30 * d, 132 - 52 * d, center - 58 - 18 * d);
    }
    if (this.hemi) {
      this.hemi.color.copy(DAY.hemiSky).lerp(DUSK.hemiSky, d);
      this.hemi.intensity = 1.45 - 0.25 * d - 0.2 * s;
    }
    if (this.sky) {
      (this.sky.uniforms.uZenith!.value as Color).copy(DAY.zenith).lerp(DUSK.zenith, d).lerp(SMOKE, s * 0.45);
      (this.sky.uniforms.uHorizon!.value as Color).copy(DAY.horizon).lerp(DUSK.horizon, d).lerp(SMOKE, s * 0.35);
    }
    this.scratch.copy(DAY.fog).lerp(DUSK.fog, d).lerp(SMOKE, s * 0.5);
    if (this.fog) {
      this.fog.color.copy(this.scratch);
      this.fog.density = 0.0024 + 0.0016 * s;
    }
    this.background?.copy(this.scratch);
    // Lamps come on in windows as the light goes.
    setWindowGlow(smoothstep(0.35, 1, d) + s * 0.3);
  }
}
