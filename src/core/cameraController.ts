import { PerspectiveCamera, Vector3 } from 'three';

export type CameraMoveInput = {
  left?: boolean;
  right?: boolean;
  up?: boolean;
  down?: boolean;
  yawL?: boolean;
  yawR?: boolean;
  tiltU?: boolean;
  tiltD?: boolean;
};

export type GroundProjector = (ndcX: number, ndcY: number) => { x: number; z: number } | null;
export type HeightSampler = (x: number, z: number) => number;
export type CameraBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

type CameraControllerOpts = {
  bounds?: CameraBounds;
  sampleHeight?: HeightSampler;
  projectGround?: GroundProjector;
  initialTarget?: { x: number; z: number };
  initialDist?: number;
  initialYaw?: number;
  initialPitch?: number;
  minPitch?: number;
  maxPitch?: number;
  minDist?: number;
  maxDist?: number;
  panSpeed?: number;
  refDist?: number;
  damping?: number;
};

const ZOOM_PER_NOTCH = 0.9;
const ROT_SPEED = 0.005; // rad per pixel for drag-rotate
const KEY_YAW_RATE = 2.0; // rad/s for Q/E
const KEY_TILT_RATE = 1.5; // rad/s for R/F
const MIN_CLEARANCE = 2; // world units of enforced camera height above sampled terrain
const DEFAULT_YAW = Math.PI * 0.25;
const DEFAULT_PITCH = 0.9;
const DEFAULT_DIST = 40;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Module-scope scratch to keep update()/focus() allocation-free.
const _camTarget = new Vector3();

type DragMode = 'none' | 'rotate' | 'pan';

export class CameraController {
  readonly camera: PerspectiveCamera;

  private sampleHeight?: HeightSampler;
  private projectGround?: GroundProjector;
  private inputLockCheck: (() => boolean) | null = null;
  private followFn: (() => { x: number; z: number }) | null = null;
  private bounds: CameraBounds | null;

  // Damped current state and direct-intent goals.
  private yaw: number;
  private pitch: number;
  private dist: number;
  private yawGoal: number;
  private pitchGoal: number;
  private distGoal: number;
  private tx: number;
  private tz: number;
  private txGoal: number;
  private tzGoal: number;

  private minPitch: number;
  private maxPitch: number;
  private minDist: number;
  private maxDist: number;
  private panSpeed: number;
  private refDist: number;
  private lambda: number;

  // DOM adapter state (unused when constructed with dom === null).
  private dom: HTMLElement | null;
  private dragMode: DragMode = 'none';
  private lastX = 0;
  private lastY = 0;
  private activePointers = new Map<number, { x: number; y: number }>();
  private pinchPrevSpan = 0;
  private pinchPrevMidX = 0;
  private pinchPrevMidY = 0;

  constructor(dom: HTMLElement | null, camera: PerspectiveCamera, opts: CameraControllerOpts = {}) {
    this.dom = dom;
    this.camera = camera;
    this.sampleHeight = opts.sampleHeight;
    this.projectGround = opts.projectGround;
    this.bounds = opts.bounds ?? null;

    this.minPitch = opts.minPitch ?? 0.15;
    this.maxPitch = opts.maxPitch ?? 1.45;
    this.minDist = opts.minDist ?? 4;
    this.maxDist = opts.maxDist ?? 320;
    this.panSpeed = opts.panSpeed ?? 25;
    this.refDist = opts.refDist ?? 40;
    this.lambda = opts.damping ?? 10;

    this.yawGoal = opts.initialYaw ?? DEFAULT_YAW;
    this.pitchGoal = clamp(opts.initialPitch ?? DEFAULT_PITCH, this.minPitch, this.maxPitch);
    this.distGoal = clamp(opts.initialDist ?? DEFAULT_DIST, this.minDist, this.maxDist);
    this.txGoal = opts.initialTarget?.x ?? 0;
    this.tzGoal = opts.initialTarget?.z ?? 0;
    this.yaw = this.yawGoal;
    this.pitch = this.pitchGoal;
    this.dist = this.distGoal;
    this.tx = this.txGoal;
    this.tz = this.tzGoal;

    if (dom) {
      dom.addEventListener('pointerdown', this.onPointerDown);
      dom.addEventListener('pointermove', this.onPointerMove);
      dom.addEventListener('wheel', this.onWheel, { passive: false });
      dom.addEventListener('contextmenu', this.onContextMenu);
      window.addEventListener('pointerup', this.onPointerUp);
      window.addEventListener('pointercancel', this.onPointerUp);
      window.addEventListener('keydown', this.onKeyDown);
    }
  }

