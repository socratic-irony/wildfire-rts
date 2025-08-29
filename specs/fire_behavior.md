# Wildfire-RTS Prototype Roadmap (Three.js)

## 1) Goals & Scope (Prototype → MWE)

**Primary objective:** Stand up a playable 3D diorama with a rolling low-poly terrain, a square gameplay grid, and an RTS-style camera that supports pan/rotate/tilt/zoom. Visual biomes include chaparral (scrub), rock, and low-poly trees. No fire mechanics yet—just world, grid, and camera with performant rendering that anticipates large maps.

**Success criteria**

* Smooth 60 FPS on a modest laptop iGPU for a 256×256 tile map (instanced foliage on \~25–50% of tiles).
* Camera: edge-panning or WASD panning, right-drag rotate, middle-drag tilt, scroll zoom-to-cursor.
* Terrain: rolling hills (noise-based), visible slopes; believable chaparral/rock/tree distribution by slope/height.
* Low-poly aesthetic: flat shading, saturated palette, soft fog, directional sun with cascaded or simple shadow.
* Grid is always legible over terrain without visual clutter (toggleable).

---

## 2) Tech Stack & Project Skeleton

**Stack**

* Three.js (core rendering, lights, shadows, InstancedMesh, BufferGeometry).
* Vite or Next.js for fast dev loop; TypeScript strongly recommended.
* dat.GUI or Leva for debug controls.
* Simplex noise (e.g., `simplex-noise`) for heightmap & biome masks.
* (Optional) Postprocessing: FXAA/SSAARenderPass; keep minimal for perf.

**Project structure**

```
/src
  /core
    renderer.ts          // WebGLRenderer setup, tone mapping, shadow config
    scene.ts             // Scene, lights, fog, helpers
    camera.ts            // RTS camera controller (custom)
    input.ts             // Keyboard/mouse bindings
    loop.ts              // RAF, fixed/variable update
  /terrain
    heightmap.ts         // Noise config, normalize, slope/normal calc
    mesh.ts              // Terrain geometry builder (indexed)
    material.ts          // Flat-shaded material factory
    grid.ts              // Grid overlay (shader projection or line mesh)
    biomes.ts            // Splatting rules, masks (chaparral/rock/forest)
  /actors
    trees.ts             // Instanced low-poly conifers/broadleaf
    shrubs.ts            // Instanced chaparral tufts
    rocks.ts             // Instanced rock clusters
  /ui
    debug.ts             // Leva/dat.GUI bindings, toggles (grid, fog, LOD)
  main.ts                // Bootstrap: compose everything
  types.d.ts
/index.html
```

**Coding standards**

* TypeScript + ES modules; strict mode.
* All materials & geometry created once and reused; heavy use of `InstancedMesh`.
* Avoid per-frame allocations; recycle temp vectors.
* Flat shading (vertex normals set to face normals) for low-poly look.

---

## 3) Visual Aesthetic Spec

**Palette (base)**

* Grass: `#8ACB88`, Dry grass (chaparral base): `#C2B280`, Scrub green: `#6FA06F`
* Rock: `#9A8C98`, Cliff accents: `#6E5A70`
* Tree trunks: `#6B4F3B`, Conifer leaves: `#2C6E49`, Broadleaf leaves: `#4CAF50`
* Water (if present): `#6EC5E9`
* Grid line: `#000000` @ 30–50% opacity (fade with distance)

**Lighting & fog**

* Directional sun: warm (slightly orange), position at (x=100, y=200, z=100)
* HemisphereLight: sky `#DDEBFF` / ground `#CBBBA0`
* Linear fog or exp2 fog that matches sky hue; increase with distance to reduce aliasing.

**Shadows**

* Directional shadow map size 2048×2048 (tunable); cascaded optional later.
* Terrain & foliage cast/receive shadows; disable for shrubs if perf dips.

**Materials**

* MeshStandardMaterial (flatShading = true), low roughness \~0.6–0.8, metalness 0.
* Optionally bake vertex colors per biome tint; avoid heavy splat-maps initially.

---

## 4) Data & World Representation

**World grid**

* Tile size: **1 unit** (meter-like) or 2 units; pick 1 for simplicity.
* Map size targets: 128×128 (baseline), 256×256 (stress), keep 512×512 future-proofed.
* Height range: 0–30 units; slope computed from adjacent heights.

