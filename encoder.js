import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import fs from 'fs';
import path from 'path';
import { markerOutputOptions } from './marker.js';

ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

// The encode in flight, so an interrupt can stop ffmpeg and clear its temp file
// instead of orphaning both when the process dies.
let activeEncode = null;

/**
 * Stops the running encode, if any, and deletes its partial output.
 * @returns {string|null} Path of the discarded temp file
 */
export function abortActiveEncode() {
  if (!activeEncode) return null;

  const { command, tempOutput } = activeEncode;
  activeEncode = null;

  try {
    command.kill('SIGKILL');
  } catch {
    // ffmpeg may already be gone; the temp file still needs clearing.
  }

  try {
    if (fs.existsSync(tempOutput)) {
      fs.unlinkSync(tempOutput);
      return tempOutput;
    }
  } catch {
    // Best effort only - never mask the interrupt with a cleanup error.
  }

  return null;
}

// Containers that support +faststart and the mp4 codec tagging rules.
const MP4_FAMILY = new Set(['.mp4', '.m4v', '.mov']);
// Containers that can carry attachments such as mkv subtitle fonts.
const MATROSKA_FAMILY = new Set(['.mkv', '.webm']);
const HEVC_NAMES = new Set(['hevc', 'h265', 'libx265']);

/**
 * Builds the ordered ffmpeg output arguments.
 *
 * Exported so the ordering rules below can be asserted directly, because
 * several of them fail silently rather than erroring.
 *
 * @param {Object} settings - Encoding settings plus the resolved stream plans
 * @param {string} extension - Output file extension, including the dot
 * @returns {string[]} ffmpeg output options
 */
export function buildOutputOptions(settings, extension) {
  const ext = extension.toLowerCase();
  const options = [];

  // Uppercase V selects real video only. Bare '0:v' also matches attached_pic
  // cover art, which then reaches the video encoder and hard fails the run.
  // The '?' suffix makes a mapping optional so files lacking that stream type
  // still encode, and mapping explicitly stops ffmpeg's default selection from
  // silently dropping every track past the first.
  options.push('-map', '0:V:0', '-map', '0:a?', '-map', '0:s?');
  if (MATROSKA_FAMILY.has(ext)) options.push('-map', '0:t?');

  if (settings.videoCopy) {
    options.push('-c:v', 'copy');
  } else {
    options.push(
      '-c:v', settings.videoCodec,
      '-crf', String(settings.crf),
      '-preset', settings.preset,
      '-pix_fmt', settings.pixelFormat ?? 'yuv420p'
    );
  }

  // ffmpeg resolves per-stream options last-wins, not most-specific-wins, so
  // the blanket copy MUST precede the track-0 override or the override is
  // silently ignored and every track is copied.
  options.push('-c:a', 'copy');
  if (!settings.audioCopy) {
    options.push('-c:a:0', settings.audioCodec, '-b:a:0', `${settings.audioBitrate}k`);
  }

  // Without this a matroska output re-encodes subtitles to ASS, which aborts
  // outright on the bitmap subtitles used by most disc rips.
  options.push('-c:s', 'copy');

  // Stamp the file as vencode's work so a later run can recognise it without
  // reprobing, and without relying on bitrate heuristics alone.
  options.push(...markerOutputOptions(settings, ext));

  if (MP4_FAMILY.has(ext)) {
    // QuickTime and Safari refuse the 'hev1' tag that a copy would preserve.
    const outputIsHevc = settings.videoCopy
      ? HEVC_NAMES.has(settings.sourceVideoCodec)
      : HEVC_NAMES.has(settings.videoCodec);
    if (outputIsHevc) options.push('-tag:v', 'hvc1');

    // ffmpeg picks the ipod muxer for .m4v, which rejects an HEVC copy.
    if (ext === '.m4v') options.push('-f', 'mp4');

    options.push('-movflags', '+faststart');
  }

  return options;
}

/**
 * Encodes a video file with specified settings
 * @param {string} inputPath - Path to input video
 * @param {Object} settings - Encoding settings
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Promise<string>} Path to encoded file
 */
export async function encodeVideo(inputPath, settings, progressCallback = null) {
  const ext = path.extname(inputPath);
  const dir = path.dirname(inputPath);
  const basename = path.basename(inputPath, ext);
  const tempOutput = path.join(dir, `${basename}.temp${ext}`);

  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath)
      .outputOptions(buildOutputOptions(settings, ext))
      .output(tempOutput);

    if (progressCallback) {
      command.on('progress', (progress) => {
        progressCallback(progress);
      });
    }

    command
      .on('error', (err) => {
        activeEncode = null;
        // Clean up temp file on error
        if (fs.existsSync(tempOutput)) {
          fs.unlinkSync(tempOutput);
        }
        reject(err);
      })
      .on('end', () => {
        activeEncode = null;
        resolve(tempOutput);
      });

    activeEncode = { command, tempOutput };
    command.run();
  });
}

/**
 * Safely replaces the original file with the encoded version
 * @param {string} originalPath - Path to original file
 * @param {string} encodedPath - Path to encoded file
 * @param {boolean} createBackup - Whether to create a backup
 * @returns {Promise<Object>} Result info
 */
export async function replaceOriginal(originalPath, encodedPath, createBackup = true) {
  const ext = path.extname(originalPath);
  const dir = path.dirname(originalPath);
  const basename = path.basename(originalPath, ext);
  const backupPath = path.join(dir, `${basename}.backup${ext}`);

  // Get file sizes
  const originalSize = fs.statSync(originalPath).size;
  const encodedSize = fs.statSync(encodedPath).size;

  // Safety check: ensure encoded file is not corrupt (has reasonable size)
  if (encodedSize < 1024) {
    throw new Error('Encoded file appears to be corrupt (too small)');
  }

  // Create backup if requested
  if (createBackup) {
    fs.copyFileSync(originalPath, backupPath);
  }

  try {
    // Replace original with encoded version
    fs.unlinkSync(originalPath);
    fs.renameSync(encodedPath, originalPath);

    return {
      success: true,
      originalSize,
      encodedSize,
      savedBytes: originalSize - encodedSize,
      backupPath: createBackup ? backupPath : null
    };
  } catch (err) {
    // Restore backup if something went wrong
    if (createBackup && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, originalPath);
    }
    throw err;
  }
}

/**
 * Removes backup file
 * @param {string} backupPath - Path to backup file
 */
export function removeBackup(backupPath) {
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }
}
