#!/usr/bin/env node

import { analyzeVideo, proposeEncoding, formatBytes } from './analyzer.js';
import { encodeVideo, replaceOriginal, removeBackup, abortActiveEncode } from './encoder.js';
import { PRESETS, MEASURED_PRESET, HARDWARE_MEASURED_PRESET, generatePresetChoices, estimateSize, getPreset, resolveAudioPlan, resolveVideoPlan, resolvePixelFormat, describeQuality, carriesHDR } from './presets.js';
import { detectHardwareEncoders } from './hardware.js';
import { shouldSample, measureVideoBitrate, probeVideoBitrate } from './sampler.js';
import { previouslyProcessed, recordProcessed, indexPath } from './marker.js';
import { VIDEO_EXTENSIONS, collectVideoFiles } from './scanner.js';
import * as ui from './ui.js';
import prompts from 'prompts';
import fs from 'fs';
import path from 'path';

const DEFAULT_PRESET = 'BALANCED';

/** Path shown to the user: relative to the cwd when that is shorter. */
function displayPath(filePath) {
  const relative = path.relative(process.cwd(), filePath);
  return relative && !relative.startsWith('..') ? relative : filePath;
}

/**
 * One-line error text.
 *
 * ffmpeg and ffprobe append their whole stderr, banner and all, to the message.
 * The actionable part is the final line, so keep the summary and that.
 */
function conciseError(error) {
  const raw = String(error?.message ?? error);
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

  if (lines.length <= 1) return raw;
  return `${lines[0]} (${lines[lines.length - 1]})`;
}

/** One-line description of what will happen to the video stream. */
function describeVideoPlan(video, settings) {
  if (video.copy) {
    return `${ui.style.green('copied')}, no re-encode (${video.reason})`;
  }

  const tenBit = video.pixelFormat === 'yuv420p10le' || video.pixelFormat === 'p010le';
  const depth = tenBit ? ', 10-bit preserved' : '';
  return `${settings.videoCodec}, ${describeQuality(settings)}${depth}`;
}

/** One-line description of what will happen to the audio stream. */
function describeAudioPlan(audio, settings) {
  if (audio.reason === 'no audio stream') return 'none';

  if (audio.copy) {
    return `${ui.style.green('copied')}, no re-encode (${audio.reason})`;
  }

  const target = `${settings.audioCodec} @ ${audio.bitrate} kbps`;
  return audio.reason ? `${target} (${audio.reason})` : target;
}

/**
 * Restores the terminal and discards partial output when the user interrupts.
 *
 * Node terminates on an unhandled SIGINT without running `exit` listeners, so
 * without this the cursor stays hidden and ffmpeg keeps running detached.
 */
function installInterruptHandler() {
  process.on('SIGINT', () => {
    ui.abortActiveProgress();
    ui.showCursor();

    const discarded = abortActiveEncode();

    ui.blank();
    ui.warn(discarded ? 'Interrupted, partial output discarded' : 'Interrupted');
    ui.info('The original file was left untouched');
    ui.blank();

    process.exit(130);
  });
}

/**
 * Builds the preset menu.
 *
 * The estimate lives in each row's title rather than its description, because
 * `prompts` only renders the description of the highlighted row - putting the
 * numbers there would hide the very figures the choice depends on.
 */
function buildPresetChoices(analysis, measured, availableEncoders) {
  const rows = generatePresetChoices(analysis, measured, availableEncoders).map((choice) => ({
    key: choice.key,
    savings: choice.savings,
    name: choice.preset.name,
    size: formatBytes(choice.estimatedSize),
    delta: choice.savings > 0
      ? `-${choice.savingsPercent}%`
      : `+${Math.abs(choice.savingsPercent)}%`,
    description: choice.preset.note
      ? `${choice.preset.description}. ${choice.preset.note}`
      : choice.preset.description
  }));

  const nameWidth = Math.max(...rows.map((r) => r.name.length));
  const sizeWidth = Math.max(...rows.map((r) => r.size.length));
  const deltaWidth = Math.max(...rows.map((r) => r.delta.length));

  const choices = rows.map((row) => ({
    title: [
      row.name.padEnd(nameWidth),
      row.size.padStart(sizeWidth),
      row.delta.padStart(deltaWidth)
    ].join('  '),
    description: row.description,
    value: row.key
  }));

  return { choices, everyPresetGrows: rows.every((r) => r.savings <= 0) };
}

