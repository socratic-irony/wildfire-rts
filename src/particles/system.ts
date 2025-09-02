import { AdditiveBlending, BufferAttribute, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Vector3 } from 'three';

export type ParticleSystemKind = 'flame' | 'smoke' | 'smolder';

export type ParticleSpawn = {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  life: number;           // seconds
  size0: number;          // start scale (meters)
  size1: number;          // end scale (meters)
  color0: [number, number, number];
  color1: [number, number, number];
};

const tmpMat = new Matrix4();

export class InstancedParticleSystem {
  readonly kind: ParticleSystemKind;
  readonly capacity: number;
  readonly mesh: InstancedMesh;

  // CPU state (SoA)
  private pos: Float32Array;   // xyz per particle
  private vel: Float32Array;   // xyz per particle
  private age: Float32Array;   // seconds
  private life: Float32Array;  // seconds
  private size0: Float32Array; // meters
  private size1: Float32Array; // meters
  private c0: Float32Array;    // rgb
  private c1: Float32Array;    // rgb
  private alive: Uint8Array;   // 0/1
  private aliveCount = 0;

  // Instanced attributes
  private aAgeLife: InstancedBufferAttribute;
  private aColor0: InstancedBufferAttribute;
  private aColor1: InstancedBufferAttribute;

  constructor(kind: ParticleSystemKind, geom: THREE.BufferGeometry, mat: MeshStandardMaterial | MeshBasicMaterial, capacity: number) {
    this.kind = kind;
    this.capacity = capacity;
    this.mesh = new InstancedMesh(geom, mat as any, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    (this.mesh as any).frustumCulled = false;
    this.mesh.renderOrder = 9;

    // CPU arrays
    const N = capacity;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.age = new Float32Array(N);
    this.life = new Float32Array(N);
    this.size0 = new Float32Array(N);
    this.size1 = new Float32Array(N);
    this.c0 = new Float32Array(N * 3);
    this.c1 = new Float32Array(N * 3);
    this.alive = new Uint8Array(N);

    // Per-instance attributes for shader color/opacity over age
    this.aAgeLife = new InstancedBufferAttribute(new Float32Array(N * 2), 2);
    this.aAgeLife.setUsage(DynamicDrawUsage);
    this.aColor0 = new InstancedBufferAttribute(this.c0, 3);
    this.aColor0.setUsage(DynamicDrawUsage);
    this.aColor1 = new InstancedBufferAttribute(this.c1, 3);
    this.aColor1.setUsage(DynamicDrawUsage);
    this.mesh.geometry.setAttribute('aAgeLife', this.aAgeLife);
    this.mesh.geometry.setAttribute('aColor0', this.aColor0);
    this.mesh.geometry.setAttribute('aColor1', this.aColor1);

    // Inject shader modifications for per-instance fade/color
    const stdMat = this.mesh.material as MeshStandardMaterial | MeshBasicMaterial;
    stdMat.transparent = true;
    stdMat.depthWrite = false;
    if (kind === 'flame') {
      // Additive for flames
      (stdMat as any).blending = AdditiveBlending;
    }
    stdMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>\n attribute vec2 aAgeLife;\n attribute vec3 aColor0;\n attribute vec3 aColor1;\n varying float vAgeT;\n varying vec3 vCol0;\n varying vec3 vCol1;`
      ).replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n vAgeT = clamp(aAgeLife.x / max(0.001, aAgeLife.y), 0.0, 1.0);\n vCol0 = aColor0; vCol1 = aColor1;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>\n varying float vAgeT;\n varying vec3 vCol0;\n varying vec3 vCol1;`
      ).replace(
        '#include <output_fragment>',
        `#include <output_fragment>\n float t = clamp(vAgeT, 0.0, 1.0);\n vec3 cc = mix(vCol0, vCol1, t);\n // opacity ramp: flames stronger, smoke/smolder more transparent
         float op = ${kind === 'flame' ? '0.9 * (1.0 - t)' : '0.35 * (smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.6, 1.0, t)))'};\n gl_FragColor.rgb *= cc;\n gl_FragColor.a *= op;`
      );
      (stdMat as any).userData.shader = shader;
    };
  }

  private findFree(): number {
    if (this.aliveCount >= this.capacity) return -1;
    // linear scan is fine for small N, could maintain free list if needed
    for (let i = 0; i < this.capacity; i++) if (!this.alive[i]) return i;
    return -1;
  }

  spawnOne(s: ParticleSpawn) {
    const i = this.findFree();
    if (i < 0) return false;
    this.alive[i] = 1; this.aliveCount++;
    const i3 = i * 3;
    this.pos[i3+0] = s.pos.x; this.pos[i3+1] = s.pos.y; this.pos[i3+2] = s.pos.z;
    this.vel[i3+0] = s.vel.x; this.vel[i3+1] = s.vel.y; this.vel[i3+2] = s.vel.z;
    this.age[i] = 0; this.life[i] = Math.max(0.1, s.life);
    this.size0[i] = s.size0; this.size1[i] = s.size1;
    this.c0[i3+0] = s.color0[0]; this.c0[i3+1] = s.color0[1]; this.c0[i3+2] = s.color0[2];
    this.c1[i3+0] = s.color1[0]; this.c1[i3+1] = s.color1[1]; this.c1[i3+2] = s.color1[2];
    return true;
  }

  update(dt: number, wind: { wx: number; wz: number }, slopeLift = 0) {
    const N = this.capacity;
    const m = this.mesh;
    const matArr = m.instanceMatrix.array as Float32Array;
    let anyChanged = false;
    for (let i = 0; i < N; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.alive[i] = 0; this.aliveCount--; continue; }
      // integrate velocity with simple wind advection (more for smoke)
      const i3 = i * 3;
      const t = this.age[i] / Math.max(0.001, this.life[i]);
      // kind-based advection weights
      const horiz = this.kind === 'smoke' ? 0.9 : this.kind === 'smolder' ? 0.4 : 0.35;
      const up = this.kind === 'flame' ? 1.6 : this.kind === 'smoke' ? 0.9 : 0.35;
      this.vel[i3+0] += wind.wx * horiz * dt;
      this.vel[i3+2] += wind.wz * horiz * dt;
      this.vel[i3+1] += up * dt + slopeLift * dt * 0.5;
      this.pos[i3+0] += this.vel[i3+0] * dt;
      this.pos[i3+1] += this.vel[i3+1] * dt;
      this.pos[i3+2] += this.vel[i3+2] * dt;

      // write matrix: scale over lifetime (lerp size0->size1)
      const s = this.size0[i] * (1 - t) + this.size1[i] * t;
      tmpMat.makeScale(s, s, s);
      tmpMat.setPosition(this.pos[i3+0], this.pos[i3+1], this.pos[i3+2]);
      (m as any).setMatrixAt(i, tmpMat);

      // age/life + colors
      this.aAgeLife.setXY(i, this.age[i], this.life[i]);
      // colors already in buffers; no per-frame change required, but keep attributes marked dynamic
      anyChanged = true;
    }
    if (anyChanged) {
      m.instanceMatrix.needsUpdate = true;
      this.aAgeLife.needsUpdate = true;
      this.aColor0.needsUpdate = true;
      this.aColor1.needsUpdate = true;
    }
  }

  killAll() {
    this.alive.fill(0); this.aliveCount = 0;
  }
}
