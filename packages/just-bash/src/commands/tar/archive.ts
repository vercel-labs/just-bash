/**
 * Tar archive utilities using modern-tar
 *
 * Provides helpers for creating and extracting tar archives
 * with optional gzip, bzip2, and xz compression.
 */

import {
  createGzipDecoder,
  createGzipEncoder,
  type ParsedTarEntryWithData,
  packTar,
  type TarEntry,
  type TarHeader,
  unpackTar,
} from "modern-tar";
// @ts-expect-error - seek-bzip doesn't have types
import seekBzip from "seek-bzip";
import { utf8ByteLength } from "../../encoding.js";
import type {
  CommandExecutionBudget,
  ResourceLease,
} from "../../execution-scope.js";
import { DefenseInDepthBox } from "../../security/defense-in-depth-box.js";
import { CodecBudget } from "../compression/codec-budget.js";
import { bzip2Compress } from "./bzip2-compress.js";

// Lazy load node-liblzma since it requires native compilation
// that may fail on some systems (e.g., missing liblzma-dev)
let lzma: typeof import("node-liblzma") | null = null;
let lzmaLoadError: Error | null = null;

async function getLzma(): Promise<typeof import("node-liblzma")> {
  if (lzma) return lzma;
  if (lzmaLoadError) throw lzmaLoadError;
  try {
    // Native addons use dlopen which is blocked by defense-in-depth
    lzma = await DefenseInDepthBox.runTrustedAsync(
      () => import("node-liblzma"),
    );
    return lzma;
  } catch {
    lzmaLoadError = new Error(
      "xz compression requires node-liblzma which failed to load. " +
        "Install liblzma-dev (apt) or xz (brew) and reinstall dependencies.",
    );
    throw lzmaLoadError;
  }
}

// Lazy load @mongodb-js/zstd since it's an optional dependency
let zstd: typeof import("@mongodb-js/zstd") | null = null;
let zstdLoadError: Error | null = null;

async function getZstd(): Promise<typeof import("@mongodb-js/zstd")> {
  if (zstd) return zstd;
  if (zstdLoadError) throw zstdLoadError;
  try {
    zstd = await DefenseInDepthBox.runTrustedAsync(
      () => import("@mongodb-js/zstd"),
    );
    return zstd;
  } catch {
    zstdLoadError = new Error(
      "zstd compression requires @mongodb-js/zstd which is not installed. " +
        "Install it with: npm install @mongodb-js/zstd",
    );
    throw zstdLoadError;
  }
}

// Re-export types from modern-tar
export type { TarEntry, TarHeader, ParsedTarEntryWithData };

// Liberal standalone defaults. The tar command supplies its resolved profile.
const MAX_ARCHIVE_SIZE: number = 1024 * 1024 * 1024;
// Tar archives are 512-byte block aligned
const TAR_BLOCK_SIZE = 512;
// Maximum number of entries to prevent runaway compute
const MAX_ENTRIES: number = 1_000_000;

export interface ArchiveCreationLimits {
  maxArchiveSize?: number;
  maxEntries?: number;
  maxEntrySize?: number;
  maxCompressedSize?: number;
  maxExpansionRatio?: number;
  signal?: AbortSignal;
  /** Shared live-memory owner supplied by the tar command integration. */
  executionScope?: CommandExecutionBudget;
  /** Explicit trust boundary for native whole-buffer codecs. */
  allowTrustedWholeBufferCodecs?: boolean;
}

type ResolvedArchiveLimits = {
  maxArchiveSize: number;
  maxEntries: number;
  maxEntrySize: number;
  maxCompressedSize: number;
  maxExpansionRatio: number;
  signal?: AbortSignal;
  executionScope?: CommandExecutionBudget;
  allowTrustedWholeBufferCodecs: boolean;
};

function positiveLimit(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error("Archive limits must be positive safe integers");
  }
  return resolved;
}