/** Prompts for fully custom encoding parameters. */
async function promptCustomSettings() {
  const response = await prompts([
    {
      type: 'select',
      name: 'videoCodec',
      message: 'Video codec',
      choices: [
        { title: 'H.264 (libx264)', description: 'Best compatibility', value: 'libx264' },
        { title: 'H.265 (libx265)', description: 'Better compression', value: 'libx265' }
      ],
      initial: 0
    },
    {
      type: 'number',
      name: 'crf',
      message: 'CRF value (18-28, lower is better quality)',
      initial: 23,
      min: 18,
      max: 28
    },
    {
      type: 'select',
      name: 'preset',
      message: 'Encoding preset',
      choices: [
        { title: 'ultrafast', value: 'ultrafast' },
        { title: 'superfast', value: 'superfast' },
        { title: 'veryfast', value: 'veryfast' },
        { title: 'faster', value: 'faster' },
        { title: 'fast', value: 'fast' },
        { title: 'medium', value: 'medium' },
        { title: 'slow', description: 'Recommended', value: 'slow' },
        { title: 'slower', value: 'slower' },
        { title: 'veryslow', value: 'veryslow' }
      ],
      initial: 6
    },
    {
      type: 'number',
      name: 'audioBitrate',
      message: 'Audio bitrate (kbps)',
      initial: 128,
      min: 64,
      max: 320
    }
  ]);

  if (!response.videoCodec) return null;

  return {
    videoCodec: response.videoCodec,
    crf: response.crf,
    preset: response.preset,
    audioCodec: 'aac',
    audioBitrate: response.audioBitrate
  };
}

/**
 * Resolves the encoding settings for one file.
 * @returns {Object} `{ status: 'ready'|'skipped'|'cancelled', settings }`
 */
async function resolveSettings(analysis, options) {
  const { sharedSettings, presetKey, assumeYes } = options;

  if (sharedSettings) return { status: 'ready', settings: sharedSettings };
  if (presetKey) return { status: 'ready', settings: getPreset(presetKey) };
  if (assumeYes) return { status: 'ready', settings: getPreset(DEFAULT_PRESET) };

  const availableEncoders = await detectHardwareEncoders();

  // Encode a few seconds of the real thing so the menu shows a measured size
  // rather than a resolution-derived guess. Each encoder family is anchored by
  // a measurement of itself, because their output sizes do not track each other
  // closely enough for one to stand in for the other.
  const anchors = [{ family: 'software', presetKey: MEASURED_PRESET }];
  if (availableEncoders.has(PRESETS[HARDWARE_MEASURED_PRESET].videoCodec)) {
    anchors.push({ family: 'hardware', presetKey: HARDWARE_MEASURED_PRESET });
  }

  const measured = {};
  if (shouldSample(analysis)) {
    const bar = ui.createProgressBar('Sampling');

    try {
      for (const [index, anchor] of anchors.entries()) {
        const preset = getPreset(anchor.presetKey);

        measured[anchor.family] = await measureVideoBitrate(
          options.filePath,
          analysis,
          { ...preset, pixelFormat: resolvePixelFormat(analysis, preset.videoCodec) },
          (fraction) => bar.update((index + fraction) / anchors.length)
        );
      }
      bar.finish();
    } catch {
      bar.abort();
      // A failed sample is not fatal; fall back to the static estimate.
    }
  }

  const { choices, everyPresetGrows } = buildPresetChoices(analysis, measured, availableEncoders);

  ui.blank();
  if (measured.software == null && shouldSample(analysis)) {
    ui.info('Estimates below are approximate (sampling unavailable)');
  } else if (measured.software == null) {
    ui.info('Estimates below are approximate; the file is too short to sample');
  }
  if (everyPresetGrows) {
    ui.warn('Every preset estimates a larger file than the original');
    ui.blank();
  }

  const response = await prompts({
    type: 'select',
    name: 'preset',
    message: 'Select encoding preset',
    choices: [
      ...choices,
      { title: 'Custom settings', description: 'Enter your own encoding parameters', value: 'CUSTOM' },
      { title: 'Skip', description: 'Do not reencode this file', value: 'SKIP' }
    ],
    initial: 2 // Default to "Balanced (Recommended)"
  });

  if (!response.preset) return { status: 'cancelled' };
  if (response.preset === 'SKIP') return { status: 'skipped' };

  if (response.preset === 'CUSTOM') {
    const custom = await promptCustomSettings();
    return custom ? { status: 'ready', settings: custom } : { status: 'cancelled' };
  }

  return { status: 'ready', settings: getPreset(response.preset) };
}

