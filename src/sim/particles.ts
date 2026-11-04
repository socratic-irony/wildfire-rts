import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  NormalBlending,
  Points,
  ShaderMaterial,
} from 'three';
import { GRID_SIZE, TILE_SIZE, tileIndex } from '../world/constants';
import { Heightmap } from '../world/heightmap';
import { FireState, Wildfire } from './fire';

interface ParticlePoolOptions {
  capacity: number;
  additive: boolean;
}

class ParticlePool {
  readonly points: Points;
  private readonly capacity: number;
  private count = 0;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly r0: Float32Array;
  private readonly g0: Float32Array;
  private readonly b0: Float32Array;
  private readonly r1: Float32Array;
  private readonly g1: Float32Array;
  private readonly b1: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly geometry: BufferGeometry;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;

  constructor(options: ParticlePoolOptions) {
    this.capacity = options.capacity;
    this.px = new Float32Array(this.capacity);
    this.py = new Float32Array(this.capacity);
    this.pz = new Float32Array(this.capacity);
    this.vx = new Float32Array(this.capacity);
    this.vy = new Float32Array(this.capacity);
    this.vz = new Float32Array(this.capacity);
    this.age = new Float32Array(this.capacity);
    this.life = new Float32Array(this.capacity);
    this.size0 = new Float32Array(this.capacity);
    this.size1 = new Float32Array(this.capacity);
    this.r0 = new Float32Array(this.capacity);
    this.g0 = new Float32Array(this.capacity);
    this.b0 = new Float32Array(this.capacity);
    this.r1 = new Float32Array(this.capacity);
    this.g1 = new Float32Array(this.capacity);
    this.b1 = new Float32Array(this.capacity);
    this.gravity = new Float32Array(this.capacity);
    this.drag = new Float32Array(this.capacity);
    this.alpha0 = new Float32Array(this.capacity);
    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.sizes = new Float32Array(this.capacity);
    this.alphas = new Float32Array(this.capacity);
    this.geometry = new BufferGeometry();
    const positionAttribute = new BufferAttribute(this.positions, 3);
    positionAttribute.setUsage(DynamicDrawUsage);
    const colorAttribute = new BufferAttribute(this.colors, 3);
    colorAttribute.setUsage(DynamicDrawUsage);
    const sizeAttribute = new BufferAttribute(this.sizes, 1);
    sizeAttribute.setUsage(DynamicDrawUsage);
    const alphaAttribute = new BufferAttribute(this.alphas, 1);
    alphaAttribute.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', positionAttribute);
    this.geometry.setAttribute('aColor', colorAttribute);
    this.geometry.setAttribute('aSize', sizeAttribute);
    this.geometry.setAttribute('aAlpha', alphaAttribute);
    this.geometry.setDrawRange(0, 0);

    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: options.additive ? AdditiveBlending : NormalBlending,
      toneMapped: false,
      uniforms: {
        uPixelPerWorld: { value: 10 },
      },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uPixelPerWorld;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vColor = aColor;
          vAlpha = aAlpha;
          gl_PointSize = clamp(aSize * uPixelPerWorld, 1.0, 150.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          if (d > 0.5) discard;
          float alpha = smoothstep(0.5, 0.08, d) * vAlpha;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
    });

