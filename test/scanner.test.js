import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectVideoFiles } from '../scanner.js';

/** Builds a throwaway tree from a map of relative path to file contents. */
function fixture(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vencode-scanner-'));

  for (const relative of layout) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '');
  }

  return root;
}

test('a folder is searched at the top level only by default', () => {
  const root = fixture(['top.mp4', 'nested/deep.mp4']);

  const found = collectVideoFiles(root);

  assert.deepEqual(found, [path.join(root, 'top.mp4')]);
});

test('the recursive option reaches files in subfolders', () => {
  const root = fixture(['top.mp4', 'nested/deep.mp4', 'nested/deeper/deepest.mp4']);

  const found = collectVideoFiles(root, { recursive: true });

  assert.deepEqual(found, [
    path.join(root, 'nested', 'deep.mp4'),
    path.join(root, 'nested', 'deeper', 'deepest.mp4'),
    path.join(root, 'top.mp4')
  ]);
});

test('a folder holding only subfolders yields nothing without the recursive option', () => {
  const root = fixture(['nested/deep.mp4']);

  assert.deepEqual(collectVideoFiles(root), []);
});

test('files that are not video are left alone', () => {
  const root = fixture(['keep.mkv', 'notes.txt', 'cover.jpg', 'subtitles.srt']);

  const found = collectVideoFiles(root);

  assert.deepEqual(found, [path.join(root, 'keep.mkv')]);
});

test('an extension is recognised whatever its case', () => {
  const root = fixture(['SHOUTING.MP4', 'Mixed.MoV']);

  const found = collectVideoFiles(root);

  assert.deepEqual(found, [path.join(root, 'Mixed.MoV'), path.join(root, 'SHOUTING.MP4')]);
});

test('results come back in a stable order', () => {
  const root = fixture(['c.mp4', 'a.mp4', 'b.mp4']);

  const found = collectVideoFiles(root);

  assert.deepEqual(found, ['a.mp4', 'b.mp4', 'c.mp4'].map((name) => path.join(root, name)));
});