function resolveCreationLimits(
  options?: ArchiveCreationLimits,
): ResolvedArchiveLimits {
  return {
    maxArchiveSize: positiveLimit(options?.maxArchiveSize, MAX_ARCHIVE_SIZE),
    maxEntries: positiveLimit(options?.maxEntries, MAX_ENTRIES),
    maxEntrySize: positiveLimit(options?.maxEntrySize, MAX_ARCHIVE_SIZE),
    maxCompressedSize: positiveLimit(
      options?.maxCompressedSize,
      options?.maxArchiveSize ?? MAX_ARCHIVE_SIZE,
    ),
    // 10,000:1 permits highly repetitive real archives while bounding codecs
    // independently of their aggregate output ceiling.
    maxExpansionRatio: positiveLimit(options?.maxExpansionRatio, 10_000),
    signal: options?.signal,
    executionScope: options?.executionScope,
    allowTrustedWholeBufferCodecs:
      options?.allowTrustedWholeBufferCodecs ?? false,
  };
}

function validateCreationBudget(
  entries: TarCreateEntry[],
  limits: ReturnType<typeof resolveCreationLimits>,
): number {
  if (entries.length > limits.maxEntries) {
    throw new Error(`Too many archive entries (max ${limits.maxEntries})`);
  }

  const addEstimated = (bytes: number): void => {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > limits.maxArchiveSize - estimatedSize
    ) {
      throw new Error(`Archive too large (max ${limits.maxArchiveSize} bytes)`);
    }
    estimatedSize += bytes;
  };

  // Account for the regular header, padded body, and prospective PAX metadata
  // before modern-tar receives the entry graph. Long UTF-8 names/link targets
  // produce a PAX header plus a variable-size record; a fixed extra block alone
  // does not bound attacker-controlled metadata.
  let estimatedSize = TAR_BLOCK_SIZE * 2;
  for (const entry of entries) {
    limits.signal?.throwIfAborted();
    const contentSize =
      entry.isDirectory || entry.isSymlink
        ? 0
        : typeof entry.content === "string"
          ? utf8ByteLength(entry.content)
          : (entry.content?.length ?? 0);
    if (contentSize > limits.maxEntrySize) {
      throw new Error(
        `Archive entry too large (max ${limits.maxEntrySize} bytes)`,
      );
    }
    const normalizedName =
      entry.isDirectory && !entry.name.endsWith("/")
        ? `${entry.name}/`
        : entry.name;
    const nameBytes = utf8ByteLength(normalizedName);
    const linkBytes = utf8ByteLength(entry.linkTarget ?? "");
    if (
      nameBytes > limits.maxArchiveSize ||
      linkBytes > limits.maxArchiveSize
    ) {
      throw new Error(`Archive too large (max ${limits.maxArchiveSize} bytes)`);
    }

    let paxPayloadBytes = 0;
    if (nameBytes > 100) paxPayloadBytes += nameBytes + 64;
    if (linkBytes > 100) paxPayloadBytes += linkBytes + 64;
    if (!Number.isSafeInteger(paxPayloadBytes)) {
      throw new Error(`Archive too large (max ${limits.maxArchiveSize} bytes)`);
    }
    const paddedContentSize =
      Math.ceil(contentSize / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    addEstimated(TAR_BLOCK_SIZE + paddedContentSize);
    if (paxPayloadBytes > 0) {
      const paddedPaxSize =
        Math.ceil(paxPayloadBytes / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
      // One header for the PAX extended record plus its padded payload.
      addEstimated(TAR_BLOCK_SIZE + paddedPaxSize);
    }
  }
  return estimatedSize;
}

function reserveArchiveBytes(
  limits: ResolvedArchiveLimits,
  kind: string,
  bytes: number,
): ResourceLease | undefined {
  return limits.executionScope?.reserveBytes(kind, bytes, `tar: ${kind}`);
}

function readTarSize(block: Uint8Array): number | undefined {
  const field = block.subarray(124, 136);
  // POSIX base-256 extension used for values that do not fit the octal field.
  if ((field[0] & 0x80) !== 0) {
    let size = field[0] & 0x7f;
    for (let index = 1; index < field.length; index++) {
      size = size * 256 + field[index];
      if (!Number.isSafeInteger(size)) return undefined;
    }
    return size;
  }
  const text = new TextDecoder("ascii")
    .decode(field)
    .replace(/\0.*$/, "")
    .trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) return undefined;
  const size = Number.parseInt(text, 8);
  return Number.isSafeInteger(size) ? size : undefined;
}

