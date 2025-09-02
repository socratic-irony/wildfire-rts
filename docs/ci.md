# CI/CD Pipeline Documentation

## Overview

The wildfire-rts project uses GitHub Actions for continuous integration and deployment. The pipeline ensures code quality, runs tests, and manages releases automatically.

## Workflows

### CI Workflow (`.github/workflows/ci.yml`)

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests targeting `main` or `develop` branches

**Matrix Strategy:**
- Tests against Node.js versions 18 and 20
- Ensures compatibility across supported Node.js LTS versions

**Steps:**
1. **Checkout**: Gets the latest code
2. **Setup Node.js**: Installs the specified Node.js version with npm caching
3. **Install Dependencies**: Runs `npm ci` for clean, reproducible installs
4. **Type Check**: Runs `tsc --noEmit --skipLibCheck` for TypeScript validation (non-blocking)
5. **Run Tests**: Executes the test suite via `npm test`
6. **Build Project**: Creates production build via `npm run build`
7. **Upload Artifacts**: (Main branch only, Node 20) Uploads build artifacts for 30 days
8. **Upload Test Results**: Uploads test results and coverage (if available)

**Caching:**
- npm cache is automatically handled by `actions/setup-node@v4`
- Improves build times by reusing dependencies when `package-lock.json` hasn't changed

### Release Workflow (`.github/workflows/release.yml`)

**Triggers:**
- Git tags matching `v*` pattern (e.g., `v1.0.0`, `v2.1.0-beta`)

**Steps:**
1. **Checkout & Setup**: Same as CI workflow
2. **Quality Gates**: Runs tests and build to ensure release quality
3. **Create Archive**: Packages build artifacts into a `.tar.gz` file
4. **Generate Changelog**: Creates release notes with build metadata
- Uses modern `softprops/action-gh-release@v2` for reliable release creation
- Automatically attaches build archive to the release
- Supports both regular and pre-release tagging

**Pre-release Detection:**
- Automatically marks releases as pre-release if tag contains `alpha`, `beta`, or `rc`

## Local Development Integration

### Running CI Checks Locally

Before pushing, you can run the same checks locally:

```bash
# Install dependencies
npm ci

# Type checking (non-blocking, may show warnings)
npx tsc --noEmit --skipLibCheck

# Run tests
npm test

# Build project
npm run build
```

### Coverage and Test Results

The CI pipeline uploads test results and coverage data (when available). Test coverage can be configured by:

1. Adding coverage configuration to `vitest.config.ts`
2. Installing coverage dependencies
3. Updating the CI workflow to generate and upload coverage reports

## Status Checks and Branch Protection

### Recommended Branch Protection Rules

While not configured automatically, the following branch protection rules are recommended for the main branch:

- **Require status checks to pass before merging**
- **Required status checks**: `build-and-test (18)`, `build-and-test (20)`
- **Require branches to be up to date before merging**
- **Require pull request reviews before merging**
- **Dismiss stale pull request reviews when new commits are pushed**

### Setting Up Branch Protection

1. Go to repository Settings → Branches
2. Add rule for `main` branch
3. Enable "Require status checks to pass before merging"
4. Select the required checks from the CI workflow jobs
5. Save the protection rule

## Troubleshooting

### Common CI Failures

**TypeScript Errors:**
- Check `tsc --noEmit --skipLibCheck` output
- Ensure all dependencies have proper type definitions
- Fix type errors before pushing

**Test Failures:**
- Run `npm test` locally to reproduce
- Check test output in CI logs
- Verify test environment matches local setup

**Build Failures:**
- Run `npm run build` locally
- Check for missing dependencies or configuration issues
- Review Vite build output and warnings

### Performance Optimization

- **Dependency Caching**: Automatically enabled via `actions/setup-node@v4`
- **Parallel Matrix Jobs**: Runs Node 18 and 20 tests in parallel
- **Conditional Artifact Upload**: Only uploads from main branch with latest Node version
- **Retention Policies**: Build artifacts kept for 30 days, test results for 5 days

## Monitoring and Maintenance

- **Workflow Status**: Monitor via GitHub Actions tab
- **Dependency Updates**: Regularly update action versions and Node.js versions in matrix
- **Performance Metrics**: Track build times and optimize as needed
- **Security**: Keep action versions up to date, use specific versions rather than latest

## Integration with Project Workflow

This CI/CD setup integrates with the existing project structure:
- Uses existing `package.json` scripts (`build`, `test`, `dev`, `preview`)
- Respects existing TypeScript configuration in `tsconfig.json`
- Works with current Vite + Vitest setup
- Maintains separation from vehicles and particles branches as requested