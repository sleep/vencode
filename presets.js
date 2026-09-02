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
  },

  // Quality targets calibrated against the software presets rather than chosen:
  // q 65 lands within 0.35 VMAF of libx265 at CRF 24, and q 58 within 0.10 VMAF
  // of libx264 at CRF 23, each for roughly a tenth more bytes. Only offered when
  // the media engine is actually present, so the menu never lists an encode this
  // machine cannot perform.
  HEVC_FAST_HW: {
    name: 'HEVC Fast (hardware)',
    description: 'Apple media engine, HEVC High Quality in a fraction of the time',
    videoCodec: 'hevc_videotoolbox',
    hardware: true,
    quality: 65,
    audioCodec: 'aac',
    audioBitrate: 128,
    sizeFactor: 1.37,
    note: 'Around 14x faster than libx265, for a slightly larger file'
  },

  H264_FAST_HW: {
    name: 'H.264 Fast (hardware)',
    description: 'Apple media engine, widest playback compatibility',
    videoCodec: 'h264_videotoolbox',
    hardware: true,
    quality: 58,
    audioCodec: 'aac',
    audioBitrate: 128,
    sizeFactor: 1.05,
    note: 'Barely touches the CPU, but cannot carry 10-bit or HDR'
  }
};

// Rough iso-quality efficiency ranking; lower is more efficient. Used only to
// spot a downgrade, so neighbouring codecs sharing a rank is fine.
const CODEC_RANK = new Map([
  ['av1', 0], ['libaom-av1', 0], ['libsvtav1', 0],
  ['hevc', 1], ['h265', 1], ['libx265', 1], ['hevc_videotoolbox', 1], ['vp9', 1], ['libvpx-vp9', 1],
  ['h264', 2], ['libx264', 2], ['h264_videotoolbox', 2], ['vp8', 2],
  ['mpeg4', 3], ['msmpeg4v3', 3], ['wmv3', 3], ['vc1', 3],
  ['mpeg2video', 4], ['mpeg1video', 4], ['h263', 4], ['mjpeg', 4]
]);

const DEFAULT_RANK = 2;

// The presets a sample encode is measured at; every other preset is scaled
// relative to one of them via sizeFactor.
//
// There are two because the families compress differently enough that scaling a
// libx264 measurement into a VideoToolbox row would be the same kind of guess
// that sampling replaced. Each family is anchored by a measurement of itself.
export const MEASURED_PRESET = 'BALANCED';
export const HARDWARE_MEASURED_PRESET = 'HEVC_FAST_HW';

// How far above a target bitrate a source may sit and still count as meeting
// it. Guards against re-encoding a file this tool just produced.
const REENCODE_TOLERANCE = 0.1;

// Minimum size reduction that justifies spending an encode and a generation of
// quality on the video stream.
const MIN_WORTHWHILE_REDUCTION = 0.1;

// VideoToolbox encoders, which run on the Apple Silicon media engine.
export const HARDWARE_CODECS = new Set(['hevc_videotoolbox', 'h264_videotoolbox']);

// Pixel formats carrying more than 8 bits per component.
const HIGH_DEPTH_SUFFIX = /(10|12|14|16)(le|be)$/;
const HIGH_DEPTH_NAMES = new Set(['p010le', 'p210le', 'p410le']);

// Containers that can only hold VP8/VP9/AV1 video.
const VP_ONLY_CONTAINERS = new Set(['.webm']);
const VP_CODECS = new Set(['libvpx', 'libvpx-vp9', 'libaom-av1', 'libsvtav1']);

// The 10-bit format each encoder will accept. VideoToolbox takes only the
// semi-planar p010le, and its H.264 encoder is absent here because it exposes
// no 10-bit format at all.
const HIGH_DEPTH_FORMATS = new Map([
  ['hevc_videotoolbox', 'p010le']
]);

// libx264 selects High 10 and libx265 Main 10 automatically for this format.
const DEFAULT_HIGH_DEPTH_FORMAT = 'yuv420p10le';

/**
 * Picks the output pixel format.
 *
 * This is a clamp, not a passthrough: omitting the flag entirely would let
 * yuv444p, gbrp and rgb24 sources reach High 4:4:4 Predictive, which is a worse
 * compatibility outcome than the 8-bit floor it replaces. High bit depth is
 * preserved because flattening 10-bit to 8-bit bands gradients irreversibly,
 * and the colour tags survive a re-encode regardless, so the old behaviour
 * produced an 8-bit file still claiming to be HDR.
 *
 * The format is encoder-specific: naming one the target does not accept makes
 * ffmpeg pick a substitute of its own, so the bit depth this exists to protect
 * would be lost without a word.
 */
export function resolvePixelFormat(analysis, videoCodec = 'libx264') {
  const source = analysis.pixelFormat ?? '';
  const highDepth = HIGH_DEPTH_SUFFIX.test(source) || HIGH_DEPTH_NAMES.has(source);
  if (!highDepth) return 'yuv420p';

  // Encoders with no 10-bit format have to flatten; callers warn about it.
  if (HARDWARE_CODECS.has(videoCodec)) {
    return HIGH_DEPTH_FORMATS.get(videoCodec) ?? 'yuv420p';
  }

  return DEFAULT_HIGH_DEPTH_FORMAT;
}

/**
 * The ffmpeg flags that express this preset's quality target.
 *
 * The two encoder families take different, mutually unintelligible scales, and
 * neither rejects the other's flags: handing `-crf` and `-preset` to a
 * VideoToolbox encoder exits 0, prints nothing, and encodes at the driver's own
 * default bitrate. Routing every quality decision through here is what stops
 * that silent miss.
 */
