/**
 * Records which files this tool has already produced.
 *
 * Without a marker, a second run has no way to tell an untouched source from
 * one vencode encoded earlier, so it pays the probe cost again on every file
 * and relies purely on bitrate heuristics to avoid a second generation of loss.
 *
 * Two layers, because neither alone is sufficient:
 *
 *  - An embedded tag travels with the file through moves, renames and copies to
 *    other machines. Matroska accepts an arbitrary VENCODE tag and keeps it
 *    across a stream-copy remux; MP4, MOV, M4V and AVI silently drop unknown
 *    tags, so those use the `comment` atom, which they do support.
 *  - A local index covers anything the container cannot carry, and is keyed by
 *    content rather than path so a renamed or moved file is still recognised.
 */

import ffprobePath from '@ffprobe-installer/ffprobe';
import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const MARKER_KEY = 'VENCODE';
export const MARKER_VERSION = 1;

// Matroska is the only container here that keeps an arbitrary tag name.
const CUSTOM_TAG_CONTAINERS = new Set(['.mkv', '.webm']);

const INDEX_DIR = path.join(os.homedir(), '.config', 'vencode');
const INDEX_PATH = path.join(INDEX_DIR, 'processed.json');

// Hashing whole files costs ~6s per 2.8 GB, which a batch pays on every run for
// no benefit: the question is "did this tool make this file", not "has a byte
// been tampered with". Size plus both ends answers that in a fraction of a
// second and still changes whenever the file is reencoded.
const FINGERPRINT_BYTES = 4 * 1024 * 1024;

/**
 * The quality target, on whichever scale the encoder used.
 *
 * The two scales run in opposite directions, so they cannot share a field name
 * without a later reader mistaking one for the other.
 */
export function qualityLabel(settings) {
  return settings.hardware ? `q=${settings.quality}` : `crf=${settings.crf}`;
}

/** Formats the marker payload written into a file's metadata. */
export function buildMarkerValue(settings) {
  return [
    `${MARKER_KEY.toLowerCase()}/${MARKER_VERSION}`,
    `codec=${settings.videoCodec}`,
    qualityLabel(settings)
  ].join(' ');
}

/**
 * ffmpeg metadata arguments that stamp the marker onto the output.
 *
 * @param {Object} settings - Encoding settings used for this file
 * @param {string} extension - Output file extension, including the dot
 * @returns {string[]} ffmpeg output options
 */
export function markerOutputOptions(settings, extension) {
  const value = buildMarkerValue(settings);

  if (CUSTOM_TAG_CONTAINERS.has(extension.toLowerCase())) {
    return ['-metadata', `${MARKER_KEY}=${value}`];
  }

  // Everything else only keeps a known tag, and `comment` is the least
  // surprising of them.
  return ['-metadata', `comment=${value}`];
}

/** True when a file's own metadata says vencode produced it. */
export function hasMarkerTag(analysis) {
  const tags = analysis?.formatTags ?? {};

  for (const [name, value] of Object.entries(tags)) {
    const key = name.toLowerCase();
    if (key !== MARKER_KEY.toLowerCase() && key !== 'comment') continue;
    if (String(value).startsWith(`${MARKER_KEY.toLowerCase()}/`)) return true;
  }

  return false;
}

/**
 * Content fingerprint: file size plus its first and last few megabytes.
 *
 * @param {string} filePath - File to fingerprint
 * @returns {string|null} Hex digest, or null if unreadable
 */
export function fingerprint(filePath) {
  let handle = null;

  try {
    const { size } = fs.statSync(filePath);
    const hash = crypto.createHash('sha256').update(String(size));

    handle = fs.openSync(filePath, 'r');
    const span = Math.min(FINGERPRINT_BYTES, size);
    const buffer = Buffer.alloc(span);

    fs.readSync(handle, buffer, 0, span, 0);
    hash.update(buffer);

    // Skip the tail read when the file is small enough that it overlaps.
    if (size > span * 2) {
      fs.readSync(handle, buffer, 0, span, size - span);
      hash.update(buffer);
    }

    return hash.digest('hex');
  } catch {
    return null;
  } finally {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {
        // Nothing useful to do if the descriptor will not close.
      }
    }
  }
}

/** Reads the local index, treating any problem as an empty index. */
function readIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Records a file in the local index.
 *
 * @param {string} filePath - The encoded output
 * @param {Object} settings - Settings it was produced with
 * @returns {boolean} Whether the entry was written
 */
export function recordProcessed(filePath, settings) {
  const key = fingerprint(filePath);
  if (key === null) return false;

  try {
    const index = readIndex();
    index[key] = {
      version: MARKER_VERSION,
      videoCodec: settings.videoCodec,
      quality: qualityLabel(settings),
      name: path.basename(filePath)
    };

    fs.mkdirSync(INDEX_DIR, { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
    return true;
  } catch {
    // The index is an optimisation, so failing to write it must never break
    // an encode that already succeeded.
    return false;
  }
}

/** Looks a file up in the local index by content. */
export function findProcessed(filePath) {
  const key = fingerprint(filePath);
  if (key === null) return null;

  return readIndex()[key] ?? null;
}

/**
 * Whether vencode already produced this file, by tag or by index.
 *
 * @returns {Object|null} `{ source, details }`, or null if not recognised
 */
export function previouslyProcessed(filePath, analysis) {
  if (hasMarkerTag(analysis)) return { source: 'metadata', details: null };

  const indexed = findProcessed(filePath);
  return indexed ? { source: 'index', details: indexed } : null;
}

/** Path of the local index, for display. */
export function indexPath() {
  return INDEX_PATH;
}

/** Reads a file's container-level metadata tags. */
export function readFormatTags(filePath) {
  return new Promise((resolve) => {
    execFile(
      ffprobePath.path,
      ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', filePath],
      (err, stdout) => {
        if (err) {
          resolve({});
          return;
        }

        try {
          resolve(JSON.parse(stdout)?.format?.tags ?? {});
        } catch {
          resolve({});
        }
      }
    );
  });
}
