# Wildfire RTS Development Instructions

**ALWAYS** follow these instructions first and fallback to additional search and context gathering only if the information here is incomplete or found to be in error.

## Project Overview

Wildfire RTS is a real-time strategy game prototype featuring procedural terrain, wildfire simulation, road building, and vehicle management built with Three.js and TypeScript. The project follows a spec-first development approach with comprehensive testing.

## Working Effectively

### Bootstrap and Install Dependencies
- `npm install` — NEVER CANCEL: Takes ~10 seconds. Set timeout to 60+ seconds.
  - Installs Vite, TypeScript, Three.js, Vitest, and other dependencies
  - Shows 4 moderate vulnerabilities (expected, non-blocking)
  - Returns exit code 0 on success

### Build Commands
- `npm run build` — NEVER CANCEL: Takes ~3 seconds. Set timeout to 300+ seconds.
  - Creates production bundle in `dist/` directory
  - Warns about chunk size >500KB (expected, Three.js bundle)
  - Build artifacts: `dist/index.html` and `dist/assets/index-*.js`
- `npm run dev` — NEVER CANCEL: Starts in <1 second. Set timeout to 60+ seconds.
  - Starts Vite development server on `http://localhost:5173`
  - If port 5173 busy, automatically tries 5174, 5175, etc.
  - Hot reload enabled for TypeScript files
- `npm run preview` — NEVER CANCEL: Starts in <1 second. Set timeout to 60+ seconds.
  - Serves built production app on `http://localhost:4173`
  - Requires `npm run build` to be run first

### Testing
- `npm run test` — NEVER CANCEL: Takes ~5 seconds. Set timeout to 300+ seconds.
  - Runs 79 tests in 20 test files using Vitest
  - All tests should pass (fire mechanics, terrain, roads, vehicles, etc.)
  - No additional test dependencies required

### Type Checking
- `npx tsc --noEmit --skipLibCheck` — NEVER CANCEL: Takes ~10 seconds. Set timeout to 300+ seconds.
  - Currently shows 7 type errors (development issues, non-blocking)
  - Errors are in `src/main.ts` and `src/ui/menubar.ts`
  - CI allows type checking with warnings (see `.github/workflows/ci.yml`)

## Validation

### Always Test Core Functionality After Changes
1. **Start Development Server**: `npm run dev` and verify it starts without errors
2. **Load Main Application**: Open browser to dev server URL (`http://localhost:5173`)
3. **Verify Core Systems**: Check that the 3D terrain loads and debug UI appears
4. **Test Basic Interactions**: 
   - Click fire ignition tools (🔥 buttons)
   - Test road building mode (🛣️ button)
   - Verify vehicle spawning works
   - Check performance stats show reasonable FPS (15-60)
5. **Test Build Process**: Run `npm run build && npm run preview` and verify production app works

### Multiple Entry Points
- **Main App**: `index.html` → `src/main.ts` (full RTS experience)
- **Vehicle Test**: `vehicles-test.html` → `src/vehicles_test.ts` (isolated vehicle testing)
- **Model Viewer**: `model-viewer.html` (3D model inspection)
- **Logging Demo**: `logging-demo.html` (logging system demonstration)

### Browser Requirements
- Modern browser with WebGL 2.0 support required
- Expect WebGL performance warnings in console (normal for software rendering)
- Application should achieve 15-60 FPS on modest hardware

## Architecture & Codebase Navigation

### Critical: Spec-First Development
- **ALWAYS** read `specs/architecture.md` before making changes
- **REQUIRED**: Update relevant specs when changing code
- Domain specs in `specs/`: `fire_behavior.md`, `vehicles.md`, `terrain.md`, etc.
- Never commit code changes without updating corresponding spec sections

### Source Code Structure
- **Core Engine**: `src/core/` (renderer, scene, camera, input, loop)
- **Terrain System**: `src/terrain/` (heightmap, mesh, material, biomes, chunks)
- **Fire Simulation**: `src/fire/` (grid, simulation, visualization, stats)
- **Road System**: `src/roads/` (A* pathfinding, cost fields, visual rendering)
- **Vehicle Management**: `src/vehicles/` (instanced agents, road following)
- **UI & Debug**: `src/ui/` (debug interface, console, error handling)
- **Particles**: `src/particles/` (fire effects using flipbook billboards)
- **Entry Point**: `src/main.ts` (wires all systems, owns frame loop)

