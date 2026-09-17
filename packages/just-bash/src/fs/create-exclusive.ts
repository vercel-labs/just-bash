import type { CreateExclusiveOptions, IFileSystem } from "./interface.js";

/**
 * Thrown when the filesystem cannot create an entry atomically, either
 * because it does not implement `createExclusive` or because a delegating
 * filesystem routes to a backend that does not.
 *
 * This is a type rather than an error message because backend errors embed
 * the caller-supplied path: matching text would let a template containing the
 * literal "ENOSYS" turn a genuine EEXIST into a spurious "unsupported".
 */
export class ExclusiveCreateUnsupportedError extends Error {
  readonly code = "ENOSYS";

  constructor(path: string, syscall: string) {
    super(
      `ENOSYS: filesystem cannot create entries atomically, ${syscall} '${path}'`,
    );
    this.name = "ExclusiveCreateUnsupportedError";
  }
}

/**
 * Create a file or directory that must not already exist, with `mode` applied
 * at creation time.
 *
 * There is deliberately no fallback for filesystems lacking
 * `createExclusive`. Exclusivity and privacy cannot be synthesised from
 * separate check, create and chmod calls: between them a concurrent actor can
 * take the name and have its entry truncated, or install a symlink so the
 * write lands on its target, and the entry is briefly readable at the
 * backend's default mode either way. A caller asking for an exclusive private
 * entry that silently received a racy one is worse off than a caller told the
 * filesystem cannot provide it, so this fails loudly instead.
 *
 * @throws ExclusiveCreateUnsupportedError if the filesystem cannot do this
 */
export async function createExclusiveOn(
  fs: Pick<IFileSystem, "createExclusive">,
  path: string,
  options: CreateExclusiveOptions,
): Promise<void> {
  if (!fs.createExclusive) {
    throw new ExclusiveCreateUnsupportedError(
      path,
      options.directory ? "mkdir" : "open",
    );
  }
  await fs.createExclusive(path, options);
}
