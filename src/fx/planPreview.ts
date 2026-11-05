import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial } from 'three';
import { Heightmap } from '../world/heightmap';
import { TILE_SIZE } from '../world/constants';

const MAX_TILES = 400;
const LIFT = 0.14;

/**
 * Translucent tiles that hug the terrain, showing exactly which tiles a
 * planned road or dozer line will occupy. Geometry is rebuilt only when the
 * planned path changes.
 */
export class PlanPreview {
  readonly mesh: Mesh;
  private readonly positions = new Float32Array(MAX_TILES * 6 * 3);
  private readonly attribute: BufferAttribute;
  private readonly material: MeshBasicMaterial;

  constructor(private readonly heightmap: Heightmap) {
    const geometry = new BufferGeometry();
    this.attribute = new BufferAttribute(this.positions, 3);
    this.attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.attribute);
    geometry.setDrawRange(0, 0);
    this.material = new MeshBasicMaterial({
      color: 0xffc95c,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'plan-preview';
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  show(path: ReadonlyArray<{ x: number; z: number }>, color: number, affordable = true): void {
    const count = Math.min(MAX_TILES, path.length);
    const p = this.positions;
    const h = this.heightmap;
    let o = 0;
    for (let i = 0; i < count; i += 1) {
      const { x, z } = path[i]!;
      const x0 = x * TILE_SIZE;
      const z0 = z * TILE_SIZE;
      const x1 = x0 + TILE_SIZE;
      const z1 = z0 + TILE_SIZE;
      const h00 = h.vertexHeight(x, z) + LIFT;
      const h10 = h.vertexHeight(x + 1, z) + LIFT;
      const h01 = h.vertexHeight(x, z + 1) + LIFT;
      const h11 = h.vertexHeight(x + 1, z + 1) + LIFT;
      // Same diagonal split as the terrain mesh, so the overlay sits flush on slopes.
      p.set([x0, h00, z0, x1, h10, z0, x0, h01, z1, x1, h11, z1, x0, h01, z1, x1, h10, z0], o);
      o += 18;
    }
    this.attribute.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, count * 6);
    this.material.color.setHex(affordable ? color : 0xff5a46);
    this.mesh.visible = count > 0;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
