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
  const totalBitrate = videoBitrate + preset.audioBitrate;

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
