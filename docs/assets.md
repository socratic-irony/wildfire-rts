# Asset Pipeline Documentation

## Overview

The Wildfire RTS project uses a deterministic asset pipeline to ensure safe asset import, verification, and optimization. This system provides automated validation, manifest generation, and CI integration to maintain asset quality and performance standards.

## Asset Types and Rules

### 3D Models (`models`)
- **Extensions**: `.glb`, `.gltf`
- **Size Limit**: 2MB (2048KB)
- **Description**: 3D models for vehicles, buildings, and environmental objects
- **Preferred Format**: GLB for better compression and loading performance

**Optimization Guidelines:**
- Use GLB format instead of GLTF for reduced file size
- Minimize texture resolution while maintaining visual quality
- Remove unused vertices, materials, and animations
- Use instanced meshes for repeated geometry
- Apply appropriate LOD (Level of Detail) strategies

### Images (`images`)
- **Extensions**: `.png`, `.jpg`, `.jpeg`, `.webp`
- **Size Limit**: 1MB (1024KB)
- **Description**: UI elements, textures, thumbnails, and reference images
- **Preferred Format**: WebP for optimal compression

**Optimization Guidelines:**
- Use WebP format when browser compatibility allows
- Optimize image dimensions for actual usage context
- Use appropriate compression settings for content type
- Consider procedural textures for repetitive patterns
- Implement responsive image loading for different screen densities

### Audio (`audio`)
- **Extensions**: `.mp3`, `.wav`, `.ogg`
- **Size Limit**: 512KB
- **Description**: Sound effects, ambient audio, and UI feedback sounds
- **Preferred Format**: OGG Vorbis for best compression

**Optimization Guidelines:**
- Use OGG format for better compression than MP3
- Keep sample rate appropriate for content (44.1kHz for music, 22kHz for effects)
- Remove silence from beginning and end of clips
- Use mono audio where stereo is not necessary

## Asset Validation System

### Validation Script

The asset validation system is implemented in `scripts/assets/validate.ts` and provides:

- **File Size Checking**: Ensures assets stay within defined limits
- **Format Validation**: Verifies file extensions match supported types
- **Hash Generation**: Creates SHA256 hashes for integrity checking
- **Optimization Warnings**: Alerts when assets approach size limits

### Usage

```bash
# Validate all assets
npm run validate-assets

# Validate with JSON output
npm run validate-assets -- --json

# Strict mode (treat warnings as errors)
npm run validate-assets -- --strict
```

### Validation Rules

The validation system enforces the following rules:

1. **Size Limits**: Each asset type has a maximum file size to ensure performance
2. **Format Restrictions**: Only approved file formats are allowed
3. **Prohibited Patterns**: Temporary files, backups, and OS-specific files are rejected
4. **Optimization Warnings**: Assets approaching size limits trigger warnings

## Asset Manifest System

### Manifest Generation

The asset manifest (`tools/assets/manifest.json`) contains:

- **Asset Metadata**: File paths, sizes, and types
- **Integrity Hashes**: SHA256 hashes for verification
- **Validation Results**: Status of each asset against rules
- **Generation Timestamp**: When the manifest was created

### Usage

```bash
# Generate manifest
npm run generate-manifest

# Generate to custom location
npm run generate-manifest -- --output path/to/manifest.json
```

### Manifest Structure

```json
{
  "version": "1.0.0",
  "generatedAt": "2025-09-09T04:53:13.800Z",
  "totalAssets": 10,
  "totalSizeKB": 15287,
  "validationSummary": {
    "valid": 4,
    "errors": 6,
    "warnings": 7
  },
  "assets": {
    "src/assets/models/vehicle.glb": {
      "path": "src/assets/models/vehicle.glb",
      "size": 1500,
      "hash": "sha256-hash-here",
      "type": "models",
      "valid": true,
      "errors": [],
      "warnings": []
    }
  },
  "rules": {
    // Asset type rules and limits
  }
}
```

## CI Integration

### Asset Validation Job

The CI pipeline includes an asset validation job that:

1. **Validates All Assets**: Runs validation on every commit
2. **Fails on Errors**: Blocks merges if assets violate rules
3. **Updates Manifest**: Regenerates manifest for tracking changes
4. **Provides Feedback**: Shows detailed validation results in CI logs