    this.points = new Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = options.additive ? 7 : 6;
    this.points.name = options.additive ? 'particles-hot' : 'particles-soft';
  }

  get activeCount(): number {
    return this.count;
  }

  emit(data: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    size0: number;
    size1: number;
    color0: [number, number, number];
    color1: [number, number, number];
    gravity?: number;
    drag?: number;
    alpha?: number;
  }): void {
    if (this.count >= this.capacity) return;
    const i = this.count;
    this.count += 1;
    this.px[i] = data.x;
    this.py[i] = data.y;
    this.pz[i] = data.z;
    this.vx[i] = data.vx;
    this.vy[i] = data.vy;
    this.vz[i] = data.vz;
    this.age[i] = 0;
    this.life[i] = data.life;
    this.size0[i] = data.size0;
    this.size1[i] = data.size1;
    this.r0[i] = data.color0[0];
    this.g0[i] = data.color0[1];
    this.b0[i] = data.color0[2];
    this.r1[i] = data.color1[0];
    this.g1[i] = data.color1[1];
    this.b1[i] = data.color1[2];
    this.gravity[i] = data.gravity ?? 0;
    this.drag[i] = data.drag ?? 0;
    this.alpha0[i] = data.alpha ?? 1;
  }

  update(dt: number, pixelPerWorld: number): void {
    let i = 0;
    while (i < this.count) {
      this.age[i] = (this.age[i] ?? 0) + dt;
      if ((this.age[i] ?? 0) >= (this.life[i] ?? 0)) {
        this.swapRemove(i);
        continue;
      }
      const drag = this.drag[i] ?? 0;
      const dragFactor = Math.max(0, 1 - drag * dt);
      this.vx[i] = (this.vx[i] ?? 0) * dragFactor;
      this.vz[i] = (this.vz[i] ?? 0) * dragFactor;
      this.vy[i] = (this.vy[i] ?? 0) - (this.gravity[i] ?? 0) * dt;
      this.px[i] = (this.px[i] ?? 0) + (this.vx[i] ?? 0) * dt;
      this.py[i] = (this.py[i] ?? 0) + (this.vy[i] ?? 0) * dt;
      this.pz[i] = (this.pz[i] ?? 0) + (this.vz[i] ?? 0) * dt;
      const t = (this.age[i] ?? 0) / Math.max(0.001, this.life[i] ?? 1);
      const fadeIn = Math.min(1, t / 0.1);
      const fadeOut = Math.min(1, (1 - t) / 0.45);
      const alpha = (this.alpha0[i] ?? 1) * fadeIn * fadeOut;
      const size = (this.size0[i] ?? 0.2) + ((this.size1[i] ?? 0.2) - (this.size0[i] ?? 0.2)) * t;
      const colorT = t;
      const r = (this.r0[i] ?? 1) + ((this.r1[i] ?? 1) - (this.r0[i] ?? 1)) * colorT;
      const g = (this.g0[i] ?? 1) + ((this.g1[i] ?? 1) - (this.g0[i] ?? 1)) * colorT;
      const b = (this.b0[i] ?? 1) + ((this.b1[i] ?? 1) - (this.b0[i] ?? 1)) * colorT;
      const p3 = i * 3;
      this.positions[p3] = this.px[i] ?? 0;
      this.positions[p3 + 1] = this.py[i] ?? 0;
      this.positions[p3 + 2] = this.pz[i] ?? 0;
      this.colors[p3] = r;
      this.colors[p3 + 1] = g;
      this.colors[p3 + 2] = b;
      this.sizes[i] = size;
      this.alphas[i] = alpha;
      i += 1;
    }
    this.geometry.setDrawRange(0, this.count);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('aColor').needsUpdate = true;
    this.geometry.getAttribute('aSize').needsUpdate = true;
    this.geometry.getAttribute('aAlpha').needsUpdate = true;
    (this.points.material as ShaderMaterial).uniforms.uPixelPerWorld!.value = pixelPerWorld;
  }

  private swapRemove(index: number): void {
    const last = this.count - 1;
    if (index !== last) {
      this.px[index] = this.px[last] ?? 0;
      this.py[index] = this.py[last] ?? 0;
      this.pz[index] = this.pz[last] ?? 0;
      this.vx[index] = this.vx[last] ?? 0;
      this.vy[index] = this.vy[last] ?? 0;
      this.vz[index] = this.vz[last] ?? 0;
      this.age[index] = this.age[last] ?? 0;
      this.life[index] = this.life[last] ?? 0;
      this.size0[index] = this.size0[last] ?? 0;
      this.size1[index] = this.size1[last] ?? 0;
      this.r0[index] = this.r0[last] ?? 0;
      this.g0[index] = this.g0[last] ?? 0;
      this.b0[index] = this.b0[last] ?? 0;
      this.r1[index] = this.r1[last] ?? 0;
      this.g1[index] = this.g1[last] ?? 0;
      this.b1[index] = this.b1[last] ?? 0;
      this.gravity[index] = this.gravity[last] ?? 0;
      this.drag[index] = this.drag[last] ?? 0;
      this.alpha0[index] = this.alpha0[last] ?? 0;
    }
    this.count = last;
  }

  clear(): void {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }
}

export class ParticleSystem {
  readonly group = new Group();
  readonly hot = new ParticlePool({ capacity: 4200, additive: true });
  readonly soft = new ParticlePool({ capacity: 3600, additive: false });
  private readonly heightmap: Heightmap;

  constructor(heightmap: Heightmap) {
    this.heightmap = heightmap;
    this.group.name = 'particles';
    this.group.add(this.soft.points, this.hot.points);
  }

  update(
    fire: Wildfire,
    dt: number,
    windX: number,
    windZ: number,
    pixelPerWorld: number,
  ): void {
    this.emitWildfire(fire, dt, windX, windZ);
    this.hot.update(dt, pixelPerWorld);
    this.soft.update(dt, pixelPerWorld);
  }

