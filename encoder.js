import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import fs from 'fs';
import path from 'path';

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
      .videoCodec(settings.videoCodec)
      .outputOptions([
        `-crf ${settings.crf}`,
        `-preset ${settings.preset}`,
        '-movflags +faststart', // Optimize for streaming
        '-pix_fmt yuv420p' // Ensure compatibility
      ]);

    // Passing the audio through untouched avoids a pointless second generation
    // of lossy encoding when the source is already at or below the target.
    if (settings.audioCopy) {
      command = command.audioCodec('copy');
    } else {
      command = command
        .audioCodec(settings.audioCodec)
        .audioBitrate(`${settings.audioBitrate}k`);
    }

    command = command.output(tempOutput);

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
