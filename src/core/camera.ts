import { clamp, damp, dampAngle } from './math';
import { OrthographicCamera, Raycaster, Vector2, Vector3 } from 'three';

export interface HeightSampler {
  heightAt(x: number, z: number): number;
}

const MIN_VIEW = 19;
const MAX_VIEW = 150;
const MIN_PITCH = 0.52;
const MAX_PITCH = 1.3;
const CAMERA_DISTANCE = 260;

export class CameraRig {
  readonly camera: OrthographicCamera;
  target = new Vector3(96, 4, 96);
  yaw = Math.PI * 0.23;
  pitch = 0.92;
  viewSize = 66;
  private goalTarget = new Vector3(96, 4, 96);
  private goalYaw = Math.PI * 0.23;
  private goalPitch = 0.92;
  private goalView = 66;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly groundPoint = new Vector3();
  private readonly plane = new Vector3(0, 1, 0);

  private width: number;
  private height: number;

  constructor(
    width: number,
    height: number,
    private readonly sampler: HeightSampler,
  ) {
    this.width = width;
    this.height = height;
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 900);
    this.applyProjection();
    this.snap();
  }

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.applyProjection();
  }

  setAspect(aspect: number): void {
    this.camera.left = (-this.viewSize * aspect) / 2;
    this.camera.right = (this.viewSize * aspect) / 2;
    this.camera.top = this.viewSize / 2;
    this.camera.bottom = -this.viewSize / 2;
    this.camera.updateProjectionMatrix();
  }

  pan(dx: number, dz: number): void {
    this.goalTarget.x += dx;
    this.goalTarget.z += dz;
    this.clampTarget();
  }

  panByPixels(dx: number, dy: number): void {
    const scale = this.viewSize / Math.max(1, this.height);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    this.goalTarget.x -= (rightX * dx + forwardX * dy) * scale;
    this.goalTarget.z -= (rightZ * dx + forwardZ * dy) * scale;
    this.clampTarget();
  }

  rotate(delta: number): void {
    this.goalYaw += delta;
  }

  tilt(delta: number): void {
    this.goalPitch = clamp(this.goalPitch + delta, MIN_PITCH, MAX_PITCH);
  }

  zoom(factor: number, cursorNdc?: { x: number; y: number }): void {
    const previous = this.goalView;
    this.goalView = clamp(this.goalView * factor, MIN_VIEW, MAX_VIEW);
    if (cursorNdc && this.goalView < previous) {
      const hit = this.pickGround(cursorNdc.x, cursorNdc.y);
      if (hit) {
        const amount = (1 - this.goalView / previous) * 0.82;
        this.goalTarget.x += (hit.x - this.goalTarget.x) * amount;
        this.goalTarget.z += (hit.z - this.goalTarget.z) * amount;
        this.clampTarget();
      }
    }
  }

  /** Test/debug helper: jump straight to an explicit view. */
  setView(view: { yaw?: number; pitch?: number; viewSize?: number }): void {
    if (view.yaw !== undefined) this.goalYaw = view.yaw;
    if (view.pitch !== undefined) this.goalPitch = clamp(view.pitch, MIN_PITCH, MAX_PITCH);
    if (view.viewSize !== undefined) this.goalView = clamp(view.viewSize, MIN_VIEW, MAX_VIEW);
    this.snap();
  }

  focus(x: number, z: number): void {
    this.goalTarget.x = x;
    this.goalTarget.z = z;
    this.clampTarget();
    this.target.x = this.goalTarget.x;
    this.target.z = this.goalTarget.z;
    this.snapYawPitch();
  }

  update(dt: number): void {
    const y = this.sampler.heightAt(this.goalTarget.x, this.goalTarget.z);
    this.goalTarget.y = y + 1.4;
    this.target.x = damp(this.target.x, this.goalTarget.x, 8, dt);
    this.target.y = damp(this.target.y, this.goalTarget.y, 8, dt);
    this.target.z = damp(this.target.z, this.goalTarget.z, 8, dt);
    this.yaw = dampAngle(this.yaw, this.goalYaw, 12, dt);
    this.pitch = damp(this.pitch, this.goalPitch, 12, dt);
    this.viewSize = damp(this.viewSize, this.goalView, 12, dt);
    this.setAspect(this.width / this.height);
    this.placeCamera();
  }

  snap(): void {
    this.snapYawPitch();
    this.target.copy(this.goalTarget);
    this.viewSize = this.goalView;
    this.placeCamera();
  }

  private snapYawPitch(): void {
    this.yaw = this.goalYaw;
    this.pitch = this.goalPitch;
  }

  private placeCamera(): void {
    const cosPitch = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cosPitch * CAMERA_DISTANCE,
      this.target.y + Math.sin(this.pitch) * CAMERA_DISTANCE,
      this.target.z + Math.cos(this.yaw) * cosPitch * CAMERA_DISTANCE,
    );
    this.camera.lookAt(this.target);
    this.applyProjection();
  }

  private applyProjection(): void {
    this.camera.left = (-this.viewSize * (this.width / this.height)) / 2;
    this.camera.right = (this.viewSize * (this.width / this.height)) / 2;
    this.camera.top = this.viewSize / 2;
    this.camera.bottom = -this.viewSize / 2;
    this.camera.near = 0.1;
    this.camera.far = 900;
    this.camera.updateProjectionMatrix();
  }

  private pickGround(ndcX: number, ndcY: number): Vector3 | null {
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const origin = this.raycaster.ray.origin;
    const direction = this.raycaster.ray.direction;
    const denom = direction.dot(this.plane);
    if (Math.abs(denom) < 1e-5) return null;
    const t = (this.goalTarget.y - origin.y) / denom;
    if (t < 0) return null;
    this.groundPoint.copy(origin).addScaledVector(direction, t);
    return this.groundPoint;
  }

  private clampTarget(): void {
    this.goalTarget.x = clamp(this.goalTarget.x, 6, 186);
    this.goalTarget.z = clamp(this.goalTarget.z, 6, 186);
  }
}