/** Validate entry budgets before modern-tar creates its entry object graph. */
function validateTarStructureBudget(
  data: Uint8Array,
  limits: ResolvedArchiveLimits,
): string | undefined {
  let offset = 0;
  let entries = 0;
  while (offset + TAR_BLOCK_SIZE <= data.length) {
    limits.signal?.throwIfAborted();
    const header = data.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) return undefined;
    entries++;
    if (entries > limits.maxEntries) {
      return `Too many entries (max ${limits.maxEntries})`;
    }
    const size = readTarSize(header);
    if (size === undefined) return "Invalid tar archive format";
    if (size > limits.maxEntrySize) {
      return `Archive entry too large (max ${limits.maxEntrySize} bytes)`;
    }
    const paddedSize = Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    if (!Number.isSafeInteger(paddedSize)) return "Invalid tar archive format";
    offset += TAR_BLOCK_SIZE + paddedSize;
    if (offset > data.length) return "Invalid tar archive format";
  }
  return offset === data.length ? undefined : "Invalid tar archive format";
}

/**
 * Entry for creating a tar archive
 */
export interface TarCreateEntry {
  name: string;
  content?: Uint8Array | string;
  mode?: number;
  mtime?: Date;
  isDirectory?: boolean;
  isSymlink?: boolean;
  linkTarget?: string;
  uid?: number;
  gid?: number;
}

/**
 * Convert our entry format to modern-tar format
 */
function toModernTarEntry(entry: TarCreateEntry): TarEntry {
  let type: TarHeader["type"] = "file";
  if (entry.isDirectory) {
    type = "directory";
  } else if (entry.isSymlink) {
    type = "symlink";
  }

  // Ensure directory names end with /
  let name = entry.name;
  if (entry.isDirectory && !name.endsWith("/")) {
    name += "/";
  }

  // Convert content to Uint8Array if string
  let body: Uint8Array | undefined;
  if (entry.content !== undefined) {
    if (typeof entry.content === "string") {
      body = new TextEncoder().encode(entry.content);
    } else {
      body = entry.content;
    }
  }

  const size = entry.isDirectory || entry.isSymlink ? 0 : (body?.length ?? 0);

  return {
    header: {
      name,
      mode: entry.mode ?? (entry.isDirectory ? 0o755 : 0o644),
      uid: entry.uid ?? 0,
      gid: entry.gid ?? 0,
      size,
      mtime: entry.mtime ?? new Date(),
      type,
      linkname: entry.linkTarget ?? "",
      uname: "user",
      gname: "user",
    },
    body,
  };
}

/**
 * Create a tar archive from entries
 */
export async function createArchive(
  entries: TarCreateEntry[],
  options?: ArchiveCreationLimits,
): Promise<Uint8Array> {
  const limits = resolveCreationLimits(options);
  const estimatedBytes = validateCreationBudget(entries, limits);
  const lease = reserveArchiveBytes(
    limits,
    "archive construction",
    estimatedBytes,
  );
  try {
    const modernEntries = entries.map(toModernTarEntry);
    const archive = await packTar(modernEntries);
    limits.signal?.throwIfAborted();
    if (archive.length > limits.maxArchiveSize) {
      throw new Error(`Archive too large (max ${limits.maxArchiveSize} bytes)`);
    }
    return archive;
  } finally {
    lease?.release();
  }
}

/**
 * Create a gzip-compressed tar archive from entries
 */
