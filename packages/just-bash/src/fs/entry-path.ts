import type { FsStat, IFileSystem } from "./interface.js";

interface EntryPathOperations {
  lstat?(path: string): Promise<FsStat>;
  realpath?(path: string): Promise<string>;
}

const entryPathOperations = Symbol("entryPathOperations");
type FileSystemWithEntryOperations = IFileSystem & {
  [entryPathOperations]?: EntryPathOperations;
};

export function registerEntryPathOperations(
  fs: IFileSystem,
  ops: EntryPathOperations,
): void {
  // @banned-pattern-ignore: the key is a module-local symbol, independent of user input.
  Object.defineProperty(fs, entryPathOperations, {
    configurable: true,
    value: ops,
  });
}

/** Inspect an entry without loading a lazy file just to determine its type. */
export function lstatEntry(fs: IFileSystem, path: string): Promise<FsStat> {
  return (
    (fs as FileSystemWithEntryOperations)[entryPathOperations]?.lstat?.(path) ??
    fs.lstat(path)
  );
}

/** Resolve a path that will be used for a mutation on the original mount. */
export function realpathOnMount(
  fs: IFileSystem,
  path: string,
): Promise<string> {
  return (
    (fs as FileSystemWithEntryOperations)[entryPathOperations]?.realpath?.(
      path,
    ) ?? fs.realpath(path)
  );
}
