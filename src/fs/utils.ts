/**
 * Shared utilities for filesystem implementations
 */

import type {
  BufferEncoding,
  ReadFileOptions,
  WriteFileOptions,
} from "./interface.js";

export type FileContent = string | Uint8Array;

// Text encoder/decoder for encoding conversions
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Helper to convert content to Uint8Array
 */
export function toBuffer(
  content: FileContent,
  encoding?: BufferEncoding,
): Uint8Array {
  if (content instanceof Uint8Array) {
    return content;
  }

  switch (encoding) {
    case "base64":
      return Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
    case "hex": {
      const bytes = new Uint8Array(content.length / 2);
      for (let i = 0; i < content.length; i += 2) {
        bytes[i / 2] = parseInt(content.slice(i, i + 2), 16);
      }
      return bytes;
    }
    case "binary":
    case "latin1":
      return Uint8Array.from(content, (c) => c.charCodeAt(0));
    default:
      // utf8 or utf-8 or ascii
      return textEncoder.encode(content);
  }
}

/**
 * Helper to convert Uint8Array to string with encoding
 */
export function fromBuffer(
  buffer: Uint8Array,
  encoding?: BufferEncoding | null,
): string {
  switch (encoding) {
    case "base64":
      return btoa(String.fromCharCode(...buffer));
    case "hex":
      return Array.from(buffer)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    case "binary":
    case "latin1":
      return String.fromCharCode(...buffer);
    default:
      // utf8 or utf-8 or ascii or null
      return textDecoder.decode(buffer);
  }
}

/**
 * Helper to get encoding from options
 */
export function getEncoding(
  options?: ReadFileOptions | WriteFileOptions | BufferEncoding | string | null,
): BufferEncoding | undefined {
  if (options === null || options === undefined) {
    return undefined;
  }
  if (typeof options === "string") {
    return options as BufferEncoding;
  }
  return options.encoding ?? undefined;
}
