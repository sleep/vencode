import test from 'node:test';
import assert from 'node:assert/strict';

import { detectHardwareEncoders, probeEncoder } from '../hardware.js';
import { HARDWARE_CODECS } from '../presets.js';

test('an encoder this ffmpeg cannot run is reported unavailable', async () => {
  assert.equal(await probeEncoder('definitely_not_an_encoder'), false);
});

test('a software encoder every build carries probes successfully', async () => {
  // Not a hardware codec, but it proves the probe reports success rather than
  // failing closed on everything and hiding the presets on every machine.
  assert.equal(await probeEncoder('libx264'), true);
});

test('detection only ever reports known hardware encoders', async () => {
  const detected = await detectHardwareEncoders();

  assert.ok(detected instanceof Set);
  for (const name of detected) assert.ok(HARDWARE_CODECS.has(name), name);
});

test('detection is memoised, so a batch pays for it once', async () => {
  const first = await detectHardwareEncoders();
  const second = await detectHardwareEncoders();

  assert.equal(first, second);
});
