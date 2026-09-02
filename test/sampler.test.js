import test from 'node:test';
import assert from 'node:assert/strict';

import { probeSettings } from '../sampler.js';

test('a software probe drops to a faster preset than the real encode', () => {
  const probe = probeSettings({ videoCodec: 'libx264', crf: 23, preset: 'slow' });

  assert.equal(probe.preset, 'veryfast');
  assert.equal(probe.crf, 23);
});

test('a hardware probe runs at the settings it is predicting', () => {
  const settings = { videoCodec: 'hevc_videotoolbox', hardware: true, quality: 65 };

  const probe = probeSettings(settings);

  // VideoToolbox has no preset ladder, so there is no cheaper setting to
  // borrow and no faster-means-bigger relationship to lean on.
  assert.deepEqual(probe, settings);
  assert.equal(probe.preset, undefined);
});