**Heightmap generation**

* Octave fractal noise: 3–5 octaves, base frequency \~1/64 tile, persistence 0.5.
* Apply erosion-like smoothing pass (optional): blur + slope clamp to avoid extreme spikes.
* Sea level optional; for now 100% land.

**Biomes**

* Rock: high slope (e.g., > 35°) or high elevation quantile (top 10%).
* Chaparral (scrub): mid-elevation with low to moderate moisture proxy (second noise channel).
* Forest: valley floors & windward slopes (heuristic: moisture noise high, slope < 20°).
* Distributions controlled by thresholds exposed in debug UI.

---

## 5) Terrain Implementation Details

**Geometry**

* Build a single indexed `BufferGeometry` grid:

  * Positions: `(width+1) * (height+1)` vertices.
  * Indices: 6 per quad.
* Calculate per-vertex normals as averaged face normals; for flat look, set `geometry.computeVertexNormals()` then **convert to flat**:

  * Option 1: Use `material.flatShading = true`.
  * Option 2: Manually duplicate vertices per face (heavier but crispest).

**LOD**

* Start single mesh; add chunked LOD later:

  * Split into 32×32 tile chunks; use frustum/distance culling.
  * Far chunks use lower-res grid (decimate every 2–4 samples).

**Grid overlay (three approaches)**

1. **Projected grid shader** (recommended): in fragment shader, project world position onto XZ, draw thin lines where `fract(x)` or `fract(z)` close to 0; fade by distance/angle; respects terrain undulation.
2. **LineSegments mesh**: generate polyline over each tile edge; simpler but more draw calls.
3. **Decal pass**: render an orthographic projected grid to a texture, sample in terrain shader (more setup).

Start with **shader projection** for clarity/perf; make toggleable.

---

## 6) Vegetation & Rocks

**Instancing strategy**

* Use `THREE.InstancedMesh` for each asset family (e.g., `TreeConifer`, `TreeBroadleaf`, `Shrub`, `Rock`).
* Per instance:

  * Position: tile center + small random jitter within tile.
  * Y: sample terrain height with bilinear interpolation.
  * Rotation: random yaw; small tilt aligned to surface normal (dot clamp).
  * Scale: random within species range.

**Models (procedural, low-poly)**

* **Conifer**: stack 2–3 truncated cones (leaves) + hex prism trunk. Vertex count target < 120.
* **Broadleaf**: 1–2 low-poly spheres/icosa + short trunk.
* **Shrub**: 3–5 intersecting low-poly “leaf clumps.”
* **Rock**: distorted icosahedron (apply random vertex noise, then flat shade).

**Density rules**

* Forest: 50–120 trees/ha equivalent (≈0.5–1.2 per 4×4 tile area).
* Chaparral: 1–3 shrubs per tile; fewer on steep slopes.
* Rock: 0–1 cluster per 4×4 tiles; more on high slope/elev.

**Wind hint (visual only for now)**

* Subtle vertex shader sway for trees/shrubs based on a global time uniform and wind vector; amplitude small to preserve readability.

---

## 7) Camera & Input (RTS-Style)

**Behavior**

* **Pan**: WASD or edge pan near viewport borders (configurable). Pan along ground plane.
* **Rotate**: Right mouse drag (hold RMB) yaw around **orbit pivot** under cursor or center.
* **Tilt**: Right drag + modifier (or middle drag) pitch clamped (e.g., 15°–75°).
* **Zoom**: Wheel zoom **to cursor** using raycast → interpolate camera target & distance. Clamp min/max distance.
* **Terrain collision**: Maintain minimum clearance to terrain along camera forward vector; if intersection, push camera up along normal.

**Implementation**

* Maintain a camera rig:

  * `groupRoot` (world-space pivot) → `groupYaw` (y-rotation) → `groupPitch` (x-rotation) → `camera`.
* All moves/rotations manipulate groups; zoom adjusts camera local z.
* Use `Raycaster` to place/keep pivot at ground under cursor.
* Input smoothing with exponential damping (configurable).

---

## 8) Performance Targets & Techniques

**Targets**

