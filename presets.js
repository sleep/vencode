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
export function estimateSize(analysis, preset) {
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

  // Adjust for preset size factor
  const videoBitrate = baseBitrate * preset.sizeFactor;
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
export function generatePresetChoices(analysis) {
  const choices = [];

  for (const [key, preset] of Object.entries(PRESETS)) {
    const estimatedSize = estimateSize(analysis, preset);
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
