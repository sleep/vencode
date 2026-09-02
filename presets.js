/**
 * Encoding presets for different quality/size tradeoffs
 */

export const PRESETS = {
  MAXIMUM_QUALITY: {
    name: 'Maximum Quality',
    description: 'Visually lossless, larger file size (CRF 18)',
    videoCodec: 'libx264',
    crf: 18,
    preset: 'slow',
    audioCodec: 'aac',
    audioBitrate: 320,
    sizeFactor: 1.3 // Relative to balanced
  },

  HIGH_QUALITY: {
    name: 'High Quality',
    description: 'Excellent quality, good compression (CRF 20)',
    videoCodec: 'libx264',
    crf: 20,
    preset: 'slow',
    audioCodec: 'aac',
    audioBitrate: 160,
    sizeFactor: 1.15
  },

  BALANCED: {
    name: 'Balanced (Recommended)',
    description: 'Great quality, good size savings (CRF 23)',
    videoCodec: 'libx264',
    crf: 23,
    preset: 'slow',
    audioCodec: 'aac',
    audioBitrate: 128,
    sizeFactor: 1.0
  },

  MAXIMUM_COMPRESSION: {
    name: 'Maximum Compression',
    description: 'Smaller size, slight quality loss (CRF 26)',
    videoCodec: 'libx264',
    crf: 26,
    preset: 'slow',
    audioCodec: 'aac',
    audioBitrate: 96,
    sizeFactor: 0.75
  },

  HEVC_HIGH: {
    name: 'HEVC High Quality',
    description: 'Best compression with HEVC/H.265 (CRF 24)',
    videoCodec: 'libx265',
    crf: 24,
    preset: 'slow',
    audioCodec: 'aac',
    audioBitrate: 128,
    sizeFactor: 0.7,
    note: 'Slower encoding, better compression, may have compatibility issues'
  }
};

// Rough iso-quality efficiency ranking; lower is more efficient. Used only to
// spot a downgrade, so neighbouring codecs sharing a rank is fine.
const CODEC_RANK = new Map([
  ['av1', 0], ['libaom-av1', 0], ['libsvtav1', 0],
  ['hevc', 1], ['h265', 1], ['libx265', 1], ['vp9', 1], ['libvpx-vp9', 1],
  ['h264', 2], ['libx264', 2], ['vp8', 2],
  ['mpeg4', 3], ['msmpeg4v3', 3], ['wmv3', 3], ['vc1', 3],
  ['mpeg2video', 4], ['mpeg1video', 4], ['h263', 4], ['mjpeg', 4]
]);

const DEFAULT_RANK = 2;

// The preset a sample encode is measured at; every other preset is scaled
// relative to it via sizeFactor.
export const MEASURED_PRESET = 'BALANCED';

// Pixel formats carrying more than 8 bits per component.
const HIGH_DEPTH_SUFFIX = /(10|12|14|16)(le|be)$/;
const HIGH_DEPTH_NAMES = new Set(['p010le', 'p210le', 'p410le']);

// Containers that can only hold VP8/VP9/AV1 video.
const VP_ONLY_CONTAINERS = new Set(['.webm']);
const VP_CODECS = new Set(['libvpx', 'libvpx-vp9', 'libaom-av1', 'libsvtav1']);

/**
 * Picks the output pixel format.
 *
 * This is a clamp, not a passthrough: omitting the flag entirely would let
 * yuv444p, gbrp and rgb24 sources reach High 4:4:4 Predictive, which is a worse
 * compatibility outcome than the 8-bit floor it replaces. High bit depth is
 * preserved because flattening 10-bit to 8-bit bands gradients irreversibly,
 * and the colour tags survive a re-encode regardless, so the old behaviour
 * produced an 8-bit file still claiming to be HDR.
 */
export function resolvePixelFormat(analysis) {
  const source = analysis.pixelFormat ?? '';
  const highDepth = HIGH_DEPTH_SUFFIX.test(source) || HIGH_DEPTH_NAMES.has(source);

  // libx264 selects High 10 and libx265 Main 10 automatically for this format.
  return highDepth ? 'yuv420p10le' : 'yuv420p';
}

/**
 * Decides whether the video stream should be re-encoded at all.
 *
 * Transcoding into a less efficient codec is never quality-neutral and usually
 * grows the file, so a source that already uses a better codec is passed
 * through untouched rather than downgraded.
 *
 * @returns {Object} `{ copy, pixelFormat, reason }`
 */
