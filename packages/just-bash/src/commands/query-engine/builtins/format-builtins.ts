/**
 * Format-related jq builtins (@ prefixed)
 *
 * Handles encoding/formatting functions like @base64, @uri, @csv, @json, etc.
 */

import type { QueryValue } from "../value-operations.js";
import { getValueDepth } from "../value-operations.js";

// Default max depth for nested structures
const DEFAULT_MAX_JQ_DEPTH = 2000;

function bytesToBinaryString(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.length);
    let chunk = "";
    for (let i = offset; i < end; i++) {
      chunk += String.fromCharCode(bytes[i]);
    }
    chunks.push(chunk);
  }
  return chunks.join("");
}

function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Handle format builtins (those starting with @).
 * Returns null if the builtin name is not a format builtin handled here.
 */
export function evalFormatBuiltin(
  value: QueryValue,
  name: string,
  maxDepth?: number,
): QueryValue[] | null {
  switch (name) {
    case "@base64":
      if (typeof value === "string") {
        // Use Buffer for Node.js, btoa for browser
        if (typeof Buffer !== "undefined") {
          return [Buffer.from(value, "utf-8").toString("base64")];
        }
        const bytes = new TextEncoder().encode(value);
        return [btoa(bytesToBinaryString(bytes))];
      }
      return [null];

    case "@base64d":
      if (typeof value === "string") {
        // Use Buffer for Node.js, atob for browser
        if (typeof Buffer !== "undefined") {
          return [Buffer.from(value, "base64").toString("utf-8")];
        }
        const bytes = binaryStringToBytes(atob(value));
        return [new TextDecoder("utf-8", { fatal: false }).decode(bytes)];
      }
      return [null];

    case "@uri":
      if (typeof value === "string") {
        // encodeURIComponent doesn't encode !'()*~ but jq encodes !'()*
        return [
          encodeURIComponent(value)
            .replace(/!/g, "%21")
            .replace(/'/g, "%27")
            .replace(/\(/g, "%28")
            .replace(/\)/g, "%29")
            .replace(/\*/g, "%2A"),
        ];
      }
      return [null];

    case "@urid":
      if (typeof value === "string") {
        return [decodeURIComponent(value)];
      }
      return [null];

    case "@csv": {
      if (!Array.isArray(value)) return [null];
      const csvEscaped = value.map((v) => {
        if (v === null) return "";
        if (typeof v === "boolean") return v ? "true" : "false";
        if (typeof v === "number") return String(v);
        // Only quote strings that contain special characters (comma, quote, newline)
        const s = String(v);
        if (
          s.includes(",") ||
          s.includes('"') ||
          s.includes("\n") ||
          s.includes("\r")
        ) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      });
      return [csvEscaped.join(",")];
    }

    case "@tsv": {
      if (!Array.isArray(value)) return [null];
      return [
        value
          .map((v) =>
            String(v ?? "")
              .replace(/\t/g, "\\t")
              .replace(/\n/g, "\\n"),
          )
          .join("\t"),
      ];
    }

    case "@json": {
      // Check depth to avoid V8 stack overflow during JSON.stringify
      const effectiveMaxDepth = maxDepth ?? DEFAULT_MAX_JQ_DEPTH;
      if (getValueDepth(value, effectiveMaxDepth + 1) > effectiveMaxDepth) {
        return [null];
      }
      return [JSON.stringify(value)];
    }

    case "@html":
      if (typeof value === "string") {
        return [
          value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/'/g, "&apos;")
            .replace(/"/g, "&quot;"),
        ];
      }
      return [null];

    case "@sh":
      if (typeof value === "string") {
        // Shell escape: wrap in single quotes, escape any single quotes
        return [`'${value.replace(/'/g, "'\\''")}'`];
      }
      return [null];

    case "@text":
      if (typeof value === "string") return [value];
      if (value === null || value === undefined) return [""];
      return [String(value)];

    default:
      return null;
  }
}
