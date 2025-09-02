# Contributing to Wildfire RTS

Thank you for your interest in contributing to Wildfire RTS! This guide will help you get started with contributing to this real-time wildfire simulation and RTS game project.

## Before You Start

1. **Read the architecture documentation** in [`specs/architecture.md`](specs/architecture.md) - this is the source of truth for the project structure and patterns.
2. **Review the repository guidelines** in [`AGENTS.md`](AGENTS.md) for coding standards, commit conventions, and development practices.
3. **Check existing issues** to see if your bug report or feature request already exists.

## Development Setup

### Prerequisites
- Node.js (LTS version recommended)
- npm
- Modern web browser with WebGL support

### Installation
```bash
git clone https://github.com/socratic-irony/wildfire-rts.git
cd wildfire-rts
npm install
```

### Development Commands
```bash
npm run dev      # Start Vite dev server with hot reload
npm run build    # Production build to dist/
npm run preview  # Serve built app locally
npm run test     # Run tests (when configured)
```

## Project Structure

- **`src/`** - TypeScript source code
  - `core/` - Renderer, scene, camera, input, loop
  - `terrain/` - Heightmap, mesh, materials, biomes  
  - `fire/` - Fire simulation, grid, visualization
  - `roads/` - Road pathfinding, visualization, state
  - `vehicles/` - Vehicle management and behavior
  - `ui/` - Debug UI and controls
- **`specs/`** - Technical specifications and documentation
- **`docs/`** - User and contributor documentation
- **`AGENTS.md`** - Repository guidelines and coding standards

## How to Contribute

### Reporting Bugs

1. Check existing issues first
2. Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
3. Include:
   - Clear reproduction steps
   - Expected vs actual behavior
   - Screenshots/videos if applicable
   - Browser/OS information
   - Performance impact if relevant

### Suggesting Features

1. Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
2. Include:
   - Problem statement and use case
   - Proposed solution
   - Implementation considerations
   - Acceptance criteria

### Making Code Changes

#### Before You Code
1. **Read the relevant specs** in `specs/` directory
2. **Create or comment on an issue** to discuss your approach
3. **Fork the repository** and create a feature branch

#### Development Workflow
1. **Create a branch** from `main` with a descriptive name:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-number-description
   ```

2. **Make your changes**:
   - Follow the coding style in [`AGENTS.md`](AGENTS.md)
   - Write clean, documented TypeScript
   - Keep changes focused and minimal
   - Avoid per-frame allocations in hot paths

3. **Test your changes**:
   ```bash
   npm run build    # Ensure no build errors
   npm run test     # Run tests (when available)
   ```

4. **Update documentation**:
   - Update relevant spec files in `specs/`
   - Add/update comments for complex logic
   - Update this guide if you change workflows

5. **Commit your changes**:
   - Use conventional commit messages
   - Reference issues: `feat(core): add RTS camera rig (#123)`
   - Keep commits focused and atomic

#### Pull Request Process

1. **Update specs first** - Before submitting, ensure `specs/` files reflect your changes
2. **Use the PR template** - Fill out all relevant sections
3. **Include visuals** - Screenshots/videos for UI changes, performance metrics if relevant
4. **Keep it focused** - One logical change per PR
5. **Respond to feedback** - Be open to suggestions and iterate

### Code Style Guidelines

- **Language**: TypeScript with strict mode enabled
- **Formatting**: Use existing patterns (Prettier/ESLint planned)
- **Naming**:
  - Files: lowercase with dashes (e.g., `heightmap.ts`)
  - Types/Interfaces: PascalCase (e.g., `Heightmap`, `NoiseConfig`)
  - Functions/variables: camelCase
  - Constants: UPPER_SNAKE_CASE
- **Performance**: 
  - Reuse materials and geometry
  - Prefer `InstancedMesh` for repeated objects
  - Avoid allocations in update loops
  - Use object pools for frequently created/destroyed objects

### Spec Hygiene (Required)

Before every commit that changes behavior:
1. **Update the relevant spec(s)** in `specs/` directory
2. **Mark what's implemented vs planned** in Status sections
3. **Document API changes** and rationale
4. **Do not leave specs outdated** - this breaks the development workflow

## Areas for Contribution

### Good First Issues
- Documentation improvements
- UI/UX enhancements
- Performance optimizations
- Test coverage
- Bug fixes in non-critical paths

### Advanced Areas
- Fire simulation improvements
- Terrain generation enhancements  
- Vehicle AI and pathfinding
- Graphics and shader work
- Architecture and performance

### Current Priorities
Check the [project roadmap](docs/roadmap.md) and open issues for current priorities.

## Performance Considerations

This is a real-time simulation with performance requirements:
- **Target**: Smooth 60fps with complex scenes
- **Hot paths**: Fire simulation, vehicle updates, rendering
- **Memory**: Avoid garbage collection in update loops  
- **Profiling**: Use browser dev tools to measure impact

## Testing

- **Unit tests**: Focus on math-heavy code (terrain, fire simulation, pathfinding)
- **Integration tests**: Test system interactions
- **Performance tests**: Validate frame rates and memory usage
- **Manual testing**: Exercise new features thoroughly

## Getting Help

- **Documentation**: Start with `specs/architecture.md` and `AGENTS.md`
- **Issues**: Ask questions on relevant GitHub issues
- **Code**: Look at existing implementations for patterns

## Recognition

Contributors who make significant improvements will be recognized in:
- Release notes
- Documentation credits
- Project README

---

By contributing, you agree to license your contributions under the same license as this project.

Thank you for helping make Wildfire RTS better! 🔥🚗🏞️