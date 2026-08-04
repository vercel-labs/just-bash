/**
 * base64 - Encode or decode base64
 */

import { latin1FromBytes } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { accountFileInput } from "../../utils/file-reader.js";
import { hasHelpFlag, showHelp } from "../help.js";

const base64Help = {
  name: "base64",
  summary: "base64 encode/decode data and print to standard output",
  usage: "base64 [OPTION]... [FILE]",
  options: [
    "-d, --decode    decode data",
    "-w, --wrap=COLS wrap encoded lines after COLS character (default 76, 0 to disable)",
    "    --help      display this help and exit",
  ],
};

const argDefs = {
  decode: { short: "d", long: "decode", type: "boolean" as const },
  wrap: { short: "w", long: "wrap", type: "number" as const, default: 76 },
};

function assertWithinLimit(
  value: number,
  limit: number,
  label: string,
  limitType: "string_length" | "output_size",
): void {
  if (value > limit) {
    throw new ExecutionLimitError(
      `base64: ${label} limit exceeded (${limit} bytes)`,
      limitType,
    );
  }
}

function bytesToBinaryString(data: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    chunks.push(
      String.fromCharCode(...data.subarray(offset, offset + chunkSize)),
    );
  }
  return chunks.join("");
}

function decodedLengthUpperBound(input: string): number {
  if (input.length === 0) return 0;
  const padding = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.ceil(input.length / 4) * 3 - padding);
}

// Helper to read file as binary
async function readBinary(
  ctx: RuntimeCommandContext,
  files: string[],
  cmdName: string,
): Promise<{ ok: true; data: Uint8Array } | { ok: false; error: ExecResult }> {
  const maxInputSize = Math.min(
    ctx.limits.maxInputBytes,
    ctx.limits.maxStringLength,
  );
  const stdinBinary = latin1FromBytes(ctx.stdin);
  // No files - read from stdin
  if (files.length === 0 || (files.length === 1 && files[0] === "-")) {
    assertWithinLimit(
      stdinBinary.length,
      maxInputSize,
      "input size",
      "string_length",
    );
    // Convert binary string directly to bytes without UTF-8 re-encoding
    return {
      ok: true,
      data: Uint8Array.from(stdinBinary, (c) => c.charCodeAt(0)),
    };
  }

  // Read and concatenate all files as binary
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for (const file of files) {
    if (file === "-") {
      assertWithinLimit(
        totalLength + stdinBinary.length,
        maxInputSize,
        "input size",
        "string_length",
      );
      // Convert binary string directly to bytes without UTF-8 re-encoding
      chunks.push(Uint8Array.from(stdinBinary, (c) => c.charCodeAt(0)));
      totalLength += stdinBinary.length;
      continue;
    }
    try {
      const filePath = ctx.fs.resolvePath(ctx.cwd, file);
      const stat = await ctx.fs.stat(filePath);
      assertWithinLimit(
        totalLength + stat.size,
        maxInputSize,
        "input size",
        "string_length",
      );
      const data = await ctx.fs.readFileBuffer(filePath);
      assertWithinLimit(
        totalLength + data.length,
        maxInputSize,
        "input size",
        "string_length",
      );
      accountFileInput(ctx, data.length, cmdName);
      chunks.push(data);
      totalLength += data.length;
    } catch (error) {
      rethrowFatalExecutionError(error);
      return {
        ok: false,
        error: {
          stdout: "",
          stderr: `${cmdName}: ${file}: No such file or directory\n`,
          exitCode: 1,
        },
      };
    }
  }

  // Concatenate all chunks
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return { ok: true, data: result };
}

