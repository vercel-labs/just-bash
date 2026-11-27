import type { IFileSystem } from "./interface.js";

export async function readBatch(
  fs: IFileSystem,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<readonly PromiseSettledResult<Uint8Array>[]> {
  signal?.throwIfAborted();
  if (!paths.length) return [];
  const results = fs.readMany
    ? await fs.readMany(paths, { signal })
    : await Promise.allSettled(
        paths.map(async (path) => fs.readFileBuffer(path)),
      );
  signal?.throwIfAborted();
  if (results.length !== paths.length) {
    throw new Error("readMany must return one result per input path");
  }
  return results;
}