/** Runs the encode behind a live progress bar. */
async function runEncode(filePath, analysis, settings) {
  const bar = ui.createProgressBar('Encoding');
  const startedAt = Date.now();

  try {
    const encodedPath = await encodeVideo(filePath, settings, (progress) => {
      // ffmpeg's own percent is unreliable (it guesses the duration), but we
      // already probed the real duration, so derive progress from the timemark.
      const encodedSeconds = ui.parseTimemark(progress.timemark);
      if (encodedSeconds === null || !analysis.duration) return;

      const elapsed = (Date.now() - startedAt) / 1000;
      const speed = elapsed > 0 ? encodedSeconds / elapsed : null;

      bar.update(encodedSeconds / analysis.duration, speed);
    });

    bar.finish();
    return encodedPath;
  } catch (err) {
    bar.abort();
    throw err;
  }
}

/** Asks whether to remove the backup, honouring a standing batch preference. */
async function resolveBackup(backupPath, options) {
  const { deletePreference, hasMultipleFiles } = options;

  if (deletePreference === 'all') return { remove: true, deletePreference };
  if (deletePreference === 'none') return { remove: false, deletePreference };

  const response = await prompts({
    type: 'select',
    name: 'value',
    message: 'Delete backup file?',
    choices: [
      { title: 'No', value: 'no' },
      { title: 'Yes', value: 'yes' },
      ...(hasMultipleFiles ? [
        { title: 'No to all', value: 'none' },
        { title: 'Yes to all', value: 'all' }
      ] : [])
    ],
    initial: 0
  });

  return {
    remove: response.value === 'yes' || response.value === 'all',
    deletePreference: response.value === 'all' || response.value === 'none'
      ? response.value
      : deletePreference
  };
}

/**
 * Analyzes, encodes and replaces one video file.
 *
 * @returns {Object} `{ status, settings, deletePreference, originalSize, encodedSize }`
 *   where status is 'encoded' | 'skipped' | 'cancelled' | 'error'. Skipping is
 *   kept distinct from cancelling so a batch can move on to the next file.
 */
