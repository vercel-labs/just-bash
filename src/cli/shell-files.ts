import type { OverlayFs } from "../fs/overlay-fs/overlay-fs.js";

/**
 * Seed in-memory overlay files for shell startup fixtures.
 * Paths are virtual shell paths (e.g. "/tmp/data.txt").
 */
export function seedOverlayFiles(
  overlayFs: OverlayFs,
  files?: Record<string, string>,
): void {
  if (!files) return;
  for (const [path, content] of Object.entries(files)) {
    overlayFs.writeFileSync(path, content);
  }
}