export function resolveVideoPlan(analysis, settings, extension = '') {
  const ext = extension.toLowerCase();
  const sourceCodec = analysis.videoCodec;
  const sourceRank = CODEC_RANK.get(sourceCodec) ?? DEFAULT_RANK;
  const targetRank = CODEC_RANK.get(settings.videoCodec) ?? DEFAULT_RANK;

  // The output container is inherited from the input, so a target codec the
  // muxer cannot hold would hard fail (this is why .webm input fails today).
  if (VP_ONLY_CONTAINERS.has(ext) && !VP_CODECS.has(settings.videoCodec)) {
    return {
      copy: true,
      reason: `${ext} cannot hold ${settings.videoCodec}`
    };
  }

  if (sourceRank < targetRank) {
    return {
      copy: true,
      reason: `${sourceCodec} is already more efficient than ${settings.videoCodec}`
    };
  }

  return { copy: false, pixelFormat: resolvePixelFormat(analysis), reason: null };
}

/**
 * Decides how to treat the audio stream.
 *
 * Re-encoding lossy audio never recovers what the first encoder discarded, so
 * targeting a bitrate above the source only stores that generation's artifacts
 * more faithfully, in a bigger file. Copy when there is nothing to gain, and
 * otherwise never encode above the source.
 *
 * @param {Object} analysis - Video analysis from analyzeVideo()
 * @param {Object} settings - Preset or custom settings
 * @returns {Object} `{ copy, bitrate, reason }`
 */
export function resolveAudioPlan(analysis, settings) {
  const target = settings.audioBitrate;
  const source = analysis.audioStreams[0];

  if (!source) {
    return { copy: false, bitrate: target, reason: 'no audio stream' };
  }

  // ffprobe cannot always report a bitrate; encoding at the target is the
  // predictable fallback when there is nothing to compare against.
  const sourceKbps = source.bitrate ? Math.round(source.bitrate / 1000) : null;
  if (sourceKbps === null) {
    return { copy: false, bitrate: target, reason: 'source bitrate unknown' };
  }

  if (source.codec === settings.audioCodec && sourceKbps <= target) {
    return {
      copy: true,
      bitrate: sourceKbps,
      reason: `already ${source.codec} at ${sourceKbps} kbps`
    };
  }

  if (sourceKbps < target) {
    return {
      copy: false,
      bitrate: sourceKbps,
      reason: `capped to the ${sourceKbps} kbps source`
    };
  }

  return { copy: false, bitrate: target, reason: null };
}

/**
 * Calculate estimated size for a preset
 * @param {Object} analysis - Video analysis
 * @param {Object} preset - Preset configuration
 * @returns {number} Estimated size in bytes
 */
export function estimateSize(analysis, preset, measuredVideoBps = null) {
  const { width, height, duration } = analysis;
  const pixels = width * height;

  // Base bitrate targets for CRF 23
  let baseBitrate;
  if (pixels <= 640 * 480) {
    baseBitrate = 1500;
  } else if (pixels <= 1280 * 720) {
    baseBitrate = 2500;
  } else if (pixels <= 1920 * 1080) {
    baseBitrate = 4500;
  } else if (pixels <= 2560 * 1440) {
    baseBitrate = 8000;
  } else {
    baseBitrate = 15000;
  }

  // A measurement of one preset anchors the absolute scale, which is the part
  // the resolution tiers get catastrophically wrong; sizeFactor then carries the
  // relative spread between presets.
  const videoBitrate = measuredVideoBps === null
    ? baseBitrate * preset.sizeFactor
    : (measuredVideoBps / 1000) * (preset.sizeFactor / PRESETS[MEASURED_PRESET].sizeFactor);
  // Use the bitrate the audio will actually end up at, not the preset's target.
  const totalBitrate = videoBitrate + resolveAudioPlan(analysis, preset).bitrate;

  // Calculate size: bitrate (kbps) * duration (s) * 1000 / 8
  return Math.round((totalBitrate * 1000 * duration) / 8);
}

/**
 * Generate preset choices with estimated sizes
 * @param {Object} analysis - Video analysis
 * @returns {Array} Array of preset choices
 */
export function generatePresetChoices(analysis, measuredVideoBps = null) {
  const choices = [];

  for (const [key, preset] of Object.entries(PRESETS)) {
    const estimatedSize = estimateSize(analysis, preset, measuredVideoBps);
    const savings = analysis.fileSize - estimatedSize;
    const savingsPercent = Math.round((savings / analysis.fileSize) * 100);

    choices.push({
      key,
      preset,
      estimatedSize,
      savings,
      savingsPercent
    });
  }

  return choices;
}

/**
 * Get preset by key
 * @param {string} key - Preset key
 * @returns {Object} Preset configuration
 */
export function getPreset(key) {
  return PRESETS[key];
}
