# Wildfire RTS Prototype

A real-time strategy game prototype featuring procedural terrain, wildfire simulation, road building, and vehicle management built with Three.js and TypeScript.

![Wildfire RTS Prototype](https://img.shields.io/badge/status-prototype-yellow) ![Build Status](https://img.shields.io/badge/build-passing-brightgreen) ![Tests](https://img.shields.io/badge/tests-59%20passing-brightgreen)

## Features

- **Procedural Terrain**: Rolling hills with biome-based vegetation (forest, chaparral, rock)
- **Wildfire Simulation**: Physics-based fire spread with wind/slope influence, suppression mechanics
- **Road System**: A*-based pathfinding with valley-preferring cost function and smooth ribbon rendering
- **Vehicle Management**: Instanced vehicles that follow roads with terrain-aligned positioning
- **RTS Camera**: Pan, rotate, tilt, and zoom controls optimized for strategy gameplay
- **Debug UI**: Comprehensive controls for all systems with performance stats

## Getting Started

### Prerequisites

- Node.js 18+ (LTS recommended)
- Modern web browser with WebGL 2.0 support

### Installation

```bash
npm install
```

### Development

```bash
# Start development server with hot reload
npm run dev

# Open http://localhost:5173 in your browser
```

### Production Build

```bash
# Build for production
npm run build

# Preview production build locally  
npm run preview
```

### Testing

```bash
# Run test suite
npm run test
```

## Controls

### Camera Controls
- **Mouse Drag**: Rotate camera around terrain
- **Middle Drag**: Adjust camera tilt
- **Mouse Wheel**: Zoom in/out (zoom-to-cursor)
- **WASD**: Pan camera across terrain
- **Q/E**: Yaw camera left/right
- **R/F**: Adjust camera tilt up/down
- **G**: Toggle grid overlay

### Interaction Modes
- **Left Click**: Ignite fire (default mode)
- **Road Mode**: Click and drag to build roads using A* pathfinding
- **Vehicle Mode**: Spawn and control vehicles on road network

### Debug Controls
Access the debug panel in the top-left corner to:
- Toggle system visibility (terrain chunks, fire overlay, roads, vehicles)
- Adjust fire parameters (wind speed/direction, ignition settings)
- Control vehicle behavior (spawn, movement, clear)
- Monitor performance stats (FPS, memory usage, draw calls)

## Architecture

The codebase follows a modular architecture:

- **`src/core/`**: Rendering engine, camera system, input handling, main loop
- **`src/terrain/`**: Procedural heightmap generation, chunked LOD terrain, biome system
- **`src/fire/`**: Grid-based fire simulation, visualization, suppression mechanics  
- **`src/roads/`**: A* pathfinding, cost fields, visual road rendering
- **`src/vehicles/`**: Instanced vehicle management with road-following behavior
- **`src/ui/`**: Debug interface, console system, error handling
- **`src/particles/`**: Fire particle effects using flipbook billboards

See [`specs/architecture.md`](specs/architecture.md) for detailed technical documentation.

## Performance Targets

- **60 FPS** on modest laptop iGPU
- **256×256 tile maps** with instanced vegetation on ~25-50% of tiles
- **Low-poly aesthetic** with flat shading to maintain visual cohesion
- **Minimal per-frame allocations** in hot paths

## Development Guidelines

This project follows spec-first development:

1. Read [`AGENTS.md`](AGENTS.md) for repository guidelines
2. Review relevant specs in [`specs/`](specs/) before making changes  
3. Update specs to reflect implementation changes
4. Use TypeScript strict mode and follow existing code conventions
5. Add tests for critical math-heavy components

## Current Limitations

- **Fire System**: Crown fire behavior and edge-based firelines not fully implemented
- **Vehicles**: Intersection logic specified but not yet implemented
- **Particles**: Using placeholder textures, soft particles not implemented
- **Persistence**: Save/load scenarios not yet available
- **Multiplayer**: Single-player prototype only

## Roadmap

### Near-term (v0.2)
- [ ] Complete fire system crown behavior and early extinguish rules
- [ ] Implement vehicle intersection logic (well-specified in `specs/driving.md`)
- [ ] Add water/retardant paint tools for fire suppression
- [ ] Wire fire statistics into debug UI

### Medium-term (v0.3)
- [ ] Save/load scenarios (terrain seed, fire seed, roads, vehicles)
- [ ] Replace placeholder particle assets with proper flame/smoke textures
- [ ] Add soft particles with depth-fade for terrain intersections
- [ ] Implement telemetry system with per-subsystem timing

### Future
- [ ] Multiplayer infrastructure planning
- [ ] Advanced postprocessing effects
- [ ] Hero plume particles for dramatic fire events
- [ ] Mission/scenario scripting system

## Contributing

1. Read [`AGENTS.md`](AGENTS.md) for detailed contribution guidelines
2. Follow the spec-first approach: update relevant specs with your changes
3. Ensure `npm run build` and `npm run test` pass
4. Include screenshots/video for visual changes
5. Keep commits focused and reference the affected system/stage

## License

This project is private and proprietary.

## Technical Details

**Built with:**
- [Three.js](https://threejs.org/) - 3D rendering engine
- [Vite](https://vitejs.dev/) - Build tool with hot reload
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [Vitest](https://vitest.dev/) - Testing framework
- [simplex-noise](https://www.npmjs.com/package/simplex-noise) - Procedural generation

**Performance Features:**
- Instanced rendering for repeated geometry (trees, vehicles, fire overlays)
- Chunked terrain with distance-based LOD
- Fixed-timestep simulation with frame-rate independence  
- Efficient A* pathfinding with cost field caching
- Deterministic fire simulation with seedable random number generation