async function processVideo(filePath, options = {}) {
  const { verbose = false, deletePreference = null } = options;

  try {
    const analysis = options.analysis ?? await analyzeVideo(filePath);
    const proposal = proposeEncoding(analysis);

    ui.heading('Source');
    ui.field('File', displayPath(filePath));
    ui.field('Resolution', `${analysis.width}x${analysis.height}`);
    ui.field('Codec', analysis.videoCodec);
    ui.field('Bitrate', `${Math.round(analysis.bitrate / 1000)} kbps`);
    ui.field('Duration', ui.formatDuration(analysis.duration));
    ui.field('Size', formatBytes(analysis.fileSize));
    ui.field('Frame rate', `${analysis.fps.toFixed(2)} fps`);
    if (verbose && analysis.audioStreams.length > 0) {
      const audio = analysis.audioStreams[0];
      ui.field('Audio', `${audio.codec}, ${audio.channels}ch`);
    }

    // A file this tool already produced needs no probe and no second generation
    // of loss, unless the user is deliberately asking for different settings
    // than it was made with. Recognising it before settings are resolved means
    // a batch neither samples it nor asks which preset to skip it with.
    const already = previouslyProcessed(filePath, analysis);
    if (already && !options.force) {
      ui.blank();
      ui.warn(`Already encoded by vencode (recognised by ${already.source})`);
      ui.info('Skipped, no changes made. Use --force to encode it again');
      return { status: 'skipped', deletePreference };
    }

    if (!proposal.shouldReencode) {
      ui.blank();
      ui.warn(`${proposal.reason}, expect little gain from reencoding`);
    }

    const resolved = await resolveSettings(analysis, { ...options, filePath });

    if (resolved.status === 'cancelled') {
      ui.blank();
      ui.fail('Cancelled');
      return { status: 'cancelled', deletePreference };
    }

    if (resolved.status === 'skipped') {
      ui.blank();
      ui.info('Skipped, no changes made');
      return { status: 'skipped', deletePreference };
    }

    const settings = resolved.settings;

    // Resolved per file: a batch shares one preset, but each source has its own
    // audio, so the copy-or-encode decision cannot be shared along with it.
    const audio = resolveAudioPlan(analysis, settings);

    // Whether reencoding is worth doing cannot be decided from codec names, so
    // a short probe measures what it would actually produce.
    const probed = await probeVideoBitrate(filePath, analysis, {
      ...settings,
      pixelFormat: resolvePixelFormat(analysis, settings.videoCodec)
    }).catch(() => null);

    const video = resolveVideoPlan(analysis, settings, path.extname(filePath), probed);
    const effectiveSettings = {
      ...settings,
      audioCopy: audio.copy,
      audioBitrate: audio.bitrate,
      videoCopy: video.copy,
      pixelFormat: video.pixelFormat,
      sourceVideoCodec: analysis.videoCodec
    };

    ui.heading('Encoding');
    ui.field('Video', describeVideoPlan(video, settings));
    ui.field('Audio', describeAudioPlan(audio, settings));
    ui.blank();

    // H.264 cannot carry HDR10 mastering-display or MaxCLL metadata at all, and
    // this ffmpeg build cannot tonemap, so the choice is preserve or lose. Both
    // HEVC encoders carry it, so this turns on the codec rather than the preset.
    if (analysis.isHDR && !video.copy && !carriesHDR(settings.videoCodec)) {
      ui.warn(`HDR source (${analysis.colorTransfer}): ${settings.videoCodec} cannot carry HDR10 mastering metadata`);
      ui.info('Only the HEVC presets preserve it');
      ui.blank();
    }

    // A 10-bit source reaching an encoder with no 10-bit format is flattened to
    // 8 bits, which bands gradients irreversibly. The pixel format is chosen
    // silently, so without this the loss would never be mentioned.
    if (!video.copy && analysis.pixelFormat?.includes('10') && video.pixelFormat === 'yuv420p') {
      ui.warn(`10-bit source: ${settings.videoCodec} has no 10-bit format and will flatten it to 8-bit`);
      ui.blank();
    }

    // Rewriting gigabytes to reproduce the same streams wastes time and, via
    // container overhead, usually ends up marginally larger.
    if (video.copy && audio.copy) {
      ui.warn('Nothing to gain: both streams would be copied unchanged');
      ui.blank();
      ui.info('Skipped, no changes made');
      return { status: 'skipped', deletePreference };
    }

    const encodedPath = await runEncode(filePath, analysis, effectiveSettings);

    // Replace original file (always create backup initially)
    const result = await replaceOriginal(filePath, encodedPath, true);

    const savings = result.savedBytes;
    const savingsPercent = Math.round((savings / result.originalSize) * 100);

    ui.heading('Result');
    ui.field('Original', formatBytes(result.originalSize));
    ui.field('Encoded', formatBytes(result.encodedSize));
    if (savings > 0) {
      ui.field('Saved', ui.style.green(`${formatBytes(savings)} (${savingsPercent}%)`));
    } else {
      ui.field('Increase', ui.style.yellow(`${formatBytes(Math.abs(savings))} (${Math.abs(savingsPercent)}%)`));
    }
    ui.field('Backup', displayPath(result.backupPath));
    ui.blank();

    recordProcessed(filePath, effectiveSettings);

    const backup = await resolveBackup(result.backupPath, options);

    if (backup.remove) {
      removeBackup(result.backupPath);
      ui.info('Backup deleted');
    } else {
      ui.info(`Backup kept at ${displayPath(result.backupPath)}`);
    }

    ui.blank();
    ui.success(`Done: ${displayPath(filePath)}`);

    return {
      status: 'encoded',
      settings,
      deletePreference: backup.deletePreference,
      originalSize: result.originalSize,
      encodedSize: result.encodedSize
    };

  } catch (error) {
    ui.blank();
    ui.fail(conciseError(error));
    return { status: 'error', deletePreference };
  }
}