export async function createCompressedArchive(
  entries: TarCreateEntry[],
  options?: ArchiveCreationLimits,
): Promise<Uint8Array> {
  const limits = resolveCreationLimits(options);
  const tarBuffer = await createArchive(entries, limits);
  const inputLease = reserveArchiveBytes(
    limits,
    "gzip input",
    tarBuffer.byteLength,
  );
  const budget = new CodecBudget({
    maxInputBytes: limits.maxArchiveSize,
    maxOutputBytes: limits.maxCompressedSize,
    signal: limits.signal,
    label: "gzip archive",
  });
  budget.acceptInput(tarBuffer.length);

  // Use modern-tar's gzip encoder via Web Streams
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(tarBuffer);
      controller.close();
    },
  });

  const compressedStream = stream.pipeThrough(createGzipEncoder());
  const reader = compressedStream.getReader();
  const chunks: Uint8Array[] = [];
  const chunkLeases: ResourceLease[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      try {
        budget.acceptOutput(value.length);
        const chunkLease = reserveArchiveBytes(
          limits,
          "gzip chunks",
          value.byteLength,
        );
        if (chunkLease) chunkLeases.push(chunkLease);
      } catch (error) {
        await reader.cancel();
        throw error;
      }
      totalLength += value.length;
      chunks.push(value);
    }

    // Combining temporarily retains both the stream chunks and output array.
    const resultLease = reserveArchiveBytes(limits, "gzip result", totalLength);
    try {
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      return result;
    } finally {
      resultLease?.release();
    }
  } finally {
    for (const lease of chunkLeases) lease.release();
    inputLease?.release();
  }
}

/**
 * Parsed tar entry for extraction
 */
export interface ParsedEntry {
  name: string;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  mtime: Date;
  type: "file" | "directory" | "symlink" | "hardlink" | "other";
  linkTarget?: string;
  content: Uint8Array;
}

/**
 * Parse a tar archive and return entries
 */
export async function parseArchive(
  data: Uint8Array,
  options?: ArchiveCreationLimits,
): Promise<{ entries: ParsedEntry[]; error?: string }> {
  const limits = resolveCreationLimits(options);
  if (data.length > limits.maxArchiveSize) {
    return {
      entries: [],
      error: `Archive too large (max ${limits.maxArchiveSize} bytes)`,
    };
  }

  // Reject obviously malformed/truncated archives early.
  // A tar stream must contain at least one 512-byte block and be block-aligned.
  if (data.length < TAR_BLOCK_SIZE || data.length % TAR_BLOCK_SIZE !== 0) {
    return {
      entries: [],
      error: "Invalid tar archive format",
    };
  }

  const structureError = validateTarStructureBudget(data, limits);
  if (structureError) return { entries: [], error: structureError };

  try {
    const modernEntries = await unpackTar(data);
    const entries: ParsedEntry[] = [];

    for (const entry of modernEntries) {
      limits.signal?.throwIfAborted();
      if (entries.length >= limits.maxEntries) {
        return {
          entries: [],
          error: `Too many entries (max ${limits.maxEntries})`,
        };
      }
      const content = entry.data ?? new Uint8Array(0);
      if (
        entry.header.size > limits.maxEntrySize ||
        content.length > limits.maxEntrySize
      ) {
        return {
          entries: [],
          error: `Archive entry too large (max ${limits.maxEntrySize} bytes)`,
        };
      }

      let type: ParsedEntry["type"] = "file";
      switch (entry.header.type) {
        case "directory":
          type = "directory";
          break;
        case "symlink":
          type = "symlink";
          break;
        case "link":
          type = "hardlink";
          break;
        case "file":
          type = "file";
          break;
        default:
          type = "other";
      }

      entries.push({
        name: entry.header.name,
        mode: entry.header.mode ?? 0o644,
        uid: entry.header.uid ?? 0,
        gid: entry.header.gid ?? 0,
        size: entry.header.size,
        mtime: entry.header.mtime ?? new Date(),
        type,
        linkTarget: entry.header.linkname || undefined,
        content,
      });
    }

    return { entries };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { entries: [], error: msg };
  }
}

/**
 * Parse a gzip-compressed tar archive
 */