  emitWaterSpray(fromX: number, fromY: number, fromZ: number, toX: number, toZ: number, dt: number): void {
    const count = Math.min(8, Math.floor(dt * 220 + Math.random() * 2));
    for (let i = 0; i < count; i += 1) {
      const tx = toX + (Math.random() - 0.5) * 2.2;
      const tz = toZ + (Math.random() - 0.5) * 2.2;
      const ty = this.heightmap.heightAt(tx, tz) + 0.2;
      const dx = tx - fromX;
      const dz = tz - fromZ;
      const t = 0.28 + Math.random() * 0.08;
      this.soft.emit({
        x: fromX + (Math.random() - 0.5) * 0.15,
        y: fromY,
        z: fromZ + (Math.random() - 0.5) * 0.15,
        vx: dx / t + (Math.random() - 0.5) * 1.1,
        vy: (ty - fromY) / t + 1.1,
        vz: dz / t + (Math.random() - 0.5) * 1.1,
        life: 0.48 + Math.random() * 0.22,
        size0: 0.16,
        size1: 0.34,
        color0: [0.62, 0.84, 0.95],
        color1: [0.82, 0.94, 1],
        gravity: 4.5,
        drag: 0.5,
        alpha: 0.58,
      });
    }
  }

  burstWaterDrop(x: number, z: number, radius = 3.2): void {
    const ground = this.heightmap.heightAt(x, z);
    for (let i = 0; i < 80; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * radius;
      const px = x + Math.cos(angle) * distance;
      const pz = z + Math.sin(angle) * distance;
      this.soft.emit({
        x: px + (Math.random() - 0.5) * 0.5,
        y: ground + 6 + Math.random() * 5,
        z: pz + (Math.random() - 0.5) * 0.5,
        vx: (Math.random() - 0.5) * 2.4,
        vy: -1.5 - Math.random() * 2.5,
        vz: (Math.random() - 0.5) * 2.4,
        life: 1.0 + Math.random() * 0.5,
        size0: 0.3,
        size1: 0.75,
        color0: [0.55, 0.8, 0.95],
        color1: [0.82, 0.94, 1],
        gravity: 4,
        drag: 0.2,
        alpha: 0.65,
      });
    }
  }

