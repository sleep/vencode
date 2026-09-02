#!/usr/bin/env node

import { analyzeVideo, formatBytes } from './analyzer.js';
import { encodeVideo, replaceOriginal, removeBackup } from './encoder.js';
import { generatePresetChoices, getPreset } from './presets.js';
import prompts from 'prompts';
import fs from 'fs';
import path from 'path';

/**
 * Main function to process a video file interactively
 */
async function processVideo(filePath, options = {}) {
  const { verbose = false, sharedSettings = null, deletePreference = null } = options;

  console.log(`\n📹 Analyzing: ${filePath}\n`);

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Analyze video
    const analysis = await analyzeVideo(filePath);

    console.log('📊 Video Information:');
    console.log(`  Resolution: ${analysis.width}x${analysis.height}`);
    console.log(`  Codec: ${analysis.videoCodec}`);
    console.log(`  Bitrate: ${Math.round(analysis.bitrate / 1000)} kbps`);
    console.log(`  Duration: ${Math.round(analysis.duration)}s`);
    console.log(`  Size: ${formatBytes(analysis.fileSize)}`);
    console.log(`  FPS: ${analysis.fps.toFixed(2)}`);
    if (verbose && analysis.audioStreams.length > 0) {
      console.log(`  Audio: ${analysis.audioStreams[0].codec} @ ${analysis.audioStreams[0].channels}ch`);
    }
    console.log('');

    // Generate preset choices
    const presetChoices = generatePresetChoices(analysis);

    // Create choices for the prompt
    const choices = presetChoices.map((choice, index) => {
      const savingsDisplay = choice.savings > 0
        ? `Save ${formatBytes(choice.savings)} (${choice.savingsPercent}%)`
        : `Increase ${formatBytes(Math.abs(choice.savings))} (${Math.abs(choice.savingsPercent)}%)`;

      const title = choice.preset.name;
      const description = `${choice.preset.description} - Est. size: ${formatBytes(choice.estimatedSize)} - ${savingsDisplay}`;

      return {
        title,
        description,
        value: choice.key
      };
    });

    // Use shared settings if provided, otherwise prompt user
    let settings;

    if (sharedSettings) {
      // Use the shared settings from the first file
      settings = sharedSettings;
    } else {
      // Add custom and skip options
      choices.push(
        { title: 'Custom Settings', description: 'Enter your own encoding parameters', value: 'CUSTOM' },
        { title: 'Skip', description: 'Do not reencode this file', value: 'SKIP' }
      );

      // Prompt user to select preset
      const response = await prompts({
        type: 'select',
        name: 'preset',
        message: 'Select encoding preset:',
        choices,
        initial: 2 // Default to "Balanced (Recommended)"
      });

      // Handle cancellation
      if (!response.preset) {
        console.log('\n❌ Operation cancelled');
        process.exit(0);
      }

      // Handle skip
      if (response.preset === 'SKIP') {
        console.log('\n⏭️  Skipping - no changes made');
        return { settings: null, skipAll: false };
      }

      // Handle custom settings
      if (response.preset === 'CUSTOM') {
        const customResponse = await prompts([
          {
            type: 'select',
            name: 'videoCodec',
            message: 'Video codec:',
            choices: [
              { title: 'H.264 (libx264) - Best compatibility', value: 'libx264' },
              { title: 'H.265 (libx265) - Better compression', value: 'libx265' }
            ],
            initial: 0
          },
          {
            type: 'number',
            name: 'crf',
            message: 'CRF value (18-28, lower = better quality):',
            initial: 23,
            min: 18,
            max: 28
          },
          {
            type: 'select',
            name: 'preset',
            message: 'Encoding preset:',
            choices: [
              { title: 'ultrafast', value: 'ultrafast' },
              { title: 'superfast', value: 'superfast' },
              { title: 'veryfast', value: 'veryfast' },
              { title: 'faster', value: 'faster' },
              { title: 'fast', value: 'fast' },
              { title: 'medium', value: 'medium' },
              { title: 'slow (recommended)', value: 'slow' },
              { title: 'slower', value: 'slower' },
              { title: 'veryslow', value: 'veryslow' }
            ],
            initial: 6
          },
          {
            type: 'number',
            name: 'audioBitrate',
            message: 'Audio bitrate (kbps):',
            initial: 128,
            min: 64,
            max: 320
          }
        ]);

        if (!customResponse.videoCodec) {
          console.log('\n❌ Operation cancelled');
          process.exit(0);
        }

        settings = {
          videoCodec: customResponse.videoCodec,
          crf: customResponse.crf,
          preset: customResponse.preset,
          audioCodec: 'aac',
          audioBitrate: customResponse.audioBitrate
        };
      } else {
        // Use selected preset
        settings = getPreset(response.preset);
      }
    }

    // Perform encoding
    console.log('\n🎬 Starting encoding...');
    console.log(`  Codec: ${settings.videoCodec}`);
    console.log(`  CRF: ${settings.crf}`);
    console.log(`  Preset: ${settings.preset}`);
    console.log(`  Audio: ${settings.audioCodec} @ ${settings.audioBitrate}k\n`);

    let lastPercent = -1;
    const encodedPath = await encodeVideo(filePath, settings, (progress) => {
      if (progress.percent) {
        const percent = Math.round(progress.percent);
        if (percent !== lastPercent && percent % 5 === 0) {
          console.log(`  Progress: ${percent}%`);
          lastPercent = percent;
        }
      }
    });

    console.log('\n✅ Encoding complete!\n');

    // Replace original file (always create backup initially)
    console.log('💾 Replacing original file...');
    const result = await replaceOriginal(filePath, encodedPath, true);

    const actualSavings = result.savedBytes;
    const actualPercent = Math.round((actualSavings / result.originalSize) * 100);

    console.log(`\n✨ Success!`);
    console.log(`  Original size: ${formatBytes(result.originalSize)}`);
    console.log(`  New size: ${formatBytes(result.encodedSize)}`);
    if (actualSavings > 0) {
      console.log(`  Space saved: ${formatBytes(actualSavings)} (${actualPercent}%)`);
    } else {
      console.log(`  Size increased: ${formatBytes(Math.abs(actualSavings))} (${Math.abs(actualPercent)}%)`);
    }
    console.log(`  Backup: ${result.backupPath}\n`);

    // Handle backup deletion with preference tracking
    let shouldDelete = false;
    let newDeletePreference = deletePreference;

    if (deletePreference === 'all') {
      shouldDelete = true;
      console.log('🗑️  Backup deleted (delete all)');
    } else if (deletePreference === 'none') {
      shouldDelete = false;
      console.log(`✅ Backup kept at: ${result.backupPath} (keep all)`);
    } else {
      // Ask if user wants to delete backup
      const deleteBackup = await prompts({
        type: 'select',
        name: 'value',
        message: 'Delete backup file?',
        choices: [
          { title: 'No', value: 'no' },
          { title: 'Yes', value: 'yes' },
          ...(options.hasMultipleFiles ? [
            { title: 'No to all', value: 'none' },
            { title: 'Yes to all', value: 'all' }
          ] : [])
        ],
        initial: 0
      });

      if (!deleteBackup.value) {
        console.log(`\nℹ️  Backup kept at: ${result.backupPath}`);
      } else if (deleteBackup.value === 'yes' || deleteBackup.value === 'all') {
        shouldDelete = true;
        if (deleteBackup.value === 'all') {
          newDeletePreference = 'all';
        }
      } else if (deleteBackup.value === 'none') {
        newDeletePreference = 'none';
        console.log(`✅ Backup kept at: ${result.backupPath}`);
      } else {
        console.log(`✅ Backup kept at: ${result.backupPath}`);
      }
    }

    if (shouldDelete) {
      removeBackup(result.backupPath);
      if (deletePreference !== 'all') {
        console.log('🗑️  Backup deleted');
      }
    }

    return { settings, deletePreference: newDeletePreference };

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    return { settings: null, deletePreference, error: true };
  }
}

