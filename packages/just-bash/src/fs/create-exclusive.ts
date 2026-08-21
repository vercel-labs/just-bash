import type { CreateExclusiveOptions, IFileSystem } from "./interface.js";

/**
 * Create a file or directory that must not already exist, with `mode` applied
 * at creation time.
 *
 * Prefer this over calling `fs.createExclusive` directly: the method is
 * optional on `IFileSystem` so user-supplied filesystems predating it keep
 * working, and routing every caller through here means they all degrade the
 * same way instead of each inventing a fallback.
 *
 * The fallback is genuinely weaker — there is no way to synthesise atomicity
 * out of separate check and create calls — so it is best effort: it refuses a
 * name that `lstat` shows as taken (unlike `exists`, this sees a dangling
 * symlink rather than looking through it), and removes the entry if the mode
 * cannot be applied, so a loose-mode artifact is never left behind.
 *
 * @throws Error with an `EEXIST:` message if the path is already taken
 */
export async function createExclusiveOn(
  fs: Pick<
    IFileSystem,
    "createExclusive" | "lstat" | "mkdir" | "writeFile" | "chmod" | "rm"
  >,
  path: string,
  options: CreateExclusiveOptions,
): Promise<void> {
  if (fs.createExclusive) {
    await fs.createExclusive(path, options);
    return;
  }

  let taken = true;
  try {
    await fs.lstat(path);
  } catch {
    taken = false;
  }
  if (taken) {
    throw new Error(`EEXIST: file already exists, open '${path}'`);
  }

  if (options.directory) {
    await fs.mkdir(path);
  } else {
    await fs.writeFile(path, "");
  }

  try {
    await fs.chmod(path, options.mode);
  } catch (error) {
    await fs
      .rm(path, { recursive: options.directory, force: true })
      .catch(() => {});
    throw error;
  }
}