  burstRetardant(ax: number, az: number, bx: number, bz: number): void {
    const distance = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(8, Math.floor(distance * 1.8));
    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1);
      const x = ax + (bx - ax) * t + (Math.random() - 0.5) * 1.2;
      const z = az + (bz - az) * t + (Math.random() - 0.5) * 1.2;
      const ground = this.heightmap.heightAt(x, z);
      this.soft.emit({
        x,
        y: ground + 4 + Math.random() * 4,
        z,
        vx: (Math.random() - 0.5) * 1.1,
        vy: -2.2 - Math.random() * 2,
        vz: (Math.random() - 0.5) * 1.1,
        life: 1.1 + Math.random() * 0.8,
        size0: 0.35,
        size1: 1.1,
        color0: [0.86, 0.38, 0.22],
        color1: [0.95, 0.62, 0.36],
        gravity: 3,
        drag: 0.3,
        alpha: 0.55,
      });
    }
  }

  burstSteam(x: number, z: number): void {
    const ground = this.heightmap.heightAt(x, z);
    for (let i = 0; i < 16; i += 1) {
      this.soft.emit({
        x: x + (Math.random() - 0.5) * 2,
        y: ground + 0.3 + Math.random() * 1.2,
        z: z + (Math.random() - 0.5) * 2,
        vx: (Math.random() - 0.5) * 1.1,
        vy: 1.2 + Math.random() * 1.3,
        vz: (Math.random() - 0.5) * 1.1,
        life: 0.9 + Math.random() * 0.8,
        size0: 0.28,
        size1: 1.4,
        color0: [0.9, 0.9, 0.88],
        color1: [0.72, 0.76, 0.72],
        gravity: -0.15,
        drag: 0.7,
        alpha: 0.42,
      });
    }
  }

  burstDust(x: number, z: number): void {
    const ground = this.heightmap.heightAt(x, z);
    for (let i = 0; i < 3; i += 1) {
      this.soft.emit({
        x: x + (Math.random() - 0.5) * 0.8,
        y: ground + 0.1 + Math.random() * 0.4,
        z: z + (Math.random() - 0.5) * 0.8,
        vx: (Math.random() - 0.5) * 1.4,
        vy: 0.7 + Math.random() * 0.8,
        vz: (Math.random() - 0.5) * 1.4,
        life: 0.7 + Math.random() * 0.5,
        size0: 0.25,
        size1: 1.3,
        color0: [0.62, 0.52, 0.35],
        color1: [0.55, 0.47, 0.33],
        gravity: -0.1,
        drag: 1.2,
        alpha: 0.28,
      });
    }
  }

  private emitWildfire(fire: Wildfire, dt: number, windX: number, windZ: number): void {
    for (let tz = 0; tz < GRID_SIZE; tz += 1) {
      for (let tx = 0; tx < GRID_SIZE; tx += 1) {
        const index = tileIndex(tx, tz);
        const state = fire.state[index];
        if (state !== FireState.Burning && state !== FireState.Smoldering && state !== FireState.Igniting) continue;
        const heat = fire.heat[index] ?? 0;
        const wx = (tx + 0.5) * TILE_SIZE;
        const wz = (tz + 0.5) * TILE_SIZE;
        const ground = this.heightmap.heightAt(wx, wz);
        const fuel = fire.fuel[index] ?? 0;
        const isBurning = state === FireState.Burning;
        const isSmoldering = state === FireState.Smoldering;
        if (isBurning) {
          const flameRate = 1.05 + heat * 1.35;
          if (Math.random() < flameRate * dt) {
            const fs = 1.1 + heat * 1.5 + (fuel === 2 ? 0.35 : 0);
            this.hot.emit({
              x: wx + (Math.random() - 0.5) * 1.6,
              y: ground + 0.25 + Math.random() * 0.7,
              z: wz + (Math.random() - 0.5) * 1.6,
              vx: (Math.random() - 0.5) * 0.55,
              vy: 1.6 + Math.random() * 2.1,
              vz: (Math.random() - 0.5) * 0.55,
              life: 0.55 + Math.random() * 0.65,
              size0: fs,
              size1: 0.22,
              color0: [1, 0.5 + heat * 0.18, 0.1],
              color1: [0.82, 0.16, 0.02],
              gravity: -1.4,
              drag: 0.6,
              alpha: 0.88,
            });
          }
          if (Math.random() < (0.65 + heat * 1.1) * dt) {
            this.soft.emit({
              x: wx + (Math.random() - 0.5) * 1.3,
              y: ground + 0.8 + Math.random() * 1.2,
              z: wz + (Math.random() - 0.5) * 1.3,
              vx: windX * 0.2 + (Math.random() - 0.5) * 0.35,
              vy: 1.0 + Math.random() * 1.1,
              vz: windZ * 0.2 + (Math.random() - 0.5) * 0.35,
              life: 2.6 + Math.random() * 2.6,
              size0: 1.35 + Math.random() * 1.5,
              size1: 4.2 + Math.random() * 3.2,
              color0: [0.2, 0.17, 0.14],
              color1: [0.52, 0.5, 0.46],
              gravity: -0.12,
              drag: 0.12,
              alpha: 0.5,
            });
          }
          if (Math.random() < 0.18 * dt * (0.5 + heat)) {
            this.hot.emit({
              x: wx + (Math.random() - 0.5) * 1.2,
              y: ground + 1.3 + Math.random() * 2.2,
              z: wz + (Math.random() - 0.5) * 1.2,
              vx: windX * 0.55 + (Math.random() - 0.5) * 1.2,
              vy: 1.4 + Math.random() * 1.8,
              vz: windZ * 0.55 + (Math.random() - 0.5) * 1.2,
              life: 1.5 + Math.random() * 1.5,
              size0: 0.1,
              size1: 0.05,
              color0: [1, 0.58, 0.14],
              color1: [0.9, 0.18, 0.02],
              gravity: -0.05,
              drag: 0.08,
              alpha: 0.9,
            });
          }
        } else if (isSmoldering || state === FireState.Igniting) {
          if (Math.random() < (isSmoldering ? 0.33 : 0.2) * dt) {
            this.soft.emit({
              x: wx + (Math.random() - 0.5) * 1.4,
              y: ground + 0.35 + Math.random() * 0.8,
              z: wz + (Math.random() - 0.5) * 1.4,
              vx: windX * 0.12,
              vy: 0.55 + Math.random() * 0.7,
              vz: windZ * 0.12,
              life: 1.7 + Math.random() * 1.8,
              size0: 0.45 + Math.random() * 0.5,
              size1: 2.0 + Math.random() * 1.8,
              color0: [0.4, 0.38, 0.35],
              color1: [0.66, 0.64, 0.6],
              gravity: -0.06,
              drag: 0.3,
              alpha: 0.34,
            });
          }
        }
      }
    }
  }
}
