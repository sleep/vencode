import fs from 'node:fs';
import path from 'node:path';

export const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.mkv', '.avi', '.wmv', '.flv',
  '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.3gp'
]);

/**
 * Collects the video files in a folder, descending into subfolders only when
 * asked to. Staying shallow by default keeps a stray parent folder from
 * pulling in an entire library, so reaching further is an explicit choice.
 */
export function collectVideoFiles(dirPath, { recursive = false } = {}) {
  const results = [];

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (recursive) results.push(...collectVideoFiles(fullPath, { recursive }));
    } else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }

  return results.sort();
}