export const base64Command: RuntimeCommand = {
  name: "base64",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(base64Help);
    }

    const parsed = parseArgs("base64", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const decode = parsed.result.flags.decode;
    const wrapCols = parsed.result.flags.wrap;
    const files = parsed.result.positional;

    if (!Number.isSafeInteger(wrapCols) || wrapCols < 0) {
      return {
        stdout: "",
        stderr: "base64: invalid wrap size\n",
        exitCode: 1,
      };
    }

    try {
      if (decode) {
        // For decoding, read as text and strip whitespace
        const readResult = await readBinary(ctx, files, "base64");
        if (!readResult.ok) return readResult.error;

        // Use Buffer if available (Node.js) for better large file handling
        if (typeof Buffer !== "undefined") {
          const buffer = Buffer.from(readResult.data);
          const cleaned = buffer.toString("utf8").replace(/\s/g, "");
          const estimatedLength = decodedLengthUpperBound(cleaned);
          assertWithinLimit(
            estimatedLength,
            ctx.limits.maxStringLength,
            "decoded size",
            "string_length",
          );
          assertWithinLimit(
            estimatedLength,
            ctx.limits.maxOutputSize,
            "output size",
            "output_size",
          );
          const decoded = Buffer.from(cleaned, "base64");
          assertWithinLimit(
            decoded.length,
            ctx.limits.maxOutputSize,
            "output size",
            "output_size",
          );
          // Convert to binary string (each char code = byte value)
          // Use Buffer's latin1 encoding which treats each byte as a character
          const result = decoded.toString("latin1");
          return {
            stdout: result,
            stderr: "",
            exitCode: 0,
            stdoutEncoding: "binary",
          };
        }

        // Browser fallback - use binary string (latin1) to preserve bytes for input
        const input = bytesToBinaryString(readResult.data);
        const cleaned = input.replace(/\s/g, "");
        const estimatedLength = decodedLengthUpperBound(cleaned);
        assertWithinLimit(
          estimatedLength,
          ctx.limits.maxStringLength,
          "decoded size",
          "string_length",
        );
        assertWithinLimit(
          estimatedLength,
          ctx.limits.maxOutputSize,
          "output size",
          "output_size",
        );
        // Decode base64 to binary string (each char code = byte value)
        const decoded = atob(cleaned);
        assertWithinLimit(
          decoded.length,
          ctx.limits.maxOutputSize,
          "output size",
          "output_size",
        );
        return {
          stdout: decoded,
          stderr: "",
          exitCode: 0,
          stdoutEncoding: "binary",
        };
      }

      // Encoding: read as binary
      const readResult = await readBinary(ctx, files, "base64");
      if (!readResult.ok) return readResult.error;

      const encodedLength = Math.ceil(readResult.data.length / 3) * 4;
      const newlineCount =
        wrapCols > 0 && encodedLength > 0
          ? Math.ceil(encodedLength / wrapCols)
          : 0;
      if (newlineCount > ctx.limits.maxArrayElements) {
        throw new ExecutionLimitError(
          `base64: wrapped line limit exceeded (${ctx.limits.maxArrayElements})`,
          "array_elements",
        );
      }
      assertWithinLimit(
        encodedLength,
        ctx.limits.maxStringLength,
        "encoded size",
        "string_length",
      );
      assertWithinLimit(
        encodedLength + newlineCount,
        ctx.limits.maxOutputSize,
        "output size",
        "output_size",
      );

      // Use Buffer if available (Node.js) for better large file handling
      let encoded: string;
      if (typeof Buffer !== "undefined") {
        const buffer = Buffer.from(readResult.data);
        encoded = buffer.toString("base64");
      } else {
        // Browser fallback - convert binary to base64
        encoded = btoa(bytesToBinaryString(readResult.data));
      }

      if (wrapCols > 0) {
        const lines: string[] = [];
        for (let i = 0; i < encoded.length; i += wrapCols) {
          lines.push(encoded.slice(i, i + wrapCols));
        }
        encoded = lines.join("\n") + (encoded.length > 0 ? "\n" : "");
      }
      return { stdout: encoded, stderr: "", exitCode: 0 };
    } catch (error) {
      rethrowFatalExecutionError(error);
      return { stdout: "", stderr: "base64: invalid input\n", exitCode: 1 };
    }
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "base64",
  flags: [
    { flag: "-d", type: "boolean" },
    { flag: "-w", type: "value", valueHint: "number" },
  ],
  stdinType: "text",
  needsFiles: true,
};
