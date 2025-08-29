import { Group, PerspectiveCamera } from 'three';

export type CameraRig = {
  root: Group;
  yaw: Group;
  pitch: Group;
  camera: PerspectiveCamera;
};

export function createCameraRig(container: HTMLElement): CameraRig {
  const aspect = container.clientWidth / container.clientHeight;
  const camera = new PerspectiveCamera(60, aspect, 0.1, 1000);
  camera.position.set(0, 6, 12);

  const root = new Group();
  const yaw = new Group();
  const pitch = new Group();
  root.add(yaw);
  yaw.add(pitch);
  pitch.add(camera);

  return { root, yaw, pitch, camera };
}

export function resizeCamera(rig: CameraRig, container: HTMLElement) {
  rig.camera.aspect = container.clientWidth / container.clientHeight;
  rig.camera.updateProjectionMatrix();
}