/**
 * Process multiple video files with shared settings
 */
async function processBatch(filePaths, options = {}) {
  const { verbose = false } = options;

  console.log(`\n📦 Processing ${filePaths.length} file(s)...\n`);

  // Process first file to get settings
  console.log(`\n═══ File 1 of ${filePaths.length} ═══`);
  const firstResult = await processVideo(filePaths[0], {
    verbose,
    hasMultipleFiles: filePaths.length > 1
  });

  if (!firstResult || !firstResult.settings) {
    // User cancelled or skipped
    console.log('\n❌ Batch processing cancelled');
    return;
  }

  const sharedSettings = firstResult.settings;
  let deletePreference = firstResult.deletePreference;

  // Process remaining files with the same settings
  for (let i = 1; i < filePaths.length; i++) {
    console.log(`\n═══ File ${i + 1} of ${filePaths.length} ═══`);
    const result = await processVideo(filePaths[i], {
      verbose,
      sharedSettings,
      deletePreference,
      hasMultipleFiles: true
    });

    if (result) {
      deletePreference = result.deletePreference;
    }
  }

  console.log(`\n✅ Batch processing complete! Processed ${filePaths.length} file(s).\n`);
}

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.mkv', '.avi', '.wmv', '.flv',
  '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.3gp'
]);

