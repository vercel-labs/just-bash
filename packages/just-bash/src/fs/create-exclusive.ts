import type { CreateExclusiveOptions, IFileSystem } from "./interface.js";

/**
 * Thrown by a delegating filesystem whose target backend does not implement
 * `createExclusive`, so callers can degrade deliberately.
 *
 * This is a type rather than an error message because backend errors embed
 * the caller-supplied path: matching text would let a template containing the
 * literal "ENOSYS" turn a genuine EEXIST into a spurious "unsupported" and
 * silently downgrade to the weaker create — precisely under the racing
 * conditions that make the atomic path matter.
 */
export class ExclusiveCreateUnsupportedError extends Error {
  readonly code = "ENOSYS";

  constructor(path: string, syscall: string) {
    super(`ENOSYS: exclusive create not supported, ${syscall} '${path}'`);
    this.name = "ExclusiveCreateUnsupportedError";
  }
}

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
    try {
      await fs.createExclusive(path, options);
      return;
    } catch (error) {
      // A wrapper such as MountableFs always defines the method but reports
      // ENOSYS when the backend it routes to does not implement it. Treat
      // that as "not supported" and degrade, rather than failing the caller.
      if (!(error instanceof ExclusiveCreateUnsupportedError)) {
        throw error;
      }
    }
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

  // The create above is not exclusive, so confirm what now sits at the path
  // is the kind of entry that was created. This does not close the race — it
  // cannot be closed without an atomic primitive — but it stops a path that
  // turned into a symlink from being reported as a private temporary file.
  const created = await fs.lstat(path);
  if (options.directory ? !created.isDirectory : !created.isFile) {
    throw new Error(`EEXIST: file already exists, open '${path}'`);
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
