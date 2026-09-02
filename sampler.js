/**
 * Measures how large an encode will actually be, by encoding short samples.
 *
 * The static model in presets.js derives size from resolution alone, so two
 * 720p clips of identical length get identical predictions no matter what they
 * contain. CRF targets a quality level rather than a bitrate, so the output
 * size is a property of the content and genuinely cannot be predicted from
 * resolution. Encoding a few seconds of the real thing measures it instead.
 *
 * Measured against full encodes of three 90s 480p sources of differing
 * complexity, where the static model predicted an identical 28.2 MB for all
 * three:
 *
 *   content       actual    static error   sampled error
 *   low motion    4.9 MB       +478%          +25%
 *   mixed        12.0 MB       +134%          +11%
 *   high motion 357.5 MB        -92%           -0.1%
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { videoQualityOptions } from './presets.js';

ffmpeg.setFfmpegPath(ffmpegPath.path);

// Sampling encodes SEGMENT_COUNT * SEGMENT_SECONDS of video, so its cost as a
// share of the full encode is that total over the duration. At five minutes
// that is 6%; on a feature-length file it rounds to nothing. Below it, the
// overhead stops being worth a better number.
const MIN_DURATION_FOR_SAMPLING = 300;

const SEGMENT_COUNT = 6;
const SEGMENT_SECONDS = 3;

// Skip the head and tail, which are often titles, fades or black frames and so
// are not representative of the body of the video.
const EDGE_MARGIN = 0.05;

/** Whether sampling is worth its wait for this source. */
export function shouldSample(analysis) {
  return Number.isFinite(analysis.duration) && analysis.duration >= MIN_DURATION_FOR_SAMPLING;
}

// A far cheaper probe used only to decide whether reencoding is worth doing at
// all.
const PROBE_SEGMENTS = 3;
const PROBE_SECONDS = 2;
const PROBE_PRESET = 'veryfast';

/**
 * The settings the cheap probe should measure at.
 *
 * For the software encoders this deliberately understates the saving: a faster
 * x264 preset produces LARGER output at the same CRF, so if even this shows a
 * worthwhile reduction, the real encode at the preset's own speed will do at
 * least as well.
 *
 * VideoToolbox has no preset ladder, so there is no cheaper setting to borrow
 * and no faster-means-bigger relationship to lean on. The probe runs at the
 * real settings instead, which makes it unbiased rather than conservative, and
 * costs little because the encoder is fast to begin with.
 */
export function probeSettings(settings) {
  if (settings.hardware) return settings;

  return { ...settings, preset: PROBE_PRESET };
}

/** Evenly spaced sample start times across the body of the video. */
function samplePositions(duration, count, seconds) {
  const start = duration * EDGE_MARGIN;
  const usable = duration * (1 - 2 * EDGE_MARGIN) - seconds;
  if (usable <= 0) return [0];

  return Array.from(
    { length: count },
    (_, i) => start + (usable * i) / Math.max(1, count - 1)
  );
}

/** Encodes one segment and returns the bytes of video it produced. */
function encodeSegment(inputPath, settings, position, seconds, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      // Seeking before -i is a keyframe seek, which is near-instant; seeking
      // after would decode everything up to the position and dominate the cost.
      .inputOptions(['-ss', String(position)])
      .outputOptions([
        '-t', String(seconds),
        '-c:v', settings.videoCodec,
        ...videoQualityOptions(settings),
        '-pix_fmt', settings.pixelFormat ?? 'yuv420p',
        // Audio is modelled separately, and excluding it keeps the measurement
        // purely about the video stream.
        '-an'
      ])
      .output(outputPath)
      .on('error', reject)
      .on('end', () => {
        try {
          resolve(fs.statSync(outputPath).size);
        } catch (err) {
          reject(err);
        }
      })
      .run();
  });
}

/**
 * Measures the video bitrate this preset produces on this source.
 *
 * @param {string} inputPath - Source video
 * @param {Object} analysis - Video analysis from analyzeVideo()
 * @param {Object} settings - Encoding settings to measure
 * @param {Function} [onProgress] - Receives completion in the range 0-1
 * @returns {Promise<number|null>} Video bits per second, or null if unmeasurable
 */
async function sample(inputPath, analysis, settings, count, seconds, onProgress) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vencode-sample-'));
  const positions = samplePositions(analysis.duration, count, seconds);

  let totalBytes = 0;
  let measuredSeconds = 0;

  try {
    for (const [index, position] of positions.entries()) {
      const segmentPath = path.join(workDir, `s${index}.mp4`);

      try {
        totalBytes += await encodeSegment(inputPath, settings, position, seconds, segmentPath);
        measuredSeconds += seconds;
      } catch {
        // A segment can fail near a damaged region; the rest still measure fine.
      }

      onProgress?.((index + 1) / positions.length);
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  if (measuredSeconds === 0 || totalBytes === 0) return null;
  return (totalBytes * 8) / measuredSeconds;
}

export async function measureVideoBitrate(inputPath, analysis, settings, onProgress = null) {
  return sample(inputPath, analysis, settings, SEGMENT_COUNT, SEGMENT_SECONDS, onProgress);
}

/**
 * Cheap, conservative estimate of the video bitrate a reencode would produce.
 *
 * Used to decide copy vs reencode. Codec identity alone cannot answer that: a
 * 180 Mbps HEVC capture shrinks enormously under H.264 at CRF 18, even though
 * HEVC is nominally the better codec. Only measuring settles it.
 *
 * @returns {Promise<number|null>} Video bits per second, or null if unmeasurable
 */
export async function probeVideoBitrate(inputPath, analysis, settings) {
  return sample(
    inputPath,
    analysis,
    probeSettings(settings),
    PROBE_SEGMENTS,
    PROBE_SECONDS,
    null
  );
}