export async function parseCompressedArchive(
  data: Uint8Array,
  options?: ArchiveCreationLimits,
): Promise<{ entries: ParsedEntry[]; error?: string }> {
  const limits = resolveCreationLimits(options);
  if (data.length > limits.maxCompressedSize) {
    return {
      entries: [],
      error: `Archive too large (max ${limits.maxCompressedSize} bytes)`,
    };
  }

  try {
    const budget = new CodecBudget({
      maxInputBytes: limits.maxCompressedSize,
      maxOutputBytes: limits.maxArchiveSize,
      maxExpansionRatio: limits.maxExpansionRatio,
      signal: limits.signal,
      label: "gzip archive",
    });
    budget.acceptInput(data.length);
    // Use modern-tar's gzip decoder via Web Streams
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });

    const decompressedStream = stream.pipeThrough(createGzipDecoder());
    const reader = decompressedStream.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      try {
        budget.acceptOutput(value.length);
      } catch (error) {
        await reader.cancel();
        throw error;
      }
      totalLength += value.length;
      chunks.push(value);
    }

    // Combine chunks
    const tarBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      tarBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    return parseArchive(tarBuffer, limits);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { entries: [], error: `Decompression failed: ${msg}` };
  }
}

/**
 * Check if data is gzip compressed (magic bytes 0x1f 0x8b)
 */