/** Probes every file up front so a batch can report its true scope. */
async function scanFiles(filePaths) {
  const bar = filePaths.length > 1 ? ui.createProgressBar('Scanning') : null;
  const scanned = [];

  for (const [index, filePath] of filePaths.entries()) {
    try {
      scanned.push({ filePath, analysis: await analyzeVideo(filePath) });
    } catch (error) {
      scanned.push({ filePath, analysis: null, error });
    }
    bar?.update((index + 1) / filePaths.length);
  }

  bar?.finish();
  return scanned;
}

/** Prints the pre-flight overview for a batch. */
function printBatchOverview(scanned) {
  const readable = scanned.filter((entry) => entry.analysis);
  const totalBytes = readable.reduce((sum, entry) => sum + Number(entry.analysis.fileSize), 0);
  const totalSeconds = readable.reduce((sum, entry) => sum + entry.analysis.duration, 0);

  ui.heading('Batch');
  ui.field('Files', String(scanned.length));
  ui.field('Total size', formatBytes(totalBytes));
  ui.field('Total length', ui.formatDuration(totalSeconds));
  if (readable.length !== scanned.length) {
    ui.field('Unreadable', ui.style.yellow(String(scanned.length - readable.length)));
  }

  return totalBytes;
}

/** Prints the projected batch outcome once a stock preset has been chosen. */
function printProjection(scanned, settings, totalBytes) {
  // Custom settings carry no sizeFactor, so there is nothing to project from.
  if (!settings?.sizeFactor) return;

  // A file whose video will be copied keeps its size, so projecting an encode
  // for it advertises savings that cannot happen.
  const projected = scanned
    .filter((entry) => entry.analysis)
    .reduce((sum, entry) => {
      const plan = resolveVideoPlan(entry.analysis, settings, path.extname(entry.filePath));
      return sum + (plan.copy
        ? Number(entry.analysis.fileSize)
        : estimateSize(entry.analysis, settings));
    }, 0);

  const savings = totalBytes - projected;
  if (savings <= 0) return;

  const percent = Math.round((savings / totalBytes) * 100);
  ui.blank();
  ui.info(`Projected across the batch: ${formatBytes(projected)}, saving about ${formatBytes(savings)} (${percent}%)`);
}

/**
 * Processes multiple files, reusing the first chosen settings for the rest.
 */
