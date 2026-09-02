import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';

ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

// Transfer functions that denote HDR: PQ (HDR10/Dolby Vision) and HLG.
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);

/**
 * Parses ffprobe's rational frame rate, e.g. "30/1" or "24000/1001".
 *
 * Evaluating this string as code would run attacker-controlled text from an
 * untrusted file's metadata, so it is parsed arithmetically instead.
 *
 * @param {string} rate - Rational as reported by ffprobe
 * @returns {number} Frames per second, or 0 when unparseable
 */
function parseFrameRate(rate) {
  const [numerator, denominator] = String(rate ?? '').split('/').map(Number);

  if (!Number.isFinite(numerator) || numerator <= 0) return 0;
  if (denominator === undefined) return numerator;
  if (!Number.isFinite(denominator) || denominator === 0) return 0;

  return numerator / denominator;
}

/**
 * Analyzes a video file and returns its metadata
 * @param {string} filePath - Path to the video file
 * @returns {Promise<Object>} Video metadata
 */
export async function analyzeVideo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStreams = metadata.streams.filter(s => s.codec_type === 'audio');

      if (!videoStream) {
        reject(new Error('No video stream found in file'));
        return;
      }

      const fileSize = metadata.format.size;
      const duration = metadata.format.duration;
      const bitrate = metadata.format.bit_rate;

      const analysis = {
        filePath,
        fileSize,
        duration,
        bitrate: parseInt(bitrate),
        videoCodec: videoStream.codec_name,
        width: videoStream.width,
        height: videoStream.height,
        fps: parseFrameRate(videoStream.r_frame_rate),
        pixelFormat: videoStream.pix_fmt,
        colorPrimaries: videoStream.color_primaries ?? null,
        colorTransfer: videoStream.color_transfer ?? null,
        colorSpace: videoStream.color_space ?? null,
        colorRange: videoStream.color_range ?? null,
        // Both HDR transfer functions must be tested: PQ (HDR10) and HLG.
        isHDR: HDR_TRANSFERS.has(videoStream.color_transfer),
        audioStreams: audioStreams.map(a => ({
          codec: a.codec_name,
          bitrate: a.bit_rate ? parseInt(a.bit_rate) : null,
          channels: a.channels,
          sampleRate: a.sample_rate
        })),
        format: metadata.format.format_name
      };

      resolve(analysis);
    });
  });
}

/**
 * Determines optimal encoding settings based on video analysis
 * @param {Object} analysis - Video analysis from analyzeVideo()
 * @returns {Object} Recommended encoding settings
 */
export function proposeEncoding(analysis) {
  const { width, height, bitrate, videoCodec, audioStreams, fileSize, duration } = analysis;

  // Calculate current bitrate in kbps
  const currentBitrateKbps = Math.round(bitrate / 1000);

  // Determine resolution tier
  const pixels = width * height;
  let targetVideoBitrate;
  let targetAudioBitrate = 128; // Default audio bitrate in kbps

  // Target bitrates for H.264 with CRF 23 (visually lossless)
  // These are conservative estimates to ensure quality
  if (pixels <= 640 * 480) { // SD
    targetVideoBitrate = 1500;
  } else if (pixels <= 1280 * 720) { // 720p
    targetVideoBitrate = 2500;
  } else if (pixels <= 1920 * 1080) { // 1080p
    targetVideoBitrate = 4500;
  } else if (pixels <= 2560 * 1440) { // 1440p
    targetVideoBitrate = 8000;
  } else { // 4K and above
    targetVideoBitrate = 15000;
  }

  // Check if audio can be optimized
  const hasHighBitrateAudio = audioStreams.some(a => a.bitrate && a.bitrate > 160000);

  // Calculate total target bitrate
  const totalTargetBitrate = targetVideoBitrate + targetAudioBitrate;

  // Calculate estimated output size
  const estimatedSize = Math.round((totalTargetBitrate * 1000 * duration) / 8);
  const savingsBytes = fileSize - estimatedSize;
  const savingsPercent = Math.round((savingsBytes / fileSize) * 100);

  // Determine if reencoding is worthwhile
  const shouldReencode = savingsPercent > 10 ||
                         (videoCodec !== 'h264' && videoCodec !== 'hevc') ||
                         hasHighBitrateAudio;

  return {
    shouldReencode,
    currentBitrateKbps,
    targetVideoBitrate,
    targetAudioBitrate,
    estimatedSize,
    currentSize: fileSize,
    savingsBytes,
    savingsPercent,
    reason: !shouldReencode
      ? 'File is already well optimized'
      : savingsPercent > 10
        ? `Can save ${savingsPercent}% (${formatBytes(savingsBytes)})`
        : `Codec optimization (${videoCodec} -> h264)`,
    settings: {
      videoCodec: 'libx264',
      crf: 23, // Constant Rate Factor (18-28, lower = better quality)
      preset: 'slow', // Encoding speed vs compression (slower = better compression)
      audioBitrate: targetAudioBitrate,
      audioCodec: 'aac'
    }
  };
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export { formatBytes };
