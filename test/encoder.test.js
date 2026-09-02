import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOutputOptions } from '../encoder.js';

/** The value ffmpeg would see for a flag, given the flat option list. */
function valueOf(options, flag) {
  const index = options.indexOf(flag);
  return index === -1 ? null : options[index + 1];
}

const hardwareSettings = {
  videoCodec: 'hevc_videotoolbox',
  hardware: true,
  quality: 60,
  pixelFormat: 'p010le',
  audioCodec: 'aac',
  audioBitrate: 128
};

test('a hardware encode asks for constant quality, not CRF', () => {
  const options = buildOutputOptions(hardwareSettings, '.mkv');

  assert.equal(valueOf(options, '-q:v'), '60');
  assert.ok(!options.includes('-crf'));
  assert.ok(!options.includes('-preset'));
});

test('hardware HEVC in an mp4 gets the hvc1 tag QuickTime requires', () => {
  const options = buildOutputOptions(hardwareSettings, '.mp4');

  assert.equal(valueOf(options, '-tag:v'), 'hvc1');
});

test('hardware H.264 in an mp4 is left untagged', () => {
  const options = buildOutputOptions(
    { ...hardwareSettings, videoCodec: 'h264_videotoolbox', pixelFormat: 'yuv420p' },
    '.mp4'
  );

  assert.equal(valueOf(options, '-tag:v'), null);
});

test('a software encode still asks for CRF at a named preset', () => {
  const options = buildOutputOptions(
    { videoCodec: 'libx264', crf: 23, preset: 'slow', audioCodec: 'aac', audioBitrate: 128 },
    '.mkv'
  );

  assert.equal(valueOf(options, '-crf'), '23');
  assert.equal(valueOf(options, '-preset'), 'slow');
  assert.ok(!options.includes('-q:v'));
});

test('a stream copy names no quality flags at all', () => {
  const options = buildOutputOptions(
    { videoCopy: true, sourceVideoCodec: 'hevc', audioCopy: true },
    '.mkv'
  );

  assert.equal(valueOf(options, '-c:v'), 'copy');
  assert.ok(!options.includes('-q:v'));
  assert.ok(!options.includes('-crf'));
});