/**
 * Recursively collects video files from a directory
 */
function collectVideoFiles(dirPath) {
  const results = [];

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectVideoFiles(fullPath));
    } else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

/**
 * CLI argument parsing
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
vencode - Interactive Video Reencoding Tool

Usage: node index.js [options] <video-file-or-folder> [video-file-or-folder2] ...

Options:
  --verbose, -v     Show detailed video information
  --help, -h        Show this help message

Examples:
  node index.js video.mp4
  node index.js --verbose video.mov
  node index.js video1.mp4 video2.mp4 video3.mp4
  node index.js ./my-videos-folder

Features:
  • Interactive preset selection with estimated savings
  • Multiple quality presets from maximum quality to maximum compression
  • Custom encoding settings option
  • H.264 and H.265 codec support
  • Real-time progress during encoding
  • Safe file replacement with backup
  • Interactive backup deletion prompt with Yes/No to all for batch processing
  • Preserves original file extension
  • Batch processing: multiple files with shared settings
  • Folder support: recursively finds video files (${[...VIDEO_EXTENSIONS].join(', ')})
    `);
    process.exit(0);
  }

  const options = {
    verbose: args.includes('--verbose') || args.includes('-v')
  };

  const inputPaths = args.filter(arg => !arg.startsWith('--') && !arg.startsWith('-'));

  if (inputPaths.length === 0) {
    console.error('Error: No video file(s) or folder(s) specified');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  // Resolve all input paths to absolute paths
  const absolutePaths = inputPaths.map(fp => path.resolve(fp));

  // Validate all paths exist before starting
  const missingPaths = absolutePaths.filter(fp => !fs.existsSync(fp));
  if (missingPaths.length > 0) {
    console.error('Error: The following path(s) do not exist:');
    missingPaths.forEach(fp => console.error(`  - ${fp}`));
    process.exit(1);
  }

  // Expand folders into the video files they contain
  const filePaths = absolutePaths.flatMap(fp =>
    fs.statSync(fp).isDirectory() ? collectVideoFiles(fp) : [fp]
  );

  if (filePaths.length === 0) {
    console.error('Error: No video files found in the given folder(s)');
    process.exit(1);
  }

  // Process single file or batch
  if (filePaths.length === 1) {
    processVideo(filePaths[0], options);
  } else {
    processBatch(filePaths, options);
  }
}

main();
