import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  RingGeometry,
} from 'three';
import { Heightmap } from '../world/heightmap';
import { Building } from '../world/buildings';
import { TILE_SIZE } from '../world/constants';

interface Bolt {
  mesh: Mesh;
  life: number;
}

/**
 * World-space feedback that is not simulation: lightning bolts and their
 * flash, pulsing rings under threatened structures, and arrows showing which
 * way each fire's head is running. Also owns the camera-shake amount.
 */
export class Effects {
  readonly group = new Group();
  private readonly flashLight = new PointLight(0xdfe8ff, 0, 140, 1.2);
  private readonly bolts: Bolt[] = [];
  private readonly boltMaterial = new MeshBasicMaterial({
    color: 0xe8efff,
    transparent: true,
    opacity: 1,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  private readonly ringGeometry = new RingGeometry(0.86, 1, 40);
  private readonly ringMaterial = new MeshBasicMaterial({
    color: 0xff4b33,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: DoubleSide,
  });
  private readonly rings = new Map<number, Mesh>();
  private readonly arrowGeometry = createChevron();
  private readonly arrowMaterial = new MeshBasicMaterial({
    color: 0xff6a24,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: DoubleSide,
  });
  private readonly arrows: Mesh[] = [];
  private time = 0;
  private shakeAmount = 0;
  private flashTimer = 0;

  constructor(private readonly heightmap: Heightmap) {
    this.group.name = 'effects';
    this.flashLight.position.set(96, 60, 96);
    this.group.add(this.flashLight);
  }

  /** Current camera shake offset magnitude (world units). */
  get shake(): number {
    return this.shakeAmount;
  }

  addShake(amount: number): void {
    this.shakeAmount = Math.min(2.4, this.shakeAmount + amount);
  }

  lightning(x: number, z: number): void {
    const ground = this.heightmap.heightAt(x, z);
    const mesh = new Mesh(createBoltGeometry(x, ground, z), this.boltMaterial.clone());
    mesh.renderOrder = 30;
    this.group.add(mesh);
    this.bolts.push({ mesh, life: 0.55 });
    this.flashLight.position.set(x, ground + 24, z);
    this.flashTimer = 0.5;
    this.addShake(1.4);
  }

  update(dt: number): void {
    this.time += dt;
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 3.2);
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    const flicker = this.flashTimer > 0 ? (Math.sin(this.time * 70) > -0.2 ? 1 : 0.25) : 0;
    this.flashLight.intensity = this.flashTimer * 2 * 900 * flicker;
    for (let i = this.bolts.length - 1; i >= 0; i -= 1) {
      const bolt = this.bolts[i]!;
      bolt.life -= dt;
      const material = bolt.mesh.material as MeshBasicMaterial;
      material.opacity = Math.max(0, bolt.life / 0.55) * (Math.sin(this.time * 60) > -0.4 ? 1 : 0.35);
      if (bolt.life <= 0) {
        this.group.remove(bolt.mesh);
        bolt.mesh.geometry.dispose();
        material.dispose();
        this.bolts.splice(i, 1);
      }
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4.2);
    this.ringMaterial.opacity = 0.35 + pulse * 0.5;
    this.arrowMaterial.opacity = 0.6 + 0.25 * Math.sin(this.time * 3.1);
  }

  /** Show a pulsing ring under each threatened building. */
  setThreatened(buildings: ReadonlyArray<Building>, threatened: ReadonlySet<number>): void {
    for (const building of buildings) {
      let ring = this.rings.get(building.id);
      const show = threatened.has(building.id) && building.state !== 'destroyed';
      if (!show) {
        if (ring) ring.visible = false;
        continue;
      }
      if (!ring) {
        ring = new Mesh(this.ringGeometry, this.ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.renderOrder = 7;
        const radius = (Math.max(building.worldW, building.worldD) * TILE_SIZE) / 2 + 1;
        ring.scale.setScalar(radius);
        ring.position.set(building.centerX, this.heightmap.heightAt(building.centerX, building.centerZ) + 0.22, building.centerZ);
        this.rings.set(building.id, ring);
        this.group.add(ring);
      }
      ring.visible = true;
    }
  }

  /** Place one arrow per fire head, pointing downwind. */
  setHeads(heads: ReadonlyArray<{ x: number; z: number }>, windDirection: number, windSpeed: number): void {
    while (this.arrows.length < heads.length) {
      const arrow = new Mesh(this.arrowGeometry, this.arrowMaterial);
      arrow.renderOrder = 9;
      this.arrows.push(arrow);
      this.group.add(arrow);
    }
    const dx = Math.sin(windDirection);
    const dz = Math.cos(windDirection);
    const scale = 0.9 + Math.min(1, windSpeed * 0.08);
    const bob = Math.sin(this.time * 3) * 0.6;
    for (let i = 0; i < this.arrows.length; i += 1) {
      const arrow = this.arrows[i]!;
      const head = heads[i];
      if (!head) {
        arrow.visible = false;
        continue;
      }
      const x = head.x + dx * (3.2 + bob);
      const z = head.z + dz * (3.2 + bob);
      arrow.visible = true;
      arrow.position.set(x, this.heightmap.heightAt(x, z) + 0.5, z);
      arrow.rotation.set(0, windDirection, 0);
      arrow.scale.setScalar(scale);
    }
  }
}

/** Flat chevron lying on the ground, pointing along +Z before rotation. */
function createChevron(): BufferGeometry {
  const geometry = new BufferGeometry();
  // Two triangles forming a ">"-style arrowhead with a notch.
  const positions = [0, 0, 1.6, -1.2, 0, -0.6, 0, 0, 0.2, 0, 0, 1.6, 0, 0, 0.2, 1.2, 0, -0.6];
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Jagged crossed-ribbon bolt from the sky to the ground. */
function createBoltGeometry(x: number, ground: number, z: number): BufferGeometry {
  const points: Array<[number, number, number]> = [];
  const top = ground + 70;
  const segments = 14;
  let px = x + (Math.random() - 0.5) * 10;
  let pz = z + (Math.random() - 0.5) * 10;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const y = top + (ground - top) * t;
    if (i === segments) {
      px = x;
      pz = z;
    } else if (i > 0) {
      px += (x - px) * 0.25 + (Math.random() - 0.5) * 4.2;
      pz += (z - pz) * 0.25 + (Math.random() - 0.5) * 4.2;
    }
    points.push([px, y, pz]);
  }
  const positions: number[] = [];
  const width = 0.2;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, ay, az] = points[i]!;
    const [bx, by, bz] = points[i + 1]!;
    for (const [ox, oz] of [
      [width, 0],
      [0, width],
    ] as Array<[number, number]>) {
      positions.push(ax - ox, ay, az - oz, ax + ox, ay, az + oz, bx + ox, by, bz + oz);
      positions.push(ax - ox, ay, az - oz, bx + ox, by, bz + oz, bx - ox, by, bz - oz);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}
