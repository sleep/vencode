/**
 * Decides whether this machine can actually encode on its media engine.
 *
 * Apple Silicon carries fixed-function video encoders that VideoToolbox exposes
 * as `hevc_videotoolbox` and `h264_videotoolbox`. They cost a fraction of the
 * CPU time of libx265 and finish an order of magnitude sooner, at the price of
 * some compression efficiency, so they are worth offering but never worth
 * substituting silently.
 *
 * Availability is established by encoding, not by asking. `ffmpeg -encoders`
 * reports what the binary was compiled with, which is a different question from
 * what the silicon underneath will accept: the same build lists both encoders
 * on an Intel Mac without the engine and inside a VM with no passthrough, and
 * only fails once a real encode starts. A trial encode of a fraction of a
 * second settles it for good.
 */

import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { execFile } from 'child_process';

import { HARDWARE_CODECS } from './presets.js';

// A probe that neither succeeds nor fails is a hung startup, and the presets it
// guards are an optimisation. Treat silence past this as unavailable.
const PROBE_TIMEOUT_MS = 10_000;

/**
 * Whether ffmpeg can complete an encode with this encoder on this machine.
 *
 * The output goes to the null muxer, so this touches no disk and leaves nothing
 * to clean up.
 *
 * @param {string} name - ffmpeg encoder name
 * @returns {Promise<boolean>}
 */
export function probeEncoder(name) {
  return new Promise((resolve) => {
    execFile(
      ffmpegPath.path,
      [
        '-v', 'error',
        '-f', 'lavfi',
        '-i', 'color=black:s=128x128:r=5:d=0.2',
        '-c:v', name,
        '-f', 'null', '-'
      ],
      { timeout: PROBE_TIMEOUT_MS },
      (err) => resolve(!err)
    );
  });
}

// Detection spawns a process per encoder, and a batch resolves settings once
// per file. Holding the promise rather than the result means concurrent callers
// share the one probe too.
let detection = null;

/**
 * The hardware encoders this machine can actually use.
 *
 * @returns {Promise<Set<string>>} Working encoder names, empty if none
 */
export function detectHardwareEncoders() {
  detection ??= (async () => {
    const names = [...HARDWARE_CODECS];
    const working = await Promise.all(names.map(probeEncoder));

    return new Set(names.filter((_, index) => working[index]));
  })();

  return detection;
}
