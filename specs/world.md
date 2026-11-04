# World

## Status

Implemented: seeded map generator (open rolling hills, per-seed town/lake/road placement), terraced heightmap with road grading, biome classification with vegetated banks, generated road network and player road building, building lots with seven building types plus props (water tower, fire lookout, power poles), 13 vegetation species, hydrants, map-edge skirts, backdrop. Outstanding: saveable world edits, bridge/tunnel road operations.

## Grid and coordinate system

- `GRID_SIZE = 96`, `TILE_SIZE = 2` world units, `LEVEL_HEIGHT = 2`.
- Vertex heights are integer terrace levels (0–12) at `(GRID_SIZE + 1)²` vertices.
- Tile `(tx, tz)` covers `[tx*2, (tx+1)*2] × [tz*2, (tz+1)*2]`; its center is `((tx + 0.5)*2, (tz + 0.5)*2)`.
- Fire, roads, hydrants, incidents, and structures all use this tile grid. Rendering and units sample the same world space.
- `worldToTile` clamps to the grid.

## Terrain generation

Every seed produces a different map (the open, rolling-hills generator of the original prototype, terraced):

1. Domain-warped fractal value noise (`fbm2`) plus ridge noise creates a normalized raw relief, with per-seed frequency, ridge strength and warp.
2. `chooseLayout` picks the `MapLayout`: the town centre is the smoothest mid-elevation patch in the interior band (random radii, random station side), and the lake goes in the lowest smoothed basin clear of the town. `relief` (6–10) sets how many terrace levels the noise spans.
3. Levels are quantized; the town ellipse is pinned to its plateau level with a smooth blend outward, and the lake basin is sunk to level 0 and tagged in `waterMask`.
4. A floor pass keeps everything next to the pinned town within one level of it, then a lower-only slope limiter makes every cardinal step at most one level (flat tops and 45° faces).
5. After roads are generated, `gradeForRoads` cuts the terrain under them: straight tiles get level cross-sections (ramps along the road), bends/junctions/dead ends become flat pads. It only lowers, re-applies the slope limit, and never moves pinned vertices (building footprints at runtime).
6. The visual mesh uses two flat-shaded triangles per tile. Flat tiles take their terrain colour; banks are coloured per triangle by blending the terrain's plant cover over earth (or stone) strata cycled by terrace level. Vertical earth skirts close the map edge.

The heightmap exposes `heightAt` (samples the same two triangles the mesh renders, so props and units sit on slopes exactly), `tileHeight`, `cornerHeights`, `slopeTan`, `isWater`, `normalAt`, `layout`, and `gradeForRoads`. Buildings are placed only on flat footprints.

## Biomes and fuels

`Terrain` values: water, rock, forest, brush, grass, urban, road. Classification uses slope, elevation, a moisture noise channel, lake proximity, and the town ellipse. Terrace banks keep the surrounding vegetation class (so they burn and carry fire upslope); only the highest ground and sharp double-step corners become rock. Fuel mapping for fire:

| Terrain | Fuel | Base ROS (m/s) |
| --- | --- | --- |
| Grass | Grass | 0.62 |
| Brush | Chaparral | 0.36 |
| Forest | Timber | 0.24 |
| Urban | Structure | 0.19 |
| Rock | inert | 0 |
| Water | inert | 0 |
| Road | inert | 0 |

Building footprint tiles are forced to urban fuel by `BuildingSystem`, so structures can ignite. New road tiles are forced to inert road fuel via `Wildfire.refreshRoadMask`.

## Roads

- `RoadNetwork` stores a `Uint8Array` mask and supports 4-neighbor connectivity.
- `generateRoadNetwork(heightmap, seed)`: a town grid around the layout's crossroads (main streets, two side streets, a cross street, sometimes a back lane), 2–4 highways planned out to random points on the map edge, and a spur to the highest ground (where the fire lookout stands).
- `RoadVisual` draws asphalt exactly on each graded tile, solid edge lines and a dusty shoulder on every side that does not continue into road (outer shoulder edge draped on the neighbouring terrain), and a centre dash on straight tiles.
- Road planning uses A* with an along-slope cost, a higher cross-slope cost (side-cuts are expensive), a turn penalty (prefer straight runs to staircases) and a rock penalty; water and building clearance are blocked.
- `World.buildRoad(start, goal, avoid?)` plans (treating `avoid`, e.g. burning tiles, as blocked), regrades terrain with structures pinned, rebuilds the terrain mesh, roads, hydrants, power poles and vegetation, and returns the path. Crews will not pave through active fire.
- Game integration calls `Wildfire.refreshRoadMask` after a build so new asphalt is a firebreak.

## Buildings

- `BuildingSystem` reserves a helipad and places the fire station beside the layout's crossroads (side chosen per seed), then fills road frontage lots: houses, two-storey farmhouses, ranch houses, false-front stores (up to three, near the centre), one chapel, barns (with silo or hay bales) and log cabins (outskirts).
- Lots are axis-aligned; `front` determines which face points at the road. Footprints are odd dimensions so the anchor tile is the center.
- Placement rejects water, rock, roads, non-flat footprints, and a one-tile clearance ring. Clearance is tracked in `occupied`.
- Visuals are procedural low-poly groups: per-building wall/roof/trim materials (they char as the building burns) plus shared detail materials for framed windows, doors, foundations, porches, picket fences, mailboxes, chimneys, dormers, awnings and painted signs. Houses step back from the road so porches stay inside the lot.
- Props: a water tower at the helipad, a fire lookout tower beside the highest out-of-town road, and instanced power poles along rural straights (rebuilt with the road network).
- Fire state: `intact → burning` while any footprint tile is igniting/burning, `→ destroyed` at 100 damage. Suppression lets damage decay and returns the structure to intact. Destroyed structures swap to charred rubble.
- `computeStructureScore` equivalent: +10 per standing structure, −25 per destroyed (surfaced through `BuildingSystem.score`).
- The helipad is the air-unit home; the road tile in front of the station is the ground-unit home.

## Vegetation

- Species: ponderosa pine, subalpine fir, yard cypress, valley oak, aspen, fire-killed snag, manzanita, shrub, bunchgrass tuft, wildflower patch, rock, boulder cluster, fallen log. Each terrain type has a planting table; wetter ground favours fir and aspen. Trees grow on banks up to 45° and are sunk slightly so the downhill side never floats.
- Per-species geometry is merged with baked vertex colors, then rendered with `InstancedMesh` and per-instance colour drift, scale, height stretch, lean and rotation.
- Scatter density follows terrain: dense forest, moderate brush, sparse grass/rock. Roads and building occupancy are excluded.
- Burn tint updates at 2 Hz and maps fire state to warm/brown/charcoal colors.

## Hydrants

- Auto-placed on road tiles with a minimum 5-tile spacing, offset 1.18 world units to alternating sides.
- Rebuilt whenever the road mask changes.
- Queries: nearest active source, proximity check.
- Ground units within 4.6 m while attacking receive an unlimited hydrant feed (no tank drain, 1.15× suppression power), shown by the HUD and a cyan link.

## Lake and backdrop

- Lake tiles are rendered as a translucent blue surface at `WATER_LEVEL`.
- A ring of low-poly cones outside the playable grid gives the diorama a horizon. Fog and a gradient sky dome complete the backdrop.

## Outing / next

- Terraforming during play, bridges, tunnels, road removal, building placement, and authored meshes are not in v1.
- Building lots do not currently render driveway ribbons or update frontage after new roads are built.
- Hydrant damage/pressure and manual hydrant placement are future work.