export function isGzipCompressed(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

/**
 * Check if data is bzip2 compressed (magic bytes "BZh")
 */
export function isBzip2Compressed(data: Uint8Array): boolean {
  return (
    data.length >= 3 && data[0] === 0x42 && data[1] === 0x5a && data[2] === 0x68
  );
}

/**
 * Check if data is xz compressed (magic bytes 0xFD 0x37 0x7A 0x58 0x5A 0x00)
 */
export function isXzCompressed(data: Uint8Array): boolean {
  return (
    data.length >= 6 &&
    data[0] === 0xfd &&
    data[1] === 0x37 &&
    data[2] === 0x7a &&
    data[3] === 0x58 &&
    data[4] === 0x5a &&
    data[5] === 0x00
  );
}

/**
 * bzip2 decompression using seek-bzip (MIT licensed)
 */
async function decompressBzip2(
  data: Uint8Array,
  limits: ResolvedArchiveLimits,
): Promise<Uint8Array> {
  // seek-bzip's default output path repeatedly doubles one Buffer and only
  // returns after the whole stream is decoded. Supplying an output stream lets
  // us reject a compression bomb before allocating beyond the archive limit.
  const budget = new CodecBudget({
    maxInputBytes: limits.maxCompressedSize,
    maxOutputBytes: limits.maxArchiveSize,
    maxExpansionRatio: limits.maxExpansionRatio,
    signal: limits.signal,
    label: "bzip2 archive",
  });
  budget.acceptInput(data.length);
  const chunkSize = Math.min(64 * 1024, limits.maxArchiveSize);
  const chunks: Buffer[] = [];
  let current = Buffer.allocUnsafe(chunkSize);
  let currentLength = 0;
  let totalLength = 0;

  const output = {
    writeByte(byte: number): void {
      budget.acceptOutput(1);
      if (currentLength === current.length) {
        chunks.push(current);
        current = Buffer.allocUnsafe(chunkSize);
        currentLength = 0;
      }
      current[currentLength++] = byte;
      totalLength++;
    },
  };

  seekBzip.decode(Buffer.from(data), output);
  if (currentLength > 0) {
    chunks.push(current.subarray(0, currentLength));
  }

  return new Uint8Array(Buffer.concat(chunks, totalLength));
}

/**
 * bzip2 compression using our pure-JS implementation
 */
async function compressBzip2(
  data: Uint8Array,
  limits: ResolvedArchiveLimits,
): Promise<Uint8Array> {
  const budget = new CodecBudget({
    maxInputBytes: limits.maxArchiveSize,
    maxOutputBytes: limits.maxCompressedSize,
    signal: limits.signal,
    label: "bzip2 archive",
  });
  budget.acceptInput(data.length);
  const result = await bzip2Compress(
    data,
    9,
    limits.maxArchiveSize,
    limits.maxCompressedSize,
  );
  budget.acceptOutput(result.length);
  return result;
}

/**
 * xz/lzma decompression using node-liblzma
 */
async function decompressXz(data: Uint8Array): Promise<Uint8Array> {
  const lzmaModule = await getLzma();
  const decompressed = lzmaModule.unxzSync(Buffer.from(data));
  return new Uint8Array(decompressed);
}

/**
 * xz/lzma compression using node-liblzma
 */
async function compressXz(data: Uint8Array): Promise<Uint8Array> {
  const lzmaModule = await getLzma();
  const compressed = lzmaModule.xzSync(Buffer.from(data));
  return new Uint8Array(compressed);
}

/**
 * Create a bzip2-compressed tar archive from entries
 */
export async function createBzip2CompressedArchive(
  entries: TarCreateEntry[],
  options?: ArchiveCreationLimits,
): Promise<Uint8Array> {
  const limits = resolveCreationLimits(options);
  const tarBuffer = await createArchive(entries, limits);
  return compressBzip2(tarBuffer, limits);
}

/**
 * Create an xz-compressed tar archive from entries.
 *
 * @param entries - Archive entries to include
 * @param options - Options controlling compression behavior
 * @param options.allowNativeCodecs - When false (default), rejects xz compression
 *   to avoid passing attacker-controlled bytes to native addons (node-liblzma).
 */
export async function createXzCompressedArchive(
  entries: TarCreateEntry[],
  options?: ArchiveCreationLimits & { allowNativeCodecs?: boolean },
): Promise<Uint8Array> {
  const limits = resolveCreationLimits(options);
  if (!options?.allowNativeCodecs || !limits.allowTrustedWholeBufferCodecs) {
    throw new Error(
      "xz compression is disabled by default (native codec risk). The whole-buffer codec must be explicitly trusted. " +
        "Pass both { allowNativeCodecs: true, allowTrustedWholeBufferCodecs: true } to opt in.",
    );
  }
  const tarBuffer = await createArchive(entries, limits);
  const compressed = await compressXz(tarBuffer);
  limits.signal?.throwIfAborted();
  if (compressed.length > limits.maxCompressedSize) {
    throw new Error(
      `xz archive: output exceeds limit (${limits.maxCompressedSize} bytes)`,
    );
  }
  return compressed;
}

/**
 * Parse a bzip2-compressed tar archive
 */
export async function parseBzip2CompressedArchive(
  data: Uint8Array,
  options?: ArchiveCreationLimits & { maxDecompressedSize?: number },
): Promise<{ entries: ParsedEntry[]; error?: string }> {
  const limits = resolveCreationLimits({
    ...options,
    maxArchiveSize: options?.maxDecompressedSize ?? options?.maxArchiveSize,
  });
  if (data.length > limits.maxCompressedSize) {
    return {
      entries: [],
      error: `Archive too large (max ${limits.maxCompressedSize} bytes)`,
    };
  }

  try {
    const tarBuffer = await decompressBzip2(data, limits);
    return parseArchive(tarBuffer, limits);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (
      msg ===
      `bzip2 archive: output exceeds limit (${limits.maxArchiveSize} bytes)`
    ) {
      return {
        entries: [],
        error: `Decompressed archive too large (max ${limits.maxArchiveSize} bytes)`,
      };
    }
    return { entries: [], error: msg };
  }
}

/**
 * Parse an xz-compressed tar archive.
 *
 * @param data - Raw archive bytes
 * @param options - Options controlling decompression behavior
 * @param options.allowNativeCodecs - When false (default), rejects xz decompression
 *   to avoid passing untrusted bytes to native addons (node-liblzma).
 */
export async function parseXzCompressedArchive(
  data: Uint8Array,
  options?: ArchiveCreationLimits & { allowNativeCodecs?: boolean },
): Promise<{ entries: ParsedEntry[]; error?: string }> {
  const limits = resolveCreationLimits(options);
  if (!options?.allowNativeCodecs || !limits.allowTrustedWholeBufferCodecs) {
    return {
      entries: [],
      error:
        "xz decompression is disabled by default (native codec risk). The whole-buffer codec must be explicitly trusted. " +
        "Pass both { allowNativeCodecs: true, allowTrustedWholeBufferCodecs: true } to opt in, or decompress the archive externally before extraction.",
    };
  }

  if (data.length > limits.maxCompressedSize) {
    return {
      entries: [],
      error: `Archive too large (max ${limits.maxCompressedSize} bytes)`,
    };
  }

  try {
    const tarBuffer = await decompressXz(data);
    limits.signal?.throwIfAborted();
    if (tarBuffer.length > limits.maxArchiveSize) {
      return {
        entries: [],
        error: `Trusted xz codec produced data over limit (${limits.maxArchiveSize} bytes)`,
      };
    }
    return parseArchive(tarBuffer, limits);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { entries: [], error: msg };
  }
}

/**
 * Check if data is zstd compressed (magic number 0x28 0xB5 0x2F 0xFD)
 */
export function isZstdCompressed(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x28 &&
    data[1] === 0xb5 &&
    data[2] === 0x2f &&
    data[3] === 0xfd
  );
}

