# Cinderline

A low-poly wildfire command RTS that runs in the browser. Build roads, dispatch engines and aircraft, cut firelines, protect the town, and hold the ridge for one eight-minute shift.

![Start screen](docs/screenshots/start.png)

![Wildfire and response fleet](docs/screenshots/gameplay.png)

| Large fire | Victory |
| --- | --- |
| ![Large fire](docs/screenshots/fireline.png) | ![Victory screen](docs/screenshots/victory.png) |

## The game

Cinderline is a from-scratch reboot of the wildfire RTS prototype. The world is a rigid, terraced landscape: every surface is flat or a 45-degree slope, inspired by isometric management games. Fire is simulated per tile with wind, slope, moisture, fuel, spotting, water, retardant, and bulldozed firelines.

One seeded shift includes:

- **Four forecast lightning fires** with shifting wind and spot fires.
- **Five response units**: two fire engines, a bulldozer, a helicopter, and an air tanker.
- **Auto-dispatch and full manual command**, including right-click move/attack orders and per-incident dispatch.
- **Road building** on the tile grid. New asphalt becomes a firebreak and triggers hydrant placement.
- **Fire hydrants** placed along roads. Engines connected to a hydrant get an unlimited water feed; empty engines route to the nearest reachable hydrant by default.
- **Vegetation and structures**: pine, oak, chaparral, rocks, houses, barns, cabins, a fire station, and a helipad.
- **Particles**: flames, embers, smoke, water drops, water spray, retardant drops, steam, and dozer dust.
- **Win/loss and scoring**: contain all incidents and keep the town standing before the shift ends.

## Run it

```bash
npm install
npm run dev
```

Open the printed local URL (default `http://localhost:5173`). Add `?seed=12345` to replay a specific world.

Production build:

```bash
npm run build
npm run preview
```

## Controls

| Input | Action |
| --- | --- |
| Left click | Select a unit, use the active tool, or attack a burning tile with the selected unit |
| Right click | Move the selected unit / aircraft, or attack a burning tile |
| WASD / arrows | Pan |
| Q / E | Rotate |
| R / F | Tilt |
| Mouse wheel | Zoom toward cursor |
| Middle drag | Pan |
| V | Select tool |
| I | Ignite tool |
| B | Road tool (click start, then destination) |
| Space | Pause / resume |
| 1 / 2 / 4 | Simulation speed |
| H | Field manual |
| Escape | Cancel a road start, close help, or deselect |

## Systems

- **Terrain**: 96×96 tiles at 2 m per tile. Integer terrace levels with a slope limiter that keeps cardinal steps to one level, producing flat tops and 45-degree faces. A town plateau, lake, rocky ridges, forest, brush, and grassland are generated from a seed.
- **Fire**: deterministic per-tile state machine at 5 Hz. Wind and upslope increase rate-of-spread; moisture, wetness, and retardant reduce it. Spotting throws embers downwind. Roads and cleared firelines are barriers. Structures accumulate damage while their tiles burn.
- **Units**: engines are road-bound and carry 4,000 L. Dozers can leave the road and cut a permanent line. The helicopter drops water at the downwind head. The tanker lays a perpendicular retardant line. Aircraft return to the helipad to refill.
- **Dispatch**: incidents track severity and assigned units. Auto-dispatch sends the best available ground unit, aircraft, or dozer. Manual dispatch and direct orders override it.
- **Hydrants**: spaced along the road mask, rebuilt after road edits. An engine within 4.6 m of a hydrant gets a visible unlimited feed.
- **Rendering**: Three.js orthographic diorama camera, flat-shaded terraced terrain, instanced vegetation, instanced particles, and a dark command-console HUD with a live minimap.

## Quality gates

```bash
npm run typecheck   # strict TypeScript
npm test            # Vitest: terrain, roads, biomes, fire, hydrants
npm run build       # typecheck + production bundle
npm run check       # typecheck + tests + build
npm run smoke       # Playwright browser smoke test (needs Chromium)
npm run stability   # five-seed, full-shift stability pass
```

The smoke test boots the game, starts a shift, ignites a fire, selects and moves an engine, builds a road, checks firebreak integration, verifies pause/help/speed controls, fast-forwards to an outcome, and asserts the end screen appears without browser errors.

Browser tests need Chromium; first-time setup:

```bash
npx playwright install chromium
```

## Project layout

```text
src/
  core/      renderer, scene, orthographic camera rig, math, RNG
  world/     terraced heightmap, biomes, roads, buildings, vegetation, hydrants
  sim/       fire model, particles, units, incidents, scenario
  ui/        HUD, minimap, notifications, start/end screens, tool chrome
  game.ts    game orchestration and input
  main.ts    browser entry point
specs/       living architecture, world, fire, units, and scenario specs
scripts/     browser smoke + stability checks
```

## Status

Version 1.0 is a complete single-player MVP. Scenario persistence, multiplayer, authored art, additional scenarios, and mobile-specific controls are out of scope for this version. See [specs/architecture.md](specs/architecture.md) for the current module map and [specs/gameplay.md](specs/gameplay.md) for the gameplay contract.

## License

Private and proprietary.