* ≤ 200 draw calls at rest; foliage handled by 4–8 instanced meshes.
* GPU frame time under \~10–12ms on iGPU.

**Techniques**

* Merge terrain into chunks; frustum cull via `camera.updateMatrixWorld()` → `Frustum.intersectsObject`.
* Use `InstancedMesh` with per-instance color via `instanceColor` (optional) to add variation without extra materials.
* Avoid dynamic material uniforms per-instance; batch by family.
* Consider `WebGLRenderer` parameters:

  * `antialias: true` (or post AA), `powerPreference: "high-performance"`.
  * `physicallyCorrectLights: false` (aesthetic > PBR accuracy).
* Use `RGBE`/tonemapping optional; start with `ACESFilmicToneMapping` OFF for simplicity.

---

## 9) Debug & Tooling

**Leva/dat.GUI controls**

* Map seed, noise amplitude/frequency, biome thresholds.
* Toggle: grid / shadows / fog / LOD / edge pan.
* Camera speed, zoom limits.
* Wind dir/speed (for future fire).

**On-screen stats**

* FPS meter (stats.js).
* Draw call count, instance counts.

---

## 10) Build Stages (Incremental Plan)

### Stage A — Environment & Renderer

* Vite + TypeScript scaffold.
* Create renderer, scene, camera rig, lights, fog, resize handling.
* **Acceptance:** blank scene with sky-fog and a spinning cube (temporary).

### Stage B — Terrain Heightmap & Mesh

* Implement `heightmap.ts` (simplex noise).
* Build `terrain/mesh.ts` to create indexed grid mesh from heightmap.
* Apply flat-shaded material; add directional light & shadows.
* **Acceptance:** rolling low-poly landscape renders; orbit the camera temporarily.

### Stage C — RTS Camera Controller

* Replace orbit with custom RTS controller (pan/rotate/tilt/zoom-to-cursor).
* Implement raycast-to-ground & camera collision.
* **Acceptance:** camera never clips into terrain; intuitive zoom-to-cursor works.

### Stage D — Grid Overlay

* Implement projected grid shader pass inside terrain material (world XZ).
* Distance-based fade; toggle in debug UI.
* **Acceptance:** crisp grid that hugs slopes, remains legible at all angles.

### Stage E — Biome Masks & Materials

* Compute slope & aspect maps; second noise channel for moisture.
* Classify tiles into rock/chaparral/forest; store per-tile flags.
* Terrain tint: vertex colors or tri-planar-like blend **later**; for now, per-vertex color by biome dominance.
* **Acceptance:** terrain coloration clearly differentiates rock vs scrub vs forest ground.

### Stage F — Vegetation & Rocks (Instanced)

* Procedural low-poly models (conifer, broadleaf, shrub, rock).
* Scatter instances according to biome rules; align to normals.
* Add light wind sway in vertex shader (small).
* **Acceptance:** thousands of instances render smoothly; no z-fighting; shadows OK.

### Stage G — Polish & Performance

* Chunk the terrain into 32×32 tiles; frustum/distance cull.
* LOD for distant chunks (every other vertex).
* Optional FXAA pass if aliasing too harsh.
* **Acceptance:** 60 FPS at 256×256 tiles with dense foliage toggled on.

---

## 11) Detailed Interfaces (Type Hints)

```ts
// terrain/heightmap.ts
export type Heightmap = {
  width: number; height: number; // tiles
  sample(x: number, z: number): number; // height in world units
  data: Float32Array; // (width+1)*(height+1)
};

export type BiomeMask = {
  isRock: Uint8Array;
  isForest: Uint8Array;
  isChaparral: Uint8Array;
};

export interface NoiseConfig {
  seed: number;
  frequency: number; // tiles^-1
  amplitude: number; // world units
  octaves: number;
  persistence: number;
}

// actors/placement.ts
export interface ScatterRule {
  mask: keyof BiomeMask;        // e.g., "isForest"
  density: number;              // instances per tile (avg)
  maxSlopeDeg?: number;
  minSlopeDeg?: number;
  jitter?: number;              // in tile units
}
```

---

## 12) Math Notes

**Slope (degrees)**