async function processBatch(filePaths, options = {}) {
  const scanned = await scanFiles(filePaths);
  const totalBytes = printBatchOverview(scanned);

  const tally = { encoded: 0, skipped: 0, failed: 0, originalBytes: 0, encodedBytes: 0 };
  let sharedSettings = null;
  let deletePreference = options.assumeYes
    ? (options.deleteBackups ? 'all' : 'none')
    : null;
  let cancelled = false;
  let projected = false;

  for (const [index, entry] of scanned.entries()) {
    const saved = tally.originalBytes - tally.encodedBytes;
    ui.divider(
      `File ${index + 1} of ${scanned.length}`,
      saved > 0 ? `${formatBytes(saved)} saved so far` : null
    );

    if (!entry.analysis) {
      ui.blank();
      ui.fail(`${displayPath(entry.filePath)}: ${conciseError(entry.error)}`);
      tally.failed++;
      continue;
    }

    const result = await processVideo(entry.filePath, {
      ...options,
      analysis: entry.analysis,
      sharedSettings,
      deletePreference,
      hasMultipleFiles: true
    });

    if (result.status === 'cancelled') {
      cancelled = true;
      break;
    }

    if (result.status === 'skipped') {
      tally.skipped++;
      continue;
    }

    if (result.status === 'error') {
      tally.failed++;
      continue;
    }

    tally.encoded++;
    tally.originalBytes += result.originalSize;
    tally.encodedBytes += result.encodedSize;

    // The first file that actually encodes sets the settings for the rest.
    sharedSettings = sharedSettings ?? result.settings;
    deletePreference = result.deletePreference;

    if (!projected) {
      projected = true;
      printProjection(scanned, sharedSettings, totalBytes);
    }
  }

  printSummary(tally, cancelled);
  return tally;
}

/** Closing tally for a batch run. */
function printSummary(tally, cancelled) {
  const saved = tally.originalBytes - tally.encodedBytes;

  ui.heading('Summary');
  ui.field('Encoded', String(tally.encoded));
  if (tally.skipped > 0) ui.field('Skipped', String(tally.skipped));
  if (tally.failed > 0) ui.field('Failed', ui.style.yellow(String(tally.failed)));

  if (tally.encoded > 0) {
    ui.field('Original', formatBytes(tally.originalBytes));
    ui.field('Encoded size', formatBytes(tally.encodedBytes));
    if (saved > 0) {
      const percent = Math.round((saved / tally.originalBytes) * 100);
      ui.field('Saved', ui.style.green(`${formatBytes(saved)} (${percent}%)`));
    }
  }

  ui.blank();
  if (cancelled) {
    ui.warn('Batch stopped early');
  } else if (tally.failed > 0) {
    ui.warn(`Batch finished with ${tally.failed} failure(s)`);
  } else {
    ui.success('Batch complete');
  }
  ui.blank();
}

