import { InMemoryFs } from "../fs/in-memory-fs/in-memory-fs.js";
import type { IFileSystem, SearchCandidatesRequest } from "../fs/interface.js";

/** A set-based backend fixture; bulk reads access stored blobs directly. */
export function remoteFs(
  files: Record<string, string | Uint8Array>,
  options: {
    decline?: boolean;
    falsePositives?: boolean;
    unreadable?: string;
  } = {},
): {
  fs: IFileSystem;
  batches: string[][];
  searches: SearchCandidatesRequest[];
} {
  const fs: IFileSystem = new InMemoryFs(files);
  const blobs = new Map(
    Object.entries(files).map(([path, content]) => [
      path,
      typeof content === "string" ? new TextEncoder().encode(content) : content,
    ]),
  );
  const batches: string[][] = [];
  const searches: SearchCandidatesRequest[] = [];
  const originalRead = fs.readFile.bind(fs);
  fs.readFile = async (path, encoding) => {
    if (path === options.unreadable) throw new Error("EACCES");
    return originalRead(path, encoding);
  };
  fs.readMany = async (paths) => {
    batches.push([...paths]);
    return paths.map((path): PromiseSettledResult<Uint8Array> => {
      const value = blobs.get(path);
      return value && path !== options.unreadable
        ? { status: "fulfilled", value }
        : { status: "rejected", reason: new Error("EACCES") };
    });
  };
  fs.searchCandidates = async (request) => {
    searches.push(request);
    if (options.decline) return undefined;
    return request.paths
      .filter((path) => {
        const bytes = blobs.get(path);
        return (
          !bytes ||
          path === options.unreadable ||
          options.falsePositives ||
          request.anyOf.some((needle) =>
            new TextDecoder().decode(bytes).includes(needle),
          )
        );
      })
      .reverse(); // Backend ordering must not change command output.
  };
  return { fs, batches, searches };
}
