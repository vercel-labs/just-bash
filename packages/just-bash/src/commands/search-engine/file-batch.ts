import type { IFileSystem } from "../../fs/interface.js";
import type { PreFilter } from "./regex.js";

/** Candidate membership never determines command ordering or duplicates. */
export async function getCandidates(
  fs: IFileSystem,
  paths: readonly string[],
  preFilter: PreFilter | undefined,
  signal?: AbortSignal,
): Promise<ReadonlySet<string> | undefined> {
  // Case folding differs across engines/locales, and rg preserves invalid
  // UTF-8 as raw bytes. Exact ASCII literals are safe for both decoders.
  if (
    !fs.searchCandidates ||
    !preFilter ||
    preFilter.ignoreCase ||
    preFilter.needles.some((needle) => /[^\x00-\x7f]/.test(needle)) ||
    !paths.length
  ) {
    return undefined;
  }
  signal?.throwIfAborted();
  const candidates = await fs.searchCandidates({
    paths,
    anyOf: preFilter.needles,
    signal,
  });
  signal?.throwIfAborted();
  return candidates === undefined ? undefined : new Set(candidates);
}
