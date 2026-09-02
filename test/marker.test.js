import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMarkerValue, hasMarkerTag } from '../marker.js';

test('a software encode records the CRF it was made at', () => {
  const value = buildMarkerValue({ videoCodec: 'libx264', crf: 23, preset: 'slow' });

  assert.equal(value, 'vencode/1 codec=libx264 crf=23');
});

test('a hardware encode records its quality target, not an absent CRF', () => {
  const value = buildMarkerValue({
    videoCodec: 'hevc_videotoolbox', hardware: true, quality: 60
  });

  assert.equal(value, 'vencode/1 codec=hevc_videotoolbox q=60');
  assert.ok(!value.includes('undefined'));
});

test('a hardware marker is still recognised as this tool\'s own work', () => {
  const value = buildMarkerValue({
    videoCodec: 'hevc_videotoolbox', hardware: true, quality: 60
  });

  assert.equal(hasMarkerTag({ formatTags: { comment: value } }), true);
});