  update(dt: number, move?: CameraMoveInput): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;

    if (move) {
      const speed = this.panSpeed * clamp(this.dist / this.refDist, 0.25, 4);
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      let ix = 0;
      let iz = 0;
      if (move.up) {
        ix -= fx;
        iz -= fz;
      }
      if (move.down) {
        ix += fx;
        iz += fz;
      }
      if (move.left) {
        ix -= rx;
        iz -= rz;
      }
      if (move.right) {
        ix += rx;
        iz += rz;
      }
      this.txGoal += ix * speed * step;
      this.tzGoal += iz * speed * step;
      if (move.yawR) this.yawGoal += KEY_YAW_RATE * step;
      if (move.yawL) this.yawGoal -= KEY_YAW_RATE * step;
      if (move.tiltU) this.pitchGoal = clamp(this.pitchGoal + KEY_TILT_RATE * step, this.minPitch, this.maxPitch);
      if (move.tiltD) this.pitchGoal = clamp(this.pitchGoal - KEY_TILT_RATE * step, this.minPitch, this.maxPitch);
    }

    if (this.followFn) {
      const p = this.followFn();
      if (p) {
        this.txGoal = p.x;
        this.tzGoal = p.z;
        this.tx = p.x;
        this.tz = p.z;
      }
    } else if (this.bounds) {
      this.txGoal = clamp(this.txGoal, this.bounds.minX, this.bounds.maxX);
      this.tzGoal = clamp(this.tzGoal, this.bounds.minZ, this.bounds.maxZ);
    }

    const f = 1 - Math.exp(-this.lambda * step);
    this.yaw += (this.yawGoal - this.yaw) * f;
    this.pitch += (this.pitchGoal - this.pitch) * f;
    this.dist += (this.distGoal - this.dist) * f;
    if (!this.followFn) {
      this.tx += (this.txGoal - this.tx) * f;
      this.tz += (this.tzGoal - this.tz) * f;
      if (this.bounds) {
        this.tx = clamp(this.tx, this.bounds.minX, this.bounds.maxX);
        this.tz = clamp(this.tz, this.bounds.minZ, this.bounds.maxZ);
      }
    }