### Test Organization
- **Test Location**: `src/__tests__/*.test.ts` (colocated with source)
- **Coverage**: Math-heavy components, fire mechanics, terrain generation
- **Framework**: Vitest with deterministic tests for core algorithms
- **Run Tests**: Always run `npm run test` before committing changes

### Configuration Files
- **TypeScript**: `tsconfig.json` (strict mode enabled, ES2020 target)
- **Build**: `package.json` scripts, Vite configuration embedded
- **App Config**: `config/` directory with JSON configs and schema
- **CI/CD**: `.github/workflows/ci.yml` (builds on Node 18 & 20)

## Common Development Tasks

### Making Code Changes
1. Read relevant specs in `specs/` directory first
2. Understand the modular architecture (avoid cross-system dependencies)
3. Follow TypeScript strict mode and existing naming conventions
4. Use instanced rendering for performance (avoid per-frame allocations)
5. Update specs to reflect implementation changes
6. Run `npm run test` to ensure no regressions
7. Test in browser using validation scenarios above

### Adding New Features
1. Check if feature is specified in `specs/` directory
2. Follow existing patterns (e.g., instanced rendering for visual elements)
3. Add tests for math-heavy or critical path components
4. Update debug UI if feature needs runtime controls
5. Maintain 60 FPS performance target on modest hardware

### Debugging Issues
- **Browser Console**: Check for WebGL warnings (expected) vs actual errors
- **Debug UI**: Use in-app performance stats (FPS, draw calls, memory)
- **Test Isolation**: Use `vehicles-test.html` for vehicle-specific issues
- **Logging System**: Configure via `config/logging.json` for detailed output

## Performance Guidelines

### Targets
- **60 FPS** on modest laptop iGPU
- **256×256 tile maps** with instanced vegetation
- **Low-poly aesthetic** with flat shading
- **Minimal per-frame allocations** in hot paths

### Best Practices
- Reuse Three.js materials and geometry objects
- Prefer `InstancedMesh` for repeated objects (trees, vehicles, fire overlays)
- Use chunked terrain with distance-based LOD
- Keep simulation on fixed timesteps with frame-rate independence

## CI/CD & Quality Checks

### GitHub Actions
- **CI Pipeline**: `.github/workflows/ci.yml` runs on push/PR
- **Node Versions**: Tests against Node.js 18 and 20
- **Steps**: npm ci → type check → test → build
- **Artifacts**: Build artifacts uploaded on main branch

### Before Committing
1. Run `npm run test` — ensure all tests pass
2. Run `npm run build` — verify production build succeeds  
3. Test key user scenarios in browser
4. Update relevant specs in `specs/` directory
5. Follow commit message format: `feat(module): description` or `stage-x: description`

## Common File Locations (Quick Reference)

### Root Files
```
├── README.md                 # Project overview and getting started
├── package.json             # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
├── index.html               # Main app entry point
├── vehicles-test.html       # Vehicle testing page
└── AGENTS.md               # Repository guidelines for contributors
```

### Key Directories
```
├── .github/workflows/       # CI/CD pipeline definitions
├── config/                  # Application configuration files
├── docs/                    # Development documentation
├── specs/                   # Architectural and domain specifications  
├── src/core/               # Rendering engine and camera system
├── src/terrain/            # Procedural terrain generation
├── src/fire/               # Fire simulation and visualization
├── src/roads/              # Road building and A* pathfinding
├── src/vehicles/           # Vehicle management and behavior
├── src/ui/                 # Debug interface and console
└── src/__tests__/          # Test suite (79 tests)
```

## Troubleshooting

### Common Issues
- **Port conflicts**: Dev server auto-retries on different ports (5174, 5175, etc.)
- **Type errors**: 7 known development-related errors, CI allows warnings
- **WebGL warnings**: Expected in headless/software rendering environments
- **Chunk size warnings**: Expected due to Three.js bundle size, non-blocking

### Performance Issues
- Check browser supports WebGL 2.0
- Monitor debug UI performance stats (target 15-60 FPS)
- Verify instanced rendering is being used for repeated objects
- Check for per-frame allocations in hot paths

### Build Failures
- Clear `node_modules` and run `npm install` again
- Check Node.js version (18+ required, 20 recommended)
- Verify all required files exist (especially in `config/` directory)
- Check TypeScript errors don't prevent compilation

Remember: This is a performance-critical real-time 3D application. Always test your changes in browser and verify frame rate remains acceptable.