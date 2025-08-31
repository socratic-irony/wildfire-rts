import { Object3D, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';

export type HeightSampler = (x: number, z: number) => number;

export class RTSOrbitCamera {
  private dom: HTMLElement;
  private camera: PerspectiveCamera;
  private terrain: Object3D;
  private sample: HeightSampler;
  private ray = new Raycaster();
  private mouse = new Vector2();

  // Orbit state
  private yaw = Math.PI * 0.25; // around Y
  private pitch = 0.9;          // 0..~1.3 (radians from horizon)
  // Horizontal radius (XZ) from pivot to camera; zoom changes this, not altitude
  private distance = 40; // interpreted as horizontal radius (not full 3D distance)
  private minDist = 2;
  private maxDist = 220;
  private minPitch = 0.3; // allow lower grazing angles (~17°)
  private maxPitch = 1.1; // slightly higher tilt (~63°)

  private panSpeed = 25; // units/sec (constant; not height-sensitive)
  private rotSpeed = 0.005;
  private zoomFactor = 0.015; // gentler zoom per wheel notch

  // Altitude control — fixed world Y (does not change with scroll)
  private altitude = 40; // fixed camera world Y
  private defaultYaw = Math.PI * 0.25;
  private defaultPitch = 0.9;
  private defaultAlt = 40;
  private defaultDist = 40;

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
    // Keep pivot XZ; Y is derived from fixed altitude, pitch, and horizontal radius
    this.pivot.set(x, this.altitude - Math.tan(this.pitch) * this.distance, z);
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
    // Rotate yaw + limited pitch; still feels like terrain spin
    this.yaw -= dx * this.rotSpeed;
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch + dy * this.rotSpeed));
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Zoom by changing horizontal radius only; keep altitude constant
    const factor = e.deltaY < 0 ? (1 - this.zoomFactor) : (1 + this.zoomFactor);
    this.distance = Math.max(this.minDist, Math.min(this.maxDist, this.distance * factor));
    // Re-derive pivot.y from fixed altitude, current pitch and radius
    this.pivot.y = this.altitude - Math.tan(this.pitch) * this.distance;
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      // Reset to default angle and altitude
      this.yaw = this.defaultYaw;
      this.pitch = this.defaultPitch;
      this.altitude = this.defaultAlt;
      this.distance = this.defaultDist;
      this.pivot.y = this.altitude - Math.tan(this.pitch) * this.distance;
      e.preventDefault();
    }
    // Adjust fixed camera altitude
    if (e.code === 'BracketLeft') { // [
      this.altitude = Math.max(2, this.altitude - 4);
      this.pivot.y = this.altitude - Math.tan(this.pitch) * this.distance;
      e.preventDefault();
    } else if (e.code === 'BracketRight') { // ]
      this.altitude = Math.min(400, this.altitude + 4);
      this.pivot.y = this.altitude - Math.tan(this.pitch) * this.distance;
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
    // Pan pivot along ground plane using yaw basis (Y unchanged)
    const f = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const r = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const v = new Vector3();
    if (move.left) v.addScaledVector(r, -1);
    if (move.right) v.addScaledVector(r, 1);
    if (move.up) v.addScaledVector(f, -1);
    if (move.down) v.addScaledVector(f, 1);
    if (v.lengthSq() > 0) {
      v.normalize().multiplyScalar(this.panSpeed * dt);
      this.pivot.add(v);
      // Do not follow terrain; derive Y from fixed altitude + current pitch/radius
      this.pivot.y = this.altitude - Math.tan(this.pitch) * this.distance;
    }

    // Camera position from horizontal radius around pivot; keep camera Y fixed
    const tanP = Math.tan(this.pitch);
    // Ensure pivot.y stays finite as pitch approaches 90°
    const safeTan = Math.min(10, tanP);
    this.pivot.y = this.altitude - safeTan * this.distance;
    const cp = new Vector3(
      Math.sin(this.yaw) * this.distance,
      safeTan * this.distance,
      Math.cos(this.yaw) * this.distance
    );
    this.camera.position.copy(this.pivot).add(cp);
    this.camera.position.y = this.altitude;
    this.camera.lookAt(this.pivot);
  }
}
