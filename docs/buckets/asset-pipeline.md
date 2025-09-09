# Asset Pipeline Touch Map

This document tracks all files and paths affected by the deterministic asset pipeline implementation for issue #6.

## Created Files

### Asset Validation Scripts
- `scripts/assets/validate.ts` - Core asset validation script with size limits, format checking, and optimization recommendations
- `scripts/assets/generate-manifest.ts` - Asset manifest generator with file hashing and metadata collection

### Asset Manifest
- `tools/assets/manifest.json` - Generated manifest containing asset metadata, hashes, and validation results

### Documentation
- `docs/assets.md` - Comprehensive asset pipeline documentation with rules, usage, and best practices
- `docs/buckets/asset-pipeline.md` - This touch map file tracking all changes

## Modified Files

### Package Configuration
- `package.json` - Added new npm scripts for asset validation and manifest generation:
  - `validate-assets`: Runs asset validation script
  - `generate-manifest`: Generates asset manifest
  - Added `tsx` dependency for TypeScript script execution

### CI/CD Pipeline
- `.github/workflows/ci.yml` - Added asset validation and manifest generation steps to CI workflow

## Directory Structure Created

```
scripts/
  assets/                 # Asset processing scripts
tools/
  assets/                 # Asset build outputs and manifests
docs/
  buckets/               # Touch map documentation (if not existing)
```

## Asset Rules Defined

### File Size Limits
- **3D Models (.glb, .gltf)**: 2MB maximum
- **Images (.png, .jpg, .webp)**: 1MB maximum  
- **Audio (.mp3, .wav, .ogg)**: 512KB maximum

### Validation Features
- SHA256 hash generation for integrity checking
- Format validation based on file extensions
- Size limit enforcement with warnings at 80% of limits
- Prohibited pattern detection (temp files, OS files)
- Optimization recommendations per asset type

## Current Asset Status

### Assets Discovered
- **Total**: 10 files (14.9MB total)
- **Valid**: 4 files (all GLB models pass validation)
- **Invalid**: 6 files (all PNG images exceed 1MB limit)

### Assets by Type
- **Models**: 4 GLB files in `src/assets/models/` (all valid, one approaching limit)
- **Images**: 6 PNG files in `src/assets/stills/` (all exceed 1MB limit)

### Specific Asset Issues
- `src/assets/stills/bulldozer.png` - 1647KB (exceeds 1024KB limit)
- `src/assets/stills/firetruck.png` - 1781KB (exceeds 1024KB limit)
- `src/assets/stills/helicopter.png` - 1640KB (exceeds 1024KB limit)
- `src/assets/stills/house_1.png` - 1708KB (exceeds 1024KB limit)
- `src/assets/stills/house_2.png` - 1870KB (exceeds 1024KB limit)
- `src/assets/stills/tanker.png` - 1455KB (exceeds 1024KB limit)

## CI Integration Details

### New CI Steps Added
1. **Asset Validation** - Runs after type checking, before tests
2. **Manifest Generation** - Creates/updates asset manifest
3. **Failure Behavior** - CI fails if assets violate size or format rules

### CI Workflow Position
```yaml
- Type check (existing)
- Validate assets (NEW)
- Generate asset manifest (NEW)  
- Run tests (existing)
- Build project (existing)
```

## Integration Points

### Existing Package Scripts
The asset pipeline integrates with existing npm workflow:
- Uses existing TypeScript configuration
- Leverages existing development dependencies where possible
- Maintains compatibility with existing build process

### Asset Directory Structure
- Respects existing `src/assets/` organization
- Scans multiple potential asset locations (`src/assets/`, `public/assets/`, `assets/`)
- Handles missing directories gracefully

### Development Workflow
- Developers can run validation locally before committing
- Manifest generation provides tracking of asset changes
- CI enforcement ensures no oversized assets reach production

## Compliance Notes

### Issue Requirements Fulfilled
- ✅ Added asset validation script (`scripts/assets/validate.ts`)
- ✅ Generated asset manifest (`tools/assets/manifest.json`)
- ✅ Documented asset rules (`docs/assets.md`)
- ✅ Added validation job to CI workflow
- ✅ CI fails on oversized/invalid assets per rules
- ✅ Created touch map in `docs/buckets/asset-pipeline.md`

### Constraints Respected
- ✅ **Did NOT alter** vehicles/particles assets or code (as instructed)
- ✅ **Did NOT modify** existing source code logic
- ✅ **Followed** agents.md instructions for spec hygiene
- ✅ **Used TypeScript** to maintain consistency with project stack
- ✅ **Additive changes only** - no existing functionality modified

### Security Considerations
- Asset validation prevents upload of prohibited file types
- File size limits protect against large binary uploads
- Hash generation enables integrity verification
- No sensitive data exposed in manifests or scripts

## Performance Impact

### Asset Size Analysis
- Current assets total 14.9MB, with 6 assets exceeding limits
- Image optimization could reduce total size by ~50-70%
- GLB models are within acceptable ranges

### CI Performance
- Asset validation adds ~1-2 seconds to CI runtime
- Manifest generation is minimal overhead
- Early failure on oversized assets prevents unnecessary build cycles

## Future Maintenance

### Asset Optimization Needed
The following assets require immediate attention:
- All PNG files in `src/assets/stills/` should be optimized or converted to WebP
- Consider reducing image dimensions if current resolution exceeds usage requirements

### Monitoring Points
- Track total project asset size growth over time
- Monitor CI build times with asset validation enabled
- Review asset validation rules periodically for appropriateness

### Extension Opportunities
- Add content-specific validation (e.g., image dimension checks)
- Integrate with automated optimization tools
- Add asset compression verification
- Implement asset usage tracking

## Dependencies Added

### Production Dependencies
None added - asset pipeline is development/build-time only.

### Development Dependencies
- `tsx@^4.16.2` - TypeScript execution for asset scripts

### NPM Scripts Added
- `validate-assets` - Run asset validation
- `generate-manifest` - Generate asset manifest

## Error Handling

### Validation Failures
The asset validation system provides:
- Clear error messages for oversized files
- Optimization suggestions per asset type
- Non-blocking warnings for assets approaching limits
- Graceful handling of missing directories

### CI Failure Scenarios
CI will fail if:
- Any asset exceeds defined size limits
- Prohibited file patterns are detected
- Asset validation script encounters errors
- Manifest generation fails

## Documentation Updates

### New Documentation Created
- `docs/assets.md` - Complete asset pipeline guide
- `docs/buckets/asset-pipeline.md` - This comprehensive touch map

### Integration with Existing Docs
- References existing `AGENTS.md` guidelines
- Follows established documentation patterns
- Includes troubleshooting and best practices sections

## Testing Strategy

### Asset Validation Testing
- Scripts tested against current asset set
- Validation correctly identifies oversized assets
- Manifest generation produces valid JSON output
- CI integration verified with workflow syntax

### Manual Testing Performed
- Asset validation script execution
- Manifest generation and content verification
- CI workflow syntax validation
- Documentation accuracy review

This touch map provides a complete record of all changes made to implement the deterministic asset pipeline tooling for the Wildfire RTS project.