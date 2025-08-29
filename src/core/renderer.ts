import { WebGLRenderer, PCFSoftShadowMap, ACESFilmicToneMapping } from 'three';

export function createRenderer(container: HTMLElement): WebGLRenderer {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  return renderer;
}

export function resizeRenderer(renderer: WebGLRenderer, container: HTMLElement) {
  const width = container.clientWidth;
  const height = container.clientHeight;
  renderer.setSize(width, height);
}

