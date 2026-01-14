/**
 * Tar archive utilities using modern-tar
 *
 * Provides helpers for creating and extracting tar archives
 * with optional gzip, bzip2, and xz compression.
 */

import * as zstd from "@mongodb-js/zstd";
// @ts-expect-error - compressjs doesn't have types
import compressjs from "compressjs";
import {
  createGzipDecoder,
  createGzipEncoder,
  type ParsedTarEntryWithData,
  packTar,
  type TarEntry,
  type TarHeader,
  unpackTar,
} from "modern-tar";

// Lazy load node-liblzma since it requires native compilation
// that may fail on some systems (e.g., missing liblzma-dev)
let lzma: typeof import("node-liblzma") | null = null;
let lzmaLoadError: Error | null = null;

async function getLzma(): Promise<typeof import("node-liblzma")> {
  if (lzma) return lzma;
  if (lzmaLoadError) throw lzmaLoadError;
  try {
    lzma = await import("node-liblzma");
    return lzma;
  } catch {
    lzmaLoadError = new Error(
      "xz compression requires node-liblzma which failed to load. " +
        "Install liblzma-dev (apt) or xz (brew) and reinstall dependencies.",
    );
    throw lzmaLoadError;
  }
}

// Re-export types from modern-tar
export type { TarEntry, TarHeader, ParsedTarEntryWithData };

// Maximum archive size to prevent runaway compute (100MB)
const MAX_ARCHIVE_SIZE: number = 100 * 1024 * 1024;
// Maximum number of entries to prevent runaway compute
const MAX_ENTRIES: number = 10000;

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
): Promise<Uint8Array> {
  const modernEntries = entries.map(toModernTarEntry);
  return packTar(modernEntries);
}

/**
 * Create a gzip-compressed tar archive from entries
 */
export async function createCompressedArchive(
  entries: TarCreateEntry[],
): Promise<Uint8Array> {
  const tarBuffer = await createArchive(entries);

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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Combine chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
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
): Promise<{ entries: ParsedEntry[]; error?: string }> {
  if (data.length > MAX_ARCHIVE_SIZE) {
    return {
      entries: [],
      error: `Archive too large (max ${MAX_ARCHIVE_SIZE} bytes)`,
    };
  }

  try {
    const modernEntries = await unpackTar(data);
    const entries: ParsedEntry[] = [];

    for (const entry of modernEntries) {
      if (entries.length >= MAX_ENTRIES) {
        return { entries, error: `Too many entries (max ${MAX_ENTRIES})` };
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
        content: entry.data ?? new Uint8Array(0),
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
): Promise<{ entries: ParsedEntry[]; error?: string }> {
  if (data.length > MAX_ARCHIVE_SIZE) {
    return {
      entries: [],
      error: `Archive too large (max ${MAX_ARCHIVE_SIZE} bytes)`,
    };
  }

  try {
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    // Combine chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const tarBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      tarBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    return parseArchive(tarBuffer);
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
 * bzip2 decompression using compressjs
 */
async function decompressBzip2(data: Uint8Array): Promise<Uint8Array> {
  const Bzip2 = compressjs.Bzip2;
  // decompressFile accepts an array/buffer directly
  const decompressed = Bzip2.decompressFile(Array.from(data));
  return new Uint8Array(decompressed);
}

/**
 * bzip2 compression using compressjs
 */
async function compressBzip2(data: Uint8Array): Promise<Uint8Array> {
  const Bzip2 = compressjs.Bzip2;
  // compressFile accepts input array and output array directly
  // coerceInputStream/coerceOutputStream handle the conversion
  const output: number[] = [];
  Bzip2.compressFile(Array.from(data), output, 9); // block size level 9
  return new Uint8Array(output);
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
): Promise<Uint8Array> {
  const tarBuffer = await createArchive(entries);
  return compressBzip2(tarBuffer);
}

/**
 * Create an xz-compressed tar archive from entries
 */
export async function createXzCompressedArchive(
  entries: TarCreateEntry[],
): Promise<Uint8Array> {
  const tarBuffer = await createArchive(entries);
  return compressXz(tarBuffer);
}

/**
 * Parse a bzip2-compressed tar archive
 */
export async function parseBzip2CompressedArchive(
  data: Uint8Array,
): Promise<{ entries: ParsedEntry[]; error?: string }> {
  if (data.length > MAX_ARCHIVE_SIZE) {
    return {
      entries: [],
      error: `Archive too large (max ${MAX_ARCHIVE_SIZE} bytes)`,
    };
  }

  try {
    const tarBuffer = await decompressBzip2(data);
    return parseArchive(tarBuffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { entries: [], error: msg };
  }
}

/**
 * Parse an xz-compressed tar archive
 */
export async function parseXzCompressedArchive(
  data: Uint8Array,
): Promise<{ entries: ParsedEntry[]; error?: string }> {
  if (data.length > MAX_ARCHIVE_SIZE) {
    return {
      entries: [],
      error: `Archive too large (max ${MAX_ARCHIVE_SIZE} bytes)`,
    };
  }

  try {
    const tarBuffer = await decompressXz(data);
    return parseArchive(tarBuffer);
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
  const compressed = await zstd.compress(Buffer.from(data), 3);
  return new Uint8Array(compressed);
}

/**
 * zstd decompression using @mongodb-js/zstd
 */
async function decompressZstd(data: Uint8Array): Promise<Uint8Array> {
  const decompressed = await zstd.decompress(Buffer.from(data));
  return new Uint8Array(decompressed);
}

/**
 * Create a zstd-compressed tar archive from entries
 */
export async function createZstdCompressedArchive(
  entries: TarCreateEntry[],
): Promise<Uint8Array> {
  const tarBuffer = await createArchive(entries);
  return compressZstd(tarBuffer);
}

/**
 * Parse a zstd-compressed tar archive
 */
export async function parseZstdCompressedArchive(
  data: Uint8Array,
): Promise<{ entries: ParsedEntry[]; error?: string }> {
  if (data.length > MAX_ARCHIVE_SIZE) {
    return {
      entries: [],
      error: `Archive too large (max ${MAX_ARCHIVE_SIZE} bytes)`,
    };
  }

  try {
    const tarBuffer = await decompressZstd(data);
    return parseArchive(tarBuffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { entries: [], error: msg };
  }
}
