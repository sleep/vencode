import test from 'node:test';
import assert from 'node:assert/strict';

import {
  videoQualityOptions, resolvePixelFormat, resolveVideoPlan, estimateSize,
  generatePresetChoices, PRESETS, HARDWARE_CODECS, MEASURED_PRESET,
  HARDWARE_MEASURED_PRESET, describeQuality, carriesHDR
} from '../presets.js';

test('software settings ask for CRF at a named x264 preset', () => {
  const options = videoQualityOptions({ crf: 23, preset: 'slow' });

  assert.deepEqual(options, ['-crf', '23', '-preset', 'slow']);
});

test('hardware settings ask for constant quality instead of CRF', () => {
  const options = videoQualityOptions({ hardware: true, quality: 60 });

  assert.deepEqual(options, ['-q:v', '60']);
});

test('hardware settings never emit -preset, which VideoToolbox ignores silently', () => {
  const options = videoQualityOptions({ hardware: true, quality: 60, preset: 'slow' });

  assert.ok(!options.includes('-preset'));
  assert.ok(!options.includes('-crf'));
});

const tenBit = { pixelFormat: 'yuv420p10le' };
const eightBit = { pixelFormat: 'yuv420p' };

test('software encoders keep 10-bit sources in a 10-bit planar format', () => {
  assert.equal(resolvePixelFormat(tenBit, 'libx265'), 'yuv420p10le');
});

test('hardware HEVC keeps 10-bit, but in the semi-planar format it accepts', () => {
  assert.equal(resolvePixelFormat(tenBit, 'hevc_videotoolbox'), 'p010le');
});

test('hardware H.264 flattens 10-bit, having no 10-bit format at all', () => {
  assert.equal(resolvePixelFormat(tenBit, 'h264_videotoolbox'), 'yuv420p');
});

test('8-bit sources clamp to yuv420p on every encoder', () => {
  for (const codec of ['libx264', 'hevc_videotoolbox', 'h264_videotoolbox']) {
    assert.equal(resolvePixelFormat(eightBit, codec), 'yuv420p');
  }
});

test('a hardware video plan carries the pixel format that encoder accepts', () => {
  const analysis = { videoCodec: 'h264', pixelFormat: 'yuv420p10le', duration: 60, fileSize: 1e9 };
  const settings = { videoCodec: 'hevc_videotoolbox', hardware: true, quality: 60 };

  const plan = resolveVideoPlan(analysis, settings, '.mkv');

  assert.equal(plan.copy, false);
  assert.equal(plan.pixelFormat, 'p010le');
});

test('hardware encoders rank by the codec they emit, not by their own name', () => {
  const analysis = { videoCodec: 'hevc', pixelFormat: 'yuv420p', duration: 60, fileSize: 1e9 };

  // Unranked, hevc_videotoolbox defaults mid-table and reads as a downgrade
  // from an HEVC source, so the encode is refused with a nonsense reason.
  const plan = resolveVideoPlan(analysis, { videoCodec: 'hevc_videotoolbox' }, '.mkv');

  assert.equal(plan.copy, false);
});

test('a hardware H.264 target is still refused for an HEVC source', () => {
  const analysis = { videoCodec: 'hevc', pixelFormat: 'yuv420p', duration: 60, fileSize: 1e9 };

  const plan = resolveVideoPlan(analysis, { videoCodec: 'h264_videotoolbox' }, '.mkv');

  assert.equal(plan.copy, true);
  assert.match(plan.reason, /already more efficient/);
});

test('hardware presets carry a quality target and no CRF', () => {
  const hardware = Object.values(PRESETS).filter((p) => p.hardware);

  assert.ok(hardware.length > 0);
  for (const preset of hardware) {
    assert.equal(typeof preset.quality, 'number');
    assert.equal(preset.crf, undefined);
    assert.equal(preset.preset, undefined);
    assert.ok(HARDWARE_CODECS.has(preset.videoCodec));
  }
});

const analysis = {
  width: 1920, height: 1080, duration: 100, fileSize: 1e9,
  pixelFormat: 'yuv420p', audioStreams: []
};

test('a hardware preset sizes itself from the hardware measurement', () => {
  const preset = PRESETS[HARDWARE_MEASURED_PRESET];

  // 8 Mbps of video plus the preset's 128 kbps of audio, over 100 seconds.
  const size = estimateSize(analysis, preset, { software: 1e6, hardware: 8e6 });

  assert.equal(size, ((8000 + 128) * 1000 * 100) / 8);
});

test('a software preset ignores the hardware measurement entirely', () => {
  const preset = PRESETS[MEASURED_PRESET];

  const size = estimateSize(analysis, preset, { software: 8e6, hardware: 1e9 });

  assert.equal(size, ((8000 + 128) * 1000 * 100) / 8);
});

test('hardware presets are offered only when their encoder is available', () => {
  const none = generatePresetChoices(analysis, {}, new Set());
  assert.equal(none.some((c) => c.preset.hardware), false);

  const hevcOnly = generatePresetChoices(analysis, {}, new Set(['hevc_videotoolbox']));
  const offered = hevcOnly.filter((c) => c.preset.hardware).map((c) => c.preset.videoCodec);
  assert.deepEqual(offered, ['hevc_videotoolbox']);
});

test('with no encoders detected the menu is exactly the software presets', () => {
  const choices = generatePresetChoices(analysis, {}, new Set());
  const softwareKeys = Object.entries(PRESETS)
    .filter(([, p]) => !p.hardware)
    .map(([key]) => key);

  assert.deepEqual(choices.map((c) => c.key), softwareKeys);
});

test('a software plan is described on the CRF scale', () => {
  assert.equal(
    describeQuality({ videoCodec: 'libx264', crf: 23, preset: 'slow' }),
    'CRF 23, preset slow'
  );
});

test('a hardware plan is described on its own scale, never as a CRF', () => {
  const description = describeQuality({
    videoCodec: 'hevc_videotoolbox', hardware: true, quality: 65
  });

  assert.equal(description, 'quality 65, hardware encoder');
  assert.ok(!description.includes('CRF'));
});

test('both HEVC encoders are recognised as able to carry HDR10 metadata', () => {
  assert.equal(carriesHDR('libx265'), true);
  assert.equal(carriesHDR('hevc_videotoolbox'), true);
});

test('neither H.264 encoder is credited with carrying HDR10 metadata', () => {
  assert.equal(carriesHDR('libx264'), false);
  assert.equal(carriesHDR('h264_videotoolbox'), false);
});
