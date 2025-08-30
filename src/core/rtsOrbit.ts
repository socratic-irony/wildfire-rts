import { Object3D, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';

export type HeightSampler = (x: number, z: number) => number;

export class RTSOrbitCamera {
  private dom: HTMLElement;
  private camera: PerspectiveCamera;
  private terrain: Object3D;
  private sample: HeightSampler;
  private ray = new Raycaster();
  private mouse = new Vector2();

  // Spherical state
  private yaw = Math.PI * 0.25; // around Y
  private pitch = 0.9;          // 0..~1.3 (radians from horizon)
  private distance = 40; // derived from altitude + pitch; kept for smoothing
  private minDist = 6;
  private maxDist = 180;
  private minPitch = 0.2;
  private maxPitch = 1.3;

  private panSpeed = 25; // units/sec at distance ~40
  private rotSpeed = 0.005;
  private zoomFactor = 0.025; // multiplicative zoom step per wheel notch (lower = less sensitive)

  // Altitude control (absolute world Y, not terrain-relative)
  private altitude = 40; // current camera world Y
  private minAlt = 12;
  private maxAlt = 120;
  private defaultYaw = Math.PI * 0.25;
  private defaultPitch = 0.9;
  private defaultAlt = 40;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  public pivot = new Vector3();

  constructor(dom: HTMLElement, camera: PerspectiveCamera, terrain: Object3D, sample: HeightSampler, initialPivot: Vector3) {
    this.dom = dom;
    this.camera = camera;
    this.terrain = terrain;
    this.sample = sample;
    this.setPivot(initialPivot.x, initialPivot.z);

    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
  }

  private setPivot(x: number, z: number) {
    this.pivot.set(x, this.sample(x, z), z);
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };
  private onUp = (_e: PointerEvent) => { this.dragging = false; };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX; this.lastY = e.clientY;
    this.yaw -= dx * this.rotSpeed;
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch + dy * this.rotSpeed));
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.getMouseNDC(e);
    const hit = this.raycastToTerrain();
    if (hit) this.setPivot(hit.x, hit.z);
    // Zoom via altitude within a constrained band (less sensitive)
    const factor = e.deltaY < 0 ? (1 - this.zoomFactor) : (1 + this.zoomFactor);
    this.altitude *= factor;
    this.altitude = Math.max(this.minAlt, Math.min(this.maxAlt, this.altitude));
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      // Reset to default angle and altitude
      this.yaw = this.defaultYaw;
      this.pitch = this.defaultPitch;
      this.altitude = Math.max(this.minAlt, Math.min(this.maxAlt, this.defaultAlt));
      e.preventDefault();
    }
  };

  private getMouseNDC(ev: PointerEvent | WheelEvent) {
    const rect = this.dom.getBoundingClientRect();
    this.mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }
  private raycastToTerrain(): Vector3 | null {
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObject(this.terrain, true);
    return hits.length ? hits[0].point : null;
  }

  update(dt: number, move: { left:boolean; right:boolean; up:boolean; down:boolean }) {
    // Pan pivot along ground plane using yaw basis
    const f = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const r = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const v = new Vector3();
    if (move.left) v.addScaledVector(r, -1);
    if (move.right) v.addScaledVector(r, 1);
    if (move.up) v.addScaledVector(f, -1);
    if (move.down) v.addScaledVector(f, 1);
    if (v.lengthSq() > 0) {
      const speed = this.panSpeed * (0.4 + this.altitude / 60);
      v.normalize().multiplyScalar(speed * dt);
      this.pivot.add(v);
      // Keep pivot anchored to ground for lookAt, but camera altitude remains absolute
      this.pivot.y = this.sample(this.pivot.x, this.pivot.z);
    }

    // Camera position from spherical around pivot
    // Derive distance from altitude to maintain constant world Y regardless of terrain height
    const minClear = 1.0;
    const groundY = this.pivot.y;
    if (this.altitude < groundY + minClear) this.altitude = groundY + minClear;
    const sinP = Math.sin(this.pitch);
    const safeSin = Math.max(0.1, sinP);
    this.distance = (this.altitude - groundY) / safeSin;
    this.distance = Math.min(this.maxDist, Math.max(this.minDist, this.distance));
    const cp = new Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance
    );
    this.camera.position.copy(this.pivot).add(cp);
    // Force absolute altitude; small correction if rounding imprecision
    this.camera.position.y = this.altitude;
    this.camera.lookAt(this.pivot);
  }
}
