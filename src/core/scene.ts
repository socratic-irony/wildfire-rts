import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { WORLD_SIZE } from '../world/constants';

export function createRenderer(container: HTMLElement): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.classList.add('game-canvas');
  return renderer;
}

export function createScene(): Scene {
  const scene = new Scene();
  scene.background = new Color(0xcfdac8);
  scene.fog = new FogExp2(0xc5d2c2, 0.0024);
  addSky(scene);
  addLights(scene);
  return scene;
}

function addSky(scene: Scene): void {
  const geometry = new SphereGeometry(520, 24, 16);
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new Color(0x6b9fc4) },
      uHorizon: { value: new Color(0xe7d6b8) },
      uGround: { value: new Color(0xd7c8a9) },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      varying vec3 vWorld;
      void main() {
        float h = normalize(vWorld).y;
        vec3 color = h > 0.0
          ? mix(uHorizon, uZenith, smoothstep(0.0, 0.72, h))
          : mix(uHorizon, uGround, smoothstep(0.0, -0.35, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new Mesh(geometry, material);
  sky.name = 'sky';
  sky.position.set(WORLD_SIZE / 2, 120, WORLD_SIZE / 2);
  sky.renderOrder = -100;
  scene.add(sky);
}

function addLights(scene: Scene): void {
  const center = WORLD_SIZE / 2;
  const hemi = new HemisphereLight(0xd9ecff, 0x716247, 1.45);
  hemi.position.set(center, 90, center);
  scene.add(hemi);

  const sun = new DirectionalLight(0xffe6bf, 2.5);
  sun.position.set(center + 72, 132, center - 58);
  sun.target.position.set(center, 0, center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -118;
  sun.shadow.camera.right = 118;
  sun.shadow.camera.top = 118;
  sun.shadow.camera.bottom = -118;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 360;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);

  const fill = new DirectionalLight(0xb6d2e8, 0.32);
  fill.position.set(center - 90, 70, center + 95);
  scene.add(fill);
}
