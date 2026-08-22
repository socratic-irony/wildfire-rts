import { WebGLRenderer, PCFSoftShadowMap, ACESFilmicToneMapping, Vector2, type Camera, type Scene } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

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

export type ComposerRig = {
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
};

/**
 * r160 post chain: RenderPass -> UnrealBloomPass -> OutputPass.
 * Since r155 tone mapping + sRGB conversion moved into OutputPass (it reads
 * renderer.toneMapping/outputColorSpace per frame), so the composer targets
 * stay linear HDR (HalfFloatType default) and ACESFilmic is applied last —
 * exactly what bloom thresholding wants. Returns null when WebGL2 is
 * unavailable or construction fails; callers fall back to plain rendering.
 */
export function createComposer(renderer: WebGLRenderer, scene: Scene, camera: Camera): ComposerRig | null {
  try {
    if (!renderer.capabilities.isWebGL2) return null;
    const composer = new EffectComposer(renderer);
    const size = renderer.getSize(new Vector2());
    // Bloom runs at half internal resolution — cheap and soft by design.
    const bloomPass = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.45, 0.4, 0.85);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    return { composer, bloomPass };
  } catch (err) {
    console.warn('EffectComposer unavailable; falling back to plain rendering.', err);
    return null;
  }
}

export function resizeComposer(post: ComposerRig | null, width: number, height: number) {
  if (post) post.composer.setSize(width, height);
}


