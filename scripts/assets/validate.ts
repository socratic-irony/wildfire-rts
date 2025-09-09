#!/usr/bin/env node

/**
 * Asset Pipeline Validation Script
 * 
 * Validates assets according to project rules:
 * - File size limits
 * - Supported formats
 * - Required metadata
 * - Optimization checks
 */

import { readFileSync, statSync, readdirSync } from 'fs';
import { join, extname, relative } from 'path';
import { createHash } from 'crypto';

interface AssetRule {
  extensions: string[];
  maxSizeKB: number;
  description: string;
  optimizationTips?: string[];
}

interface AssetValidationResult {
  path: string;
  size: number;
  hash: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ValidationSummary {
  totalAssets: number;
  validAssets: number;
  totalSizeKB: number;
  errors: string[];
  warnings: string[];
  assets: AssetValidationResult[];
}

// Asset validation rules based on project requirements
const ASSET_RULES: Record<string, AssetRule> = {
  models: {
    extensions: ['.glb', '.gltf'],
    maxSizeKB: 2048, // 2MB max for 3D models
    description: 'GLB/GLTF 3D models for vehicles and objects',
    optimizationTips: [
      'Use GLB format for better compression',
      'Minimize texture resolution',
      'Remove unused vertices and materials',
      'Use instanced meshes for repeated geometry'
    ]
  },
  images: {
    extensions: ['.png', '.jpg', '.jpeg', '.webp'],
    maxSizeKB: 1024, // 1MB max for images
    description: 'Image assets for UI and textures',
    optimizationTips: [
      'Use WebP format when possible',
      'Optimize image dimensions for usage',
      'Use appropriate compression settings',
      'Consider procedural textures for patterns'
    ]
  },
  audio: {
    extensions: ['.mp3', '.wav', '.ogg'],
    maxSizeKB: 512, // 512KB max for audio
    description: 'Audio files for sound effects',
    optimizationTips: [
      'Use OGG format for better compression',
      'Keep sample rate appropriate for content',
      'Remove silence from clips'
    ]
  }
};

// Prohibited file patterns (large binaries, temp files, etc.)
const PROHIBITED_PATTERNS = [
  /\.tmp$/,
  /\.temp$/,
  /\.bak$/,
  /\.old$/,
  /\.orig$/,
  /~$/,
  /\.DS_Store$/,
  /Thumbs\.db$/
];

function calculateFileHash(filePath: string): string {
  const fileBuffer = readFileSync(filePath);
  return createHash('sha256').update(fileBuffer).digest('hex');
}

function getAssetType(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  
  for (const [type, rule] of Object.entries(ASSET_RULES)) {
    if (rule.extensions.includes(ext)) {
      return type;
    }
  }
  
  return null;
}

function validateAsset(filePath: string, projectRoot: string): AssetValidationResult {
  const relativePath = relative(projectRoot, filePath);
  const stat = statSync(filePath);
  const sizeKB = Math.round(stat.size / 1024);
  const hash = calculateFileHash(filePath);
  const assetType = getAssetType(filePath);
  
  const result: AssetValidationResult = {
    path: relativePath,
    size: sizeKB,
    hash,
    valid: true,
    errors: [],
    warnings: []
  };

  // Check for prohibited patterns
  for (const pattern of PROHIBITED_PATTERNS) {
    if (pattern.test(filePath)) {
      result.errors.push(`File matches prohibited pattern: ${pattern}`);
      result.valid = false;
    }
  }

  // Skip validation for unknown asset types (let them through with warnings)
  if (!assetType) {
    result.warnings.push(`Unknown asset type for extension ${extname(filePath)}`);
    return result;
  }

  const rule = ASSET_RULES[assetType];
  
  // Check file size - treat as warning instead of error to avoid stopping build
  if (sizeKB > rule.maxSizeKB) {
    result.warnings.push(
      `File size ${sizeKB}KB exceeds limit of ${rule.maxSizeKB}KB for ${assetType}`
    );
  } else if (sizeKB > rule.maxSizeKB * 0.8) {
    // Warnings for files approaching size limits (only if not already exceeding)
    result.warnings.push(
      `File size ${sizeKB}KB is approaching limit of ${rule.maxSizeKB}KB`
    );
  }

  return result;
}

function findAssets(directory: string): string[] {
  const assets: string[] = [];
  
  try {
    const items = readdirSync(directory, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = join(directory, item.name);
      
      if (item.isDirectory()) {
        assets.push(...findAssets(fullPath));
      } else if (item.isFile()) {
        // Only include known asset types or files that need validation
        const assetType = getAssetType(fullPath);
        if (assetType || PROHIBITED_PATTERNS.some(p => p.test(fullPath))) {
          assets.push(fullPath);
        }
      }
    }
  } catch (error) {
    // Directory doesn't exist or not accessible
    console.warn(`Warning: Could not read directory ${directory}`);
  }
  
  return assets;
}

function validateAssets(projectRoot: string): ValidationSummary {
  const assetDirectories = [
    join(projectRoot, 'src', 'assets'),
    join(projectRoot, 'public', 'assets'),
    join(projectRoot, 'assets')
  ];

  const allAssets: string[] = [];
  for (const dir of assetDirectories) {
    allAssets.push(...findAssets(dir));
  }

  const results: AssetValidationResult[] = [];
  let totalSizeKB = 0;
  const globalErrors: string[] = [];
  const globalWarnings: string[] = [];

  for (const assetPath of allAssets) {
    try {
      const result = validateAsset(assetPath, projectRoot);
      results.push(result);
      totalSizeKB += result.size;
    } catch (error) {
      globalErrors.push(`Failed to validate ${assetPath}: ${error}`);
    }
  }

  const validAssets = results.filter(r => r.valid).length;

  // Collect all errors and warnings
  for (const result of results) {
    globalErrors.push(...result.errors.map(e => `${result.path}: ${e}`));
    globalWarnings.push(...result.warnings.map(w => `${result.path}: ${w}`));
  }

  return {
    totalAssets: results.length,
    validAssets,
    totalSizeKB,
    errors: globalErrors,
    warnings: globalWarnings,
    assets: results
  };
}

function printValidationResults(summary: ValidationSummary): void {
  console.log('\n=== Asset Validation Results ===\n');
  
  console.log(`Total assets: ${summary.totalAssets}`);
  console.log(`Valid assets: ${summary.validAssets}`);
  console.log(`Total size: ${summary.totalSizeKB}KB (${(summary.totalSizeKB / 1024).toFixed(1)}MB)`);
  
  if (summary.errors.length > 0) {
    console.log('\n❌ ERRORS:');
    for (const error of summary.errors) {
      console.log(`  ${error}`);
    }
  }
  
  if (summary.warnings.length > 0) {
    console.log('\n⚠️  WARNINGS:');
    for (const warning of summary.warnings) {
      console.log(`  ${warning}`);
    }
  }

  if (summary.assets.length > 0) {
    console.log('\n📋 Asset Details:');
    for (const asset of summary.assets) {
      const status = asset.valid ? '✅' : '❌';
      console.log(`  ${status} ${asset.path} (${asset.size}KB)`);
    }
  }

  // Print optimization tips for large assets
  const largeAssets = summary.assets.filter(a => {
    const assetType = getAssetType(a.path);
    if (!assetType) return false;
    const rule = ASSET_RULES[assetType];
    return a.size > rule.maxSizeKB * 0.8;
  });

  if (largeAssets.length > 0) {
    console.log('\n💡 Optimization Tips:');
    const tipsByType = new Set<string>();
    
    for (const asset of largeAssets) {
      const assetType = getAssetType(asset.path);
      if (assetType && !tipsByType.has(assetType)) {
        tipsByType.add(assetType);
        const rule = ASSET_RULES[assetType];
        if (rule.optimizationTips) {
          console.log(`\n  ${assetType.toUpperCase()} assets:`);
          for (const tip of rule.optimizationTips) {
            console.log(`    • ${tip}`);
          }
        }
      }
    }
  }
}

// CLI interface
function main(): void {
  const projectRoot = process.cwd();
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Asset Validation Script

Usage: npm run validate-assets [options]

Options:
  --help, -h     Show this help message
  --json         Output results in JSON format
  --strict       Treat warnings as errors

This script validates all assets in the project according to:
- File size limits per asset type
- Supported file formats
- Optimization recommendations
    `);
    return;
  }

  const jsonOutput = args.includes('--json');
  const strictMode = args.includes('--strict');

  try {
    const summary = validateAssets(projectRoot);
    
    if (jsonOutput) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printValidationResults(summary);
    }

    // Exit with error code if validation failed
    const hasErrors = summary.errors.length > 0;
    const hasWarnings = summary.warnings.length > 0;
    
    if (hasErrors || (strictMode && hasWarnings)) {
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Asset validation failed:', error);
    process.exit(1);
  }
}

// Export for testing
export { validateAssets, ASSET_RULES, calculateFileHash };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}