/**
 * zstd compression using @mongodb-js/zstd
 */
async function compressZstd(data: Uint8Array): Promise<Uint8Array> {
  const zstdModule = await getZstd();
  const compressed = await zstdModule.compress(Buffer.from(data), 3);
  return new Uint8Array(compressed);
}

/**
 * zstd decompression using @mongodb-js/zstd
 */
async function decompressZstd(data: Uint8Array): Promise<Uint8Array> {
  const zstdModule = await getZstd();
  const decompressed = await zstdModule.decompress(Buffer.from(data));
  return new Uint8Array(decompressed);
}

/**
 * Create a zstd-compressed tar archive from entries.
 *
 * @param entries - Archive entries to include
 * @param options - Options controlling compression behavior
 * @param options.allowNativeCodecs - When false (default), rejects zstd compression
 *   to avoid passing attacker-controlled bytes to native addons (@mongodb-js/zstd).
 */
export async function createZstdCompressedArchive(
  entries: TarCreateEntry[],
  options?: ArchiveCreationLimits & { allowNativeCodecs?: boolean },
): Promise<Uint8Array> {
  const limits = resolveCreationLimits(options);
  if (!options?.allowNativeCodecs || !limits.allowTrustedWholeBufferCodecs) {
    throw new Error(
      "zstd compression is disabled by default (native codec risk). The whole-buffer codec must be explicitly trusted. " +
        "Pass both { allowNativeCodecs: true, allowTrustedWholeBufferCodecs: true } to opt in.",
    );
  }
  const tarBuffer = await createArchive(entries, limits);
  const compressed = await compressZstd(tarBuffer);
  limits.signal?.throwIfAborted();
  if (compressed.length > limits.maxCompressedSize) {
    throw new Error(
      `zstd archive: output exceeds limit (${limits.maxCompressedSize} bytes)`,
    );
  }
  return compressed;
}

/**
 * Parse a zstd-compressed tar archive.
 *
 * @param data - Raw archive bytes
 * @param options - Options controlling decompression behavior
 * @param options.allowNativeCodecs - When false (default), rejects zstd decompression
 *   to avoid passing untrusted bytes to native addons (@mongodb-js/zstd).
 */
export async function parseZstdCompressedArchive(
  data: Uint8Array,
  options?: ArchiveCreationLimits & { allowNativeCodecs?: boolean },
): Promise<{ entries: ParsedEntry[]; error?: string }> {
  const limits = resolveCreationLimits(options);
  if (!options?.allowNativeCodecs || !limits.allowTrustedWholeBufferCodecs) {
    return {
      entries: [],
      error:
        "zstd decompression is disabled by default (native codec risk). The whole-buffer codec must be explicitly trusted. " +
        "Pass both { allowNativeCodecs: true, allowTrustedWholeBufferCodecs: true } to opt in, or decompress the archive externally before extraction.",
    };
  }

  if (data.length > limits.maxCompressedSize) {
    return {
      entries: [],
      error: `Archive too large (max ${limits.maxCompressedSize} bytes)`,
    };
  }

  try {
    const tarBuffer = await decompressZstd(data);
    limits.signal?.throwIfAborted();
    if (tarBuffer.length > limits.maxArchiveSize) {
      return {
        entries: [],
        error: `Trusted zstd codec produced data over limit (${limits.maxArchiveSize} bytes)`,
      };
    }
    return parseArchive(tarBuffer, limits);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { entries: [], error: msg };
  }
}