/** Parses argv into options plus input paths. */
function parseArgs(argv) {
  const options = {
    verbose: false,
    assumeYes: false,
    deleteBackups: false,
    force: false,
    recursive: false,
    help: false,
    presetKey: null,
    paths: []
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--yes' || arg === '-y') {
      options.assumeYes = true;
    } else if (arg === '--delete-backups') {
      options.deleteBackups = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--recursive' || arg === '-r') {
      options.recursive = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--preset=')) {
      options.presetKey = arg.slice('--preset='.length);
    } else if (arg === '--preset') {
      options.presetKey = argv[++i];
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option: ${arg}` };
    } else {
      options.paths.push(arg);
    }
  }

  if (options.presetKey !== null) {
    const key = String(options.presetKey).toUpperCase();
    if (!PRESETS[key]) {
      return { error: `Unknown preset: ${options.presetKey}. Choose one of ${Object.keys(PRESETS).join(', ')}` };
    }
    options.presetKey = key;
  }

  return options;
}

function printHelp() {
  ui.blank();
  ui.line(`${ui.style.bold('vencode')} ${ui.style.gray('- interactive video reencoding tool')}`);

  ui.heading('Usage');
  ui.line('vencode [options] <file-or-folder> [file-or-folder ...]');

  ui.heading('Options');
  ui.field('-v, --verbose', 'Show detailed video information', 20);
  ui.field('-y, --yes', 'Skip prompts, use the balanced preset', 20);
  ui.field('--preset=<name>', `One of ${Object.keys(PRESETS).join(', ')}`, 20);
  ui.field('--delete-backups', 'With --yes, remove backups after encoding', 20);
  ui.field('--force', 'Reencode even if vencode made the file', 20);
  ui.field('-r, --recursive', 'Search subfolders too', 20);
  ui.field('-h, --help', 'Show this help message', 20);

  ui.heading('Examples');
  ui.line('vencode video.mp4');
  ui.line('vencode --verbose video.mov');
  ui.line('vencode --yes --preset=HEVC_HIGH ./my-videos-folder');
  ui.line('vencode -r ./my-videos-folder');

  ui.heading('Notes');
  ui.line('Folders are searched at the top level only; pass -r to include subfolders.');
  ui.line('Hardware presets are offered only where an Apple Silicon media engine is found.');
  ui.line(`Recognised extensions: ${[...VIDEO_EXTENSIONS].join(' ')}`);
  ui.line('In a batch the first encoded file\'s settings are reused for the rest.');
  ui.line('The original is backed up before it is replaced.');
  ui.line(`Files vencode has made are remembered in ${indexPath()}`);
  ui.blank();
}

async function main() {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);

  if (options.error) {
    ui.blank();
    ui.fail(options.error);
    ui.info('Run with --help for usage information');
    ui.blank();
    process.exit(1);
  }

  if (argv.length === 0 || options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.paths.length === 0) {
    ui.blank();
    ui.fail('No video file(s) or folder(s) specified');
    ui.info('Run with --help for usage information');
    ui.blank();
    process.exit(1);
  }

  // A hardware preset named on the command line is checked before any file is
  // touched. The encoder is a property of the machine rather than the argument,
  // so the alternative is a batch that starts and then fails on every file.
  if (options.presetKey) {
    const preset = getPreset(options.presetKey);

    if (preset.hardware && !(await detectHardwareEncoders()).has(preset.videoCodec)) {
      ui.blank();
      ui.fail(`Preset ${options.presetKey} needs ${preset.videoCodec}, which this machine cannot run`);
      ui.info('Hardware presets require an Apple Silicon media engine');
      ui.blank();
      process.exit(1);
    }
  }

  // Resolve all input paths to absolute paths
  const absolutePaths = options.paths.map((fp) => path.resolve(fp));

  // Validate all paths exist before starting
  const missingPaths = absolutePaths.filter((fp) => !fs.existsSync(fp));
  if (missingPaths.length > 0) {
    ui.blank();
    ui.fail('The following path(s) do not exist:');
    missingPaths.forEach((fp) => ui.line(`  ${displayPath(fp)}`));
    ui.blank();
    process.exit(1);
  }

  // Expand folders into the video files they contain
  const filePaths = absolutePaths.flatMap((fp) =>
    fs.statSync(fp).isDirectory() ? collectVideoFiles(fp, { recursive: options.recursive }) : [fp]
  );

  if (filePaths.length === 0) {
    ui.blank();
    ui.fail('No video files found in the given folder(s)');

    // Nothing at the top level means every candidate is deeper down, so a
    // recursive walk here counts exactly what the missing flag would have
    // added. Only worth the second walk on the way out.
    if (!options.recursive) {
      const deeper = absolutePaths
        .filter((fp) => fs.statSync(fp).isDirectory())
        .flatMap((fp) => collectVideoFiles(fp, { recursive: true }));

      if (deeper.length > 0) {
        ui.info(`${deeper.length} video file(s) are in subfolders - pass -r to include them`);
      }
    }

    ui.blank();
    process.exit(1);
  }

  installInterruptHandler();

  if (filePaths.length === 1) {
    const result = await processVideo(filePaths[0], {
      ...options,
      deletePreference: options.assumeYes
        ? (options.deleteBackups ? 'all' : 'none')
        : null
    });
    ui.blank();
    process.exit(result.status === 'error' ? 1 : 0);
  }

  const tally = await processBatch(filePaths, options);
  process.exit(tally.failed > 0 ? 1 : 0);
}

main();
