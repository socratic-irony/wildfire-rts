import { Group, Object3D, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';

export type HeightSampler = (x: number, z: number) => number;

export class RTSCameraController {
  private dom: HTMLElement;
  private camera: PerspectiveCamera;
  private root: Group;
  private yaw: Group;
  private pitch: Group;
  private terrain: Object3D;
  private sample: HeightSampler;

  private mouse = new Vector2();
  private pivot = new Vector3();
  private distance = 30;
  private minDistance = 6;
  private maxDistance = 200;
  private minPitch = 0.25; // radians ~14°
  private maxPitch = 1.3;  // radians ~74°
  private speed = 20;      // units/sec
  private raycaster = new Raycaster();
  private leftDown = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    dom: HTMLElement,
    camera: PerspectiveCamera,
    root: Group,
    yaw: Group,
    pitch: Group,
    terrain: Object3D,
    sample: HeightSampler
  ) {
    this.dom = dom;
    this.camera = camera;
    this.root = root;
    this.yaw = yaw;
    this.pitch = pitch;
    this.terrain = terrain;
    this.sample = sample;

    this.distance = 40;
    this.pitch.rotation.x = 0.9;

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('wheel', this.onWheel, { passive: false });

    // Initialize pivot at terrain center
    this.pivot.set(
      0,
      this.sample(0, 0),
      0
    );
    this.root.position.copy(this.pivot);
  }

  private getMouseNDC(ev: PointerEvent | WheelEvent) {
    const rect = this.dom.getBoundingClientRect();
    this.mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 0) this.leftDown = true; // left
    this.lastX = e.clientX; this.lastY = e.clientY;
  };

  private onPointerUp = (_e: PointerEvent) => {
    this.leftDown = false;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.leftDown) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX; this.lastY = e.clientY;
    const rotSpeed = 0.005;
    this.yaw.rotation.y -= dx * rotSpeed;
    this.pitch.rotation.x = Math.min(this.maxPitch, Math.max(this.minPitch, this.pitch.rotation.x + dy * rotSpeed));
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.getMouseNDC(e);
    const hit = this.raycastToTerrain();
    if (hit) {
      this.pivot.copy(hit);
      this.root.position.copy(this.pivot);
    }
    this.distance *= e.deltaY < 0 ? 0.9 : 1.1;
    this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance));
  };

  private raycastToTerrain(): Vector3 | null {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain, true);
    return hits.length > 0 ? hits[0].point : null;
  }

  update(dt: number, move: {left:boolean;right:boolean;up:boolean;down:boolean; yawL?:boolean; yawR?:boolean; tiltU?:boolean; tiltD?:boolean}) {
    // Pan along ground plane
    const dir = new Vector3();
    if (move.left) dir.x -= 1;
    if (move.right) dir.x += 1;
    if (move.up) dir.z -= 1;
    if (move.down) dir.z += 1;
    if (dir.lengthSq() > 0) {
      dir.normalize().multiplyScalar(this.speed * dt);
      // move in yaw's local space (XZ)
      this.yaw.updateWorldMatrix(true, false);
      const forward = new Vector3(0, 0, -1).applyQuaternion(this.yaw.quaternion);
      const right = new Vector3(1, 0, 0).applyQuaternion(this.yaw.quaternion);
      const delta = right.multiplyScalar(dir.x).add(forward.multiplyScalar(dir.z));
      this.root.position.add(delta);
      this.pivot.copy(this.root.position);
    }

    // Keyboard yaw/tilt
    if (move.yawL) this.yaw.rotation.y += 1.8 * dt;
    if (move.yawR) this.yaw.rotation.y -= 1.8 * dt;
    if (move.tiltU) this.pitch.rotation.x = Math.max(this.minPitch, this.pitch.rotation.x - 1.2 * dt);
    if (move.tiltD) this.pitch.rotation.x = Math.min(this.maxPitch, this.pitch.rotation.x + 1.2 * dt);

    // Position camera at pivot with distance along -Z of pitch (local)
    const camLocal = new Vector3(0, 0, this.distance);
    this.camera.position.copy(camLocal);
    this.camera.updateMatrixWorld();

    // Keep rig and camera above terrain (simple collision)
    const clearance = 3;
    const baseY = this.sample(this.root.position.x, this.root.position.z) + clearance;
    if (this.root.position.y < baseY) this.root.position.y = baseY;

    const camWorld = this.camera.getWorldPosition(new Vector3());
    const camClear = 2.0;
    const camGround = this.sample(camWorld.x, camWorld.z) + camClear;
    const camDelta = camGround - camWorld.y;
    if (camDelta > 0) {
      this.root.position.y += camDelta;
    }
  }
}