### Pipeline Integration

Asset validation is integrated into the existing CI workflow (`.github/workflows/ci.yml`) as an additional step that runs alongside tests and builds.

## Directory Structure

```
scripts/
  assets/
    validate.ts           # Asset validation script
    generate-manifest.ts  # Manifest generation script

tools/
  assets/
    manifest.json        # Generated asset manifest

src/
  assets/
    models/             # 3D model files (.glb, .gltf)
    stills/             # Image files (.png, .jpg, .webp)
    audio/              # Audio files (.mp3, .wav, .ogg)

docs/
  assets.md             # This documentation
  buckets/
    asset-pipeline.md   # Touch map for asset pipeline changes
```

## Asset Workflow

### For Developers

1. **Add Assets**: Place new assets in appropriate `src/assets/` subdirectories
2. **Validate Locally**: Run `npm run validate-assets` before committing
3. **Optimize if Needed**: Follow optimization guidelines for oversized assets
4. **Commit Changes**: Include both assets and updated manifest if generated

### For CI/CD

1. **Automatic Validation**: CI runs validation on every push/PR
2. **Manifest Updates**: Manifest is regenerated and checked for changes
3. **Failure Handling**: Builds fail if validation errors are found
4. **Artifact Upload**: Valid manifests and build artifacts are preserved

## Current Asset Status

Based on the latest validation (as of manifest generation):

- **Total Assets**: 10 files
- **Total Size**: 14.9MB
- **Valid Assets**: 4/10 (GLB models pass, PNG images exceed limits)
- **Issues**: PNG images in `src/assets/stills/` exceed 1MB limit

### Immediate Actions Needed

The current PNG assets in `src/assets/stills/` need optimization:
- Convert to WebP format for better compression
- Reduce image dimensions if higher resolution isn't necessary
- Apply compression optimizations

## Best Practices

### Asset Organization

- **Consistent Naming**: Use lowercase, descriptive filenames
- **Logical Grouping**: Organize by asset type and usage context
- **Version Control**: Don't commit temporary or generated files
- **Documentation**: Update this guide when adding new asset types

### Performance Considerations

- **Bundle Size**: Keep total asset size reasonable for web delivery
- **Loading Strategy**: Implement progressive loading for large assets
- **Caching**: Use asset hashes for cache invalidation strategies
- **Compression**: Always use the most efficient format for each asset type

### Security Considerations

- **File Type Validation**: Only allow known, safe file formats
- **Size Limits**: Prevent upload of extremely large files
- **Content Scanning**: Consider implementing content validation for sensitive projects
- **Access Control**: Ensure asset directories have appropriate permissions

## Troubleshooting

### Common Issues

1. **"File size exceeds limit"**: Optimize the asset or adjust rules if justified
2. **"Unknown asset type"**: Add the file extension to the rules configuration
3. **"Validation failed"**: Check file permissions and accessibility
4. **"Manifest generation failed"**: Ensure tools directory exists and is writable

### Debug Commands

```bash
# Detailed validation output
npm run validate-assets -- --json | jq '.'

# Check specific asset
ls -la src/assets/models/myfile.glb

# Verify file hash
sha256sum src/assets/models/myfile.glb
```

## Extension Points

### Adding New Asset Types

1. Update `ASSET_RULES` in `scripts/assets/validate.ts`
2. Add file extension mappings in both scripts
3. Update this documentation with new rules
4. Test validation with sample files

### Custom Validation Rules

The validation system can be extended with:
- Content-specific validation (e.g., image dimension checks)
- Format-specific optimizations (e.g., GLB compression verification)
- Project-specific constraints (e.g., naming conventions)
- Integration with external optimization tools

## Maintenance

### Regular Tasks

- **Review Asset Sizes**: Monitor total project asset size growth
- **Update Rules**: Adjust limits based on performance requirements
- **Tool Updates**: Keep validation scripts current with project needs
- **Documentation**: Update this guide when rules or processes change

### Monitoring

- **CI Reports**: Regular review of validation failures and warnings
- **Size Trends**: Track asset size growth over time
- **Performance Impact**: Monitor how asset changes affect application performance
- **Optimization Opportunities**: Identify assets that could benefit from further optimization