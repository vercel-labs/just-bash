import { InMemoryFs } from "./in-memory-fs/in-memory-fs.js";
import { initFilesystem } from "./init.js";
import type { IFileSystem } from "./interface.js";
import { MountableFs } from "./mountable-fs/mountable-fs.js";

/**
 * Compose multiple filesystems into a single unified namespace.
 *
 * Pass `"/"` to set the base filesystem. Everything else is mounted at the
 * given path. When no `"/"` is provided, a fresh `InMemoryFs` (pre-initialised
 * with `/dev`, `/proc`, `/bin`, etc.) is used as the base.
 *
 * @example
 * ```ts
 * import { mount, HttpFs, InMemoryFs } from "just-bash";
 *
 * const fs = mount({
 *   "/data": new HttpFs("https://cdn.example.com/dataset", [
 *     "train.csv",
 *     "test.csv",
 *     "metadata.json",
 *   ]),
 * });
 *
 * const bash = new Bash({ fs });
 * await bash.exec("wc -l /data/train.csv");
 * ```
 */
export function mount(mounts: Record<string, IFileSystem>): MountableFs {
  const hasBase = "/" in mounts;
  const base = hasBase ? mounts["/"] : new InMemoryFs();

  if (!hasBase) {
    initFilesystem(base, true);
  }

  const configs = Object.entries(mounts)
    .filter(([path]) => path !== "/")
    .map(([mountPoint, filesystem]) => ({ mountPoint, filesystem }));

  return new MountableFs({ base, mounts: configs });
}
