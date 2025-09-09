#!/usr/bin/env node

/**
 * Asset Manifest Generator
 * 
 * Generates a manifest file containing metadata for all project assets:
 * - File paths and sizes
 * - SHA256 hashes for integrity checking
 * - Asset types and validation status
 * - Generation timestamp
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { validateAssets } from './validate.js';

interface AssetManifest {
  version: string;
  generatedAt: string;
  projectRoot: string;
  totalAssets: number;
  totalSizeKB: number;
  validationSummary: {
    valid: number;
    errors: number;
    warnings: number;
  };
  assets: Record<string, {
    path: string;
    size: number;
    hash: string;
    type: string | null;
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>;
  rules: {
    [assetType: string]: {
      extensions: string[];
      maxSizeKB: number;
      description: string;
    };
  };
}

function getAssetType(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  
  // This mirrors the logic from validate.ts
  const typeMap: Record<string, string> = {
    'glb': 'models',
    'gltf': 'models',
    'png': 'images',
    'jpg': 'images',
    'jpeg': 'images',
    'webp': 'images',
    'mp3': 'audio',
    'wav': 'audio',
    'ogg': 'audio'
  };
  
  return typeMap[ext] || null;
}

function generateManifest(projectRoot: string): AssetManifest {
  console.log('🔍 Scanning assets...');
  const validationResults = validateAssets(projectRoot);
  
  console.log('📝 Generating manifest...');
  
  const assets: AssetManifest['assets'] = {};
  
  for (const asset of validationResults.assets) {
    assets[asset.path] = {
      path: asset.path,
      size: asset.size,
      hash: asset.hash,
      type: getAssetType(asset.path),
      valid: asset.valid,
      errors: asset.errors,
      warnings: asset.warnings
    };
  }

  const manifest: AssetManifest = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    projectRoot,
    totalAssets: validationResults.totalAssets,
    totalSizeKB: validationResults.totalSizeKB,
    validationSummary: {
      valid: validationResults.validAssets,
      errors: validationResults.errors.length,
      warnings: validationResults.warnings.length
    },
    assets,
    rules: {
      models: {
        extensions: ['.glb', '.gltf'],
        maxSizeKB: 2048,
        description: 'GLB/GLTF 3D models for vehicles and objects'
      },
      images: {
        extensions: ['.png', '.jpg', '.jpeg', '.webp'],
        maxSizeKB: 1024,
        description: 'Image assets for UI and textures'
      },
      audio: {
        extensions: ['.mp3', '.wav', '.ogg'],
        maxSizeKB: 512,
        description: 'Audio files for sound effects'
      }
    }
  };

  return manifest;
}

function writeManifest(manifest: AssetManifest, outputPath: string): void {
  console.log(`📄 Writing manifest to ${outputPath}...`);
  
  // Ensure output directory exists
  mkdirSync(dirname(outputPath), { recursive: true });
  
  // Write manifest with pretty formatting
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
  
  console.log('✅ Manifest generated successfully');
  console.log(`   Total assets: ${manifest.totalAssets}`);
  console.log(`   Total size: ${manifest.totalSizeKB}KB (${(manifest.totalSizeKB / 1024).toFixed(1)}MB)`);
  console.log(`   Valid assets: ${manifest.validationSummary.valid}/${manifest.totalAssets}`);
  
  if (manifest.validationSummary.errors > 0) {
    console.log(`   ❌ Errors: ${manifest.validationSummary.errors}`);
  }
  
  if (manifest.validationSummary.warnings > 0) {
    console.log(`   ⚠️  Warnings: ${manifest.validationSummary.warnings}`);
  }
}

// CLI interface
function main(): void {
  const args = process.argv.slice(2);
  const projectRoot = process.cwd();
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Asset Manifest Generator

Usage: npm run generate-manifest [options]

Options:
  --help, -h          Show this help message
  --output <path>     Output path for manifest (default: tools/assets/manifest.json)

This script generates a manifest file containing metadata for all project assets
including file hashes, sizes, types, and validation results.
    `);
    return;
  }

  // Parse output path
  const outputIndex = args.indexOf('--output');
  const defaultOutput = join(projectRoot, 'tools', 'assets', 'manifest.json');
  const outputPath = outputIndex >= 0 && args[outputIndex + 1] 
    ? join(projectRoot, args[outputIndex + 1])
    : defaultOutput;

  try {
    const manifest = generateManifest(projectRoot);
    writeManifest(manifest, outputPath);
    
    // Exit with error if there are validation errors
    if (manifest.validationSummary.errors > 0) {
      console.error('\n❌ Manifest generated with validation errors');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Failed to generate manifest:', error);
    process.exit(1);
  }
}

// Export for testing
export { generateManifest, writeManifest };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}