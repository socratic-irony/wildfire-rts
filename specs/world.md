# World

## Status

Implemented: terraced heightmap, town plateau, lake, biome classification, roads and road building, building lots, fire station/helipad, vegetation, rocks, hydrants, backdrop. Outstanding: saveable world edits, authored structures, more building variants, bridge/tunnel road operations.

## Grid and coordinate system

- `GRID_SIZE = 96`, `TILE_SIZE = 2` world units, `LEVEL_HEIGHT = 2`.
- Vertex heights are integer terrace levels (0–12) at `(GRID_SIZE + 1)²` vertices.
- Tile `(tx, tz)` covers `[tx*2, (tx+1)*2] × [tz*2, (tz+1)*2]`; its center is `((tx + 0.5)*2, (tz + 0.5)*2)`.
- Fire, roads, hydrants, incidents, and structures all use this tile grid. Rendering and units sample the same world space.
- `worldToTile` clamps to the grid.

## Terrain generation

1. Layered value noise (`fbm2`, ridge noise) creates the raw relief.
2. Levels are quantized, a rim is added around the map, and a central town ellipse is flattened to `TOWN_LEVEL = 3`.
3. A lake depression is carved near the southwest quadrant and tagged in `waterMask`.
4. A slope limiter repeatedly lowers high vertices to `min(cardinalNeighbor) + 1` until every cardinal step is at most one level. This produces flat tops and 45-degree faces without raising valleys.
5. The visual mesh uses two flat-shaded triangles per tile. Per-tile colors vary by terrain and steepness; steep faces read as rock/dirt, tops read as grass/brush/forest/town.

The heightmap exposes `heightAt`, `tileHeight`, `cornerHeights`, `slopeTan`, `isWater`, and `normalAt`. `tileHeight` is the average of four corners; buildings are placed only on flat footprints.

## Biomes and fuels

`Terrain` values: water, rock, forest, brush, grass, urban, road. Classification uses slope, elevation, a moisture noise channel, lake proximity, and the town ellipse. Fuel mapping for fire:

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
- Initial layout: a town grid (main street, north-south spine, south street, two side streets), a forest service road, and a lake spur.
- `RoadVisual` rebuilds a terrain-conforming asphalt surface, shoulder, and dashed centerline. Intersections with more than one axis suppress center dashes.
- Road planning uses A* with slope, rock, and town costs; water is blocked, building clearance is blocked, and roads adjacent to buildings remain usable.
- `World.buildRoad(start, goal)` plans, rasterizes, rebuilds roads/hydrants/vegetation, and returns the path length.
- Game integration calls `Wildfire.refreshRoadMask` after a build so new asphalt is a firebreak.

## Buildings

- `BuildingSystem` reserves a helipad, places a fixed fire station at the town center, then fills road frontage lots with houses, barns, and cabins.
- Lots are axis-aligned; `front` determines which face points at the road. Footprints are odd dimensions so the anchor tile is the center.
- Placement rejects water, rock, roads, non-flat footprints, and a one-tile clearance ring. Clearance is tracked in `occupied`.
- House/barn/cabin/station visuals are procedural low-poly groups with wall/roof/trim materials, doors, windows, porches, garage bays, a station sign, and a helipad with an H.
- Fire state: `intact → burning` while any footprint tile is igniting/burning, `→ destroyed` at 100 damage. Suppression lets damage decay and returns the structure to intact. Destroyed structures swap to charred rubble.
- `computeStructureScore` equivalent: +10 per standing structure, −25 per destroyed (surfaced through `BuildingSystem.score`).
- The helipad is the air-unit home; the road tile in front of the station is the ground-unit home.

## Vegetation

- Families: pine (three cone tiers), oak (trunk plus three crown blobs), shrub (three lobes), rock (distorted dodecahedron).
- Per-family geometry is merged with baked vertex colors, then rendered with `InstancedMesh` and per-instance tint/scale/rotation.
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