    this.applyToCamera();
  }

  rotate(dxPixels: number, dyPixels: number): void {
    if (this.isLocked()) return;
    this.yawGoal -= dxPixels * ROT_SPEED;
    this.pitchGoal = clamp(this.pitchGoal + dyPixels * ROT_SPEED, this.minPitch, this.maxPitch);
  }

  panPixels(dxPixels: number, dyPixels: number): void {
    if (this.isLocked()) return;
    const s = (this.panSpeed * clamp(this.dist / this.refDist, 0.25, 4)) / this.refDist;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    this.txGoal += (-dxPixels * rx + dyPixels * fx) * s;
    this.tzGoal += (-dxPixels * rz + dyPixels * fz) * s;
  }

  zoom(notches: number, cursorNdcX?: number, cursorNdcY?: number): void {
    if (this.isLocked()) return;
    const oldGoal = this.distGoal;
    this.distGoal = clamp(oldGoal * Math.pow(ZOOM_PER_NOTCH, notches), this.minDist, this.maxDist);
    if (cursorNdcX !== undefined && cursorNdcY !== undefined && this.projectGround) {
      const p = this.projectGround(cursorNdcX, cursorNdcY);
      if (p) {
        const t = clamp(1 - this.distGoal / oldGoal, -1, 1);
        this.txGoal += (p.x - this.txGoal) * t;
        this.tzGoal += (p.z - this.tzGoal) * t;
      }
    }
  }

  setBounds(b: CameraBounds | null): void {
    this.bounds = b;
  }

  focus(x: number, z: number, distance?: number, altitude?: number): void {
    this.tx = this.txGoal = x;
    this.tz = this.tzGoal = z;
    let d = this.dist;
    if (distance !== undefined) {
      d = clamp(distance, this.minDist, this.maxDist);
      this.dist = this.distGoal = d;
    }
    if (altitude !== undefined) {
      const gy = this.sampleHeight ? this.sampleHeight(x, z) : 0;
      this.pitch = this.pitchGoal = clamp(Math.atan2(altitude - gy, Math.max(d, 1e-6)), this.minPitch, this.maxPitch);
    }
    this.applyToCamera();
  }

  follow(getPos: (() => { x: number; z: number }) | null): void {
    this.followFn = getPos;
  }

  setInputLockCheck(fn: (() => boolean) | null): void {
    this.inputLockCheck = fn;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  getState(): { x: number; z: number; yaw: number; pitch: number; dist: number } {
    return { x: this.tx, z: this.tz, yaw: this.yaw, pitch: this.pitch, dist: this.dist };
  }

  dispose(): void {
    if (this.dom) {
      this.dom.removeEventListener('pointerdown', this.onPointerDown);
      this.dom.removeEventListener('pointermove', this.onPointerMove);
      this.dom.removeEventListener('wheel', this.onWheel);
      this.dom.removeEventListener('contextmenu', this.onContextMenu);
    }
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    this.activePointers.clear();
    this.dragMode = 'none';
  }

  private isLocked(): boolean {
    return this.inputLockCheck ? this.inputLockCheck() : false;
  }

  private applyToCamera(): void {
    const groundY = this.sampleHeight ? this.sampleHeight(this.tx, this.tz) : 0;
    const hR = this.dist * Math.cos(this.pitch);
    const camH = this.dist * Math.sin(this.pitch);
    const px = this.tx + Math.sin(this.yaw) * hR;
    const pz = this.tz + Math.cos(this.yaw) * hR;
    let py = groundY + camH;
    if (this.sampleHeight) {
      const minY = this.sampleHeight(px, pz) + MIN_CLEARANCE;
      if (py < minY) py = minY;
    }
    this.camera.position.set(px, py, pz);
    _camTarget.set(this.tx, groundY, this.tz);
    this.camera.lookAt(_camTarget);
  }

  private onPointerDown = (e: PointerEvent) => {
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.activePointers.size >= 2) {
      this.dragMode = 'none';
      this.beginPinch();
      return;
    }
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if (this.isLocked()) return;
    this.dragMode = e.button === 0 ? 'rotate' : 'pan';
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent) => {
    const tracked = this.activePointers.get(e.pointerId);
    if (!tracked) return;
    tracked.x = e.clientX;
    tracked.y = e.clientY;
    if (this.activePointers.size >= 2) {
      this.updatePinch();
      return;
    }
    if (this.dragMode === 'none' || this.isLocked()) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.dragMode === 'rotate') this.rotate(dx, dy);
    else this.panPixels(dx, dy);
  };

  private onPointerUp = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2 && e.pointerId !== undefined) {
      // Leaving pinch returns to idle; a remaining single finger must re-press to drag.
      if (this.activePointers.size <= 1) this.dragMode = 'none';
    }
    if (this.activePointers.size === 0) this.dragMode = 'none';
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.isLocked() || !this.dom) return;
    const rect = this.dom.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.zoom(-e.deltaY / 100, ndcX, ndcY);
  };

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || this.isLocked()) return;
    e.preventDefault();
    this.yawGoal = DEFAULT_YAW;
    this.pitchGoal = DEFAULT_PITCH;
    this.distGoal = DEFAULT_DIST;
  };

  private beginPinch(): void {
    const pts = Array.from(this.activePointers.values());
    if (pts.length < 2) return;
    this.pinchPrevMidX = (pts[0].x + pts[1].x) / 2;
    this.pinchPrevMidY = (pts[0].y + pts[1].y) / 2;
    this.pinchPrevSpan = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private updatePinch(): void {
    const pts = Array.from(this.activePointers.values());
    if (pts.length < 2 || this.pinchPrevSpan <= 0) {
      this.beginPinch();
      return;
    }
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    const span = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (span > 0) {
      const ratio = this.pinchPrevSpan / span;
      if (ratio > 0 && ratio !== 1) this.zoom(Math.log(ratio) / Math.log(ZOOM_PER_NOTCH));
    }
    this.panPixels(midX - this.pinchPrevMidX, midY - this.pinchPrevMidY);
    this.pinchPrevMidX = midX;
    this.pinchPrevMidY = midY;
    this.pinchPrevSpan = span;
  }
}