* For vertex `(x,z)`:

  * `nx = h(x+1,z) - h(x-1,z)`, `nz = h(x,z+1) - h(x,z-1)`
  * Normal ≈ normalize(`(-nx, 2, -nz)`); slope = `acos(normal.y)` in degrees.
* Use tile-centered samples; clamp extremes.

**Grid shader (fragment)**

* World pos `p`: `gx = abs(fract(p.x) - 0.5)`, `gz = abs(fract(p.z) - 0.5)`
* Line when `min(gx,gz) < w` (w = line half-width); alpha fades with distance.

**Zoom-to-cursor**

* Raycast from camera through mouse NDC to terrain.
* Maintain `pivot` at hit point; change camera distance toward/away from pivot.

---

## 13) Art Direction Notes (Low-Poly Cohesion)

* Avoid tiny details; emphasize bold silhouettes.
* Keep face count low; prefer distinctive shapes.
* Slight palette variation via vertex colors per-instance (±5–10% HSV jitter).
* Use ambient occlusion look via darker vertex color at trunk bases/rock bottoms (hand-tinted or procedural).

---

## 14) Extensibility Hooks (Future Fire System)

* **Per-tile data struct:** `{ height, slope, fuelType, fuelLoad, moisture, windExposure }`.
* **Simulation grid** separate from render mesh but same resolution; allows CPU fire spread while terrain LOD changes.
* **Overlays:** heatmap for intensity; vector field for wind.
* **Actors:** trucks/helicopters as separate systems using navmesh/road graph and flight paths.

---

## 15) Risks & Mitigations

* **Grid readability vs clutter:** Use shader-projected thin lines with distance fade; toggle with hotkey (G).
* **Perf spikes from shadows:** Limit casters, reduce shadow distance, or disable shrub shadows.
* **Aliasing on thin edges:** FXAA postpass; slightly thicker grid lines at far distance.
* **Camera disorientation on steep terrain:** Clamp tilt; maintain horizon bias; add “reset view” hotkey.

---

## 16) MWE Demo Script (User Flow)

1. Launch → randomized seed renders rolling terrain.
2. Camera controls tutorial overlay (WASD, RMB rotate, MMB tilt, wheel zoom).
3. Toggle grid (G). Observe lines hugging hills.
4. Toggle biomes (B): recolor ground; vegetation populates.
5. Open debug panel → tweak seed, noise, biome thresholds; observe live updates.
6. FPS & instance counts visible to validate performance.

---

## 17) Deliverables Checklist

* [ ] Vite + TS project with `main.ts` entry and working render loop.
* [ ] `renderer`, `scene`, `camera`, `loop` modules in `/core`.
* [ ] `heightmap`, `mesh`, `material`, `grid`, `biomes` modules in `/terrain`.
* [ ] `trees`, `shrubs`, `rocks` with InstancedMesh in `/actors`.
* [ ] `debug` UI toggles & stats overlay.
* [ ] README with controls, settings, and known limits.

---

## 18) Control Map (Default)

* **Pan:** WASD or mouse edge (toggleable)
* **Rotate:** Right-drag
* **Tilt:** Middle-drag (or Right-drag + Shift)
* **Zoom:** Mouse wheel (to cursor)
* **Toggle Grid:** G
* **Toggle Biomes:** B
* **Reset Camera:** R
* **Toggle Debug UI:** F1

---

## 19) Acceptance Tests

* Camera:

  * Zooming toward a distant hill centers that hill and stops at a safe height.
  * Panning preserves altitude (no unintentional vertical drift).
* Terrain:

  * No cracks or T-junctions; normals produce consistent flat shading.
* Vegetation:

  * Instances sit on terrain with minimal floating/clipping.
  * Density responds to biome sliders in real time (or upon “Rebuild”).
* Performance:

  * 60 FPS on 128×128 with dense forest; ≥45 FPS at 256×256 with all toggles.

---

## 20) Optional Nice-to-Haves (If Time Permits)

* Simple day-night cycle (sun azimuth anim).
* Minimal skybox gradient shader.
* Water plane with cheap reflection tint at low elevations.
* Screenshot hotkey that hides UI and saves canvas to PNG.

---

Use this as your script for another LLM: hand them this roadmap and ask them to implement **Stage A → G** in order, committing at the end of each stage with a GIF or screen capture and a short perf note (draw calls, FPS).