export function videoQualityOptions(settings) {
  if (settings.hardware) return ['-q:v', String(settings.quality)];

  return ['-crf', String(settings.crf), '-preset', settings.preset];
}

// Encoders emitting HEVC, the only codec here whose bitstream carries HDR10
// mastering-display and MaxCLL metadata.
const HDR_CAPABLE_CODECS = new Set(['libx265', 'hevc_videotoolbox']);

/** Whether an encode with this codec keeps a source's HDR10 metadata. */
export function carriesHDR(videoCodec) {
  return HDR_CAPABLE_CODECS.has(videoCodec);
}

/** How a preset's quality target reads in the plan summary. */
export function describeQuality(settings) {
  if (settings.hardware) return `quality ${settings.quality}, hardware encoder`;

  return `CRF ${settings.crf}, preset ${settings.preset}`;
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
export function resolveVideoPlan(analysis, settings, extension = '', projectedVideoBps = null) {
  const ext = extension.toLowerCase();
  const sourceCodec = analysis.videoCodec;
  const encode = {
    copy: false,
    pixelFormat: resolvePixelFormat(analysis, settings.videoCodec),
    reason: null
  };

  // The output container is inherited from the input, so a target codec the
  // muxer cannot hold would hard fail. This one is a hard constraint, not a
  // judgement call, so it outranks any measurement.
  if (VP_ONLY_CONTAINERS.has(ext) && !VP_CODECS.has(settings.videoCodec)) {
    return { copy: true, reason: `${ext} cannot hold ${settings.videoCodec}` };
  }

  // Prefer a measurement. Codec identity alone is misleading, because it
  // compares codecs at equal quality: an over-provisioned 180 Mbps HEVC capture
  // shrinks by three quarters under H.264 at CRF 18 despite HEVC being the
  // better codec, while an already-lean HEVC file would grow.
  if (projectedVideoBps !== null && analysis.duration > 0) {
    const projectedBytes = (projectedVideoBps / 8) * analysis.duration;
    const reduction = 1 - projectedBytes / Number(analysis.fileSize);

    if (reduction >= MIN_WORTHWHILE_REDUCTION) return encode;

    return {
      copy: true,
      reason: `reencoding would only change size by ${Math.round(reduction * 100)}%`
    };
  }

  // No measurement available: fall back to codec rank, which at least catches
  // the clear-cut downgrades.
  const sourceRank = CODEC_RANK.get(sourceCodec) ?? DEFAULT_RANK;
  const targetRank = CODEC_RANK.get(settings.videoCodec) ?? DEFAULT_RANK;

  if (sourceRank < targetRank) {
    return {
      copy: true,
      reason: `${sourceCodec} is already more efficient than ${settings.videoCodec}`
    };
  }

  return encode;
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

  // Encoders overshoot their own target slightly, so a file this tool produced
  // at 320 measures ~322 and an exact comparison would re-encode it on every
  // subsequent run, losing a generation each time. Shaving a few percent off
  // the audio of a video file is worth far less than that, so treat anything
  // near the target as already satisfying it.
  if (source.codec === settings.audioCodec && sourceKbps <= target * (1 + REENCODE_TOLERANCE)) {
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
 * The measurement a preset's estimate should be scaled from.
 *
 * A hardware preset prefers a hardware measurement, but falls back to the
 * software one rather than dropping to the resolution model: extrapolating
 * across encoder families is a poor estimate, and the resolution model is a far
 * worse one.
 *
 * @returns {Object|null} `{ bps, factor }`, or null if nothing was measured
 */
function sizeAnchor(preset, measured) {
  if (preset.hardware && measured.hardware != null) {
    return { bps: measured.hardware, factor: PRESETS[HARDWARE_MEASURED_PRESET].sizeFactor };
  }

  if (measured.software != null) {
    return { bps: measured.software, factor: PRESETS[MEASURED_PRESET].sizeFactor };
  }

  return null;
}

/**
 * Calculate estimated size for a preset
 * @param {Object} analysis - Video analysis
 * @param {Object} preset - Preset configuration
 * @param {Object} measured - `{ software, hardware }` bits per second, if known
 * @returns {number} Estimated size in bytes
 */
export function estimateSize(analysis, preset, measured = {}) {
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
  const anchor = sizeAnchor(preset, measured);
  const videoBitrate = anchor === null
    ? baseBitrate * preset.sizeFactor
    : (anchor.bps / 1000) * (preset.sizeFactor / anchor.factor);
  // Use the bitrate the audio will actually end up at, not the preset's target.
  const totalBitrate = videoBitrate + resolveAudioPlan(analysis, preset).bitrate;

  // Calculate size: bitrate (kbps) * duration (s) * 1000 / 8
  return Math.round((totalBitrate * 1000 * duration) / 8);
}

/**
 * Generate preset choices with estimated sizes
 *
 * @param {Object} analysis - Video analysis
 * @param {Object} measured - `{ software, hardware }` bits per second, if known
 * @param {Set<string>} availableEncoders - Hardware encoders this machine can run
 * @returns {Array} Array of preset choices
 */
export function generatePresetChoices(analysis, measured = {}, availableEncoders = new Set()) {
  const choices = [];

  for (const [key, preset] of Object.entries(PRESETS)) {
    // Listing a preset the machine cannot run would offer a choice that only
    // fails once the encode starts.
    if (preset.hardware && !availableEncoders.has(preset.videoCodec)) continue;

    const estimatedSize = estimateSize(analysis, preset, measured);
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
