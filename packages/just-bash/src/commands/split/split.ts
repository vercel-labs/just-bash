/**
 * split - split a file into pieces
 *
 * Usage: split [OPTION]... [FILE [PREFIX]]
 *
 * Output pieces of FILE to PREFIXaa, PREFIXab, ...;
 * default size is 1000 lines, and default PREFIX is 'x'.
 */

import { latin1FromBytes, utf8ByteLength } from "../../encoding.js";
import type { ResourceLease } from "../../execution-scope.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import {
  type ResolvedFileIdentity,
  resolveFileIdentity,
} from "../../fs/traversal.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

const splitHelp = {
  name: "split",
  summary: "split a file into pieces",
  usage: "split [OPTION]... [FILE [PREFIX]]",
  description:
    "Output pieces of FILE to PREFIXaa, PREFIXab, ...; default size is 1000 lines, and default PREFIX is 'x'.",
  options: [
    "-l N         Put N lines per output file",
    "-b SIZE      Put SIZE bytes per output file (K, M, G suffixes)",
    "-n CHUNKS    Split into CHUNKS equal-sized files",
    "-d           Use numeric suffixes (00, 01, ...) instead of alphabetic",
    "-a LENGTH    Use suffixes of length LENGTH (default: 2)",
    "--additional-suffix=SUFFIX  Append SUFFIX to file names",
  ],
  examples: [
    "split -l 100 file.txt        # Split into 100-line chunks",
    "split -b 1M file.bin         # Split into 1MB chunks",
    "split -n 5 file.txt          # Split into 5 equal parts",
    "split -d file.txt part_      # part_00, part_01, ...",
    "split -a 3 -d file.txt x     # x000, x001, ...",
  ],
};

/** Maximum number of output files to prevent resource exhaustion */
const MAX_OUTPUT_FILES = 100_000;
let splitTransactionId = 0;

function toUint8Array(content: string): Uint8Array {
  return Uint8Array.from(content, (char) => char.charCodeAt(0));
}

type SplitMode = "lines" | "bytes" | "chunks";

interface SplitOptions {
  mode: SplitMode;
  lines: number;
  bytes: number;
  chunks: number;
  useNumericSuffix: boolean;
  suffixLength: number;
  additionalSuffix: string;
}

/**
 * Parse a size string like "10K", "1M", "2G" into bytes.
 */
function parseSize(sizeStr: string): number | null {
  const match = sizeStr.match(/^(\d+)([KMGTPEZY]?)([B]?)$/i);
  if (!match) {
    return null;
  }

  const num = Number(match[1]);
  if (!Number.isSafeInteger(num) || num < 1) {
    return null;
  }

  const suffix = (match[2] || "").toUpperCase();
  const multipliers = new Map<string, number>([
    ["", 1],
    ["K", 1024],
    ["M", 1024 * 1024],
    ["G", 1024 * 1024 * 1024],
    ["T", 1024 * 1024 * 1024 * 1024],
    ["P", 1024 * 1024 * 1024 * 1024 * 1024],
  ]);

  const multiplier = multipliers.get(suffix);
  if (multiplier === undefined) {
    return null;
  }

  if (num > Math.floor(Number.MAX_SAFE_INTEGER / multiplier)) return null;
  return num * multiplier;
}

function parsePositiveSafeInteger(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * Generate suffix for a given index.
 * For alphabetic: aa, ab, ..., az, ba, bb, ..., zz, aaa, aab, ...
 * For numeric: 00, 01, ..., 99, 000, 001, ...
 */
function generateSuffix(
  index: number,
  useNumeric: boolean,
  length: number,
): string {
  if (useNumeric) {
    return index.toString().padStart(length, "0");
  }

  // Alphabetic suffix
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const suffix = new Array<string>(length);
  let remaining = index;

  for (let i = length - 1; i >= 0; i--) {
    suffix[i] = chars[remaining % 26];
    remaining = Math.floor(remaining / 26);
  }

  return suffix.join("");
}

/**
 * Split content by lines.
 */
function splitByLines(content: Uint8Array, linesPerFile: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let start = 0;
  let lines = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== 0x0a) continue;
    lines++;
    if (lines === linesPerFile) {
      chunks.push(content.subarray(start, i + 1));
      start = i + 1;
      lines = 0;
    }
  }
  if (start < content.length) chunks.push(content.subarray(start));
  return chunks;
}

/**
 * Split content by bytes.
 */
function splitByBytes(content: Uint8Array, bytesPerFile: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < content.length; i += bytesPerFile)
    chunks.push(content.subarray(i, i + bytesPerFile));
  return chunks;
}

/**
 * Split content into N equal chunks.
 */
function splitIntoChunks(content: Uint8Array, numChunks: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  const bytesPerChunk = Math.ceil(content.length / numChunks);

  for (let i = 0; i < numChunks; i++) {
    const start = i * bytesPerChunk;
    const end = Math.min(start + bytesPerChunk, content.length);
    if (start < end) chunks.push(content.subarray(start, end));
  }
  return chunks;
}

function suffixCapacity(numeric: boolean, length: number): number {
  const capacity = numeric ? 10 ** length : 26 ** length;
  return Number.isSafeInteger(capacity) ? capacity : Number.MAX_SAFE_INTEGER;
}

interface PlannedOutput {
  readonly path: string;
  readonly displayName: string;
  readonly content: Uint8Array;
  readonly initialIdentity: ResolvedFileIdentity;
  stagePath: string;
  backupPath?: string;
  committed: boolean;
}

function identityKey(identity: ResolvedFileIdentity): string | undefined {
  if (identity.existence === "unknown") return undefined;
  if (identity.existence === "existing") return identity.stableIdentity;
  return identity.canonicalPath === undefined
    ? undefined
    : `missing:${identity.canonicalPath}`;
}

function identityUnchanged(
  initial: ResolvedFileIdentity,
  current: ResolvedFileIdentity,
): boolean {
  if (initial.existence !== current.existence) return false;
  if (initial.existence === "unknown" || current.existence === "unknown") {
    return false;
  }
  if (initial.existence === "missing" && current.existence === "missing") {
    return initial.canonicalPath === current.canonicalPath;
  }
  if (initial.existence === "existing" && current.existence === "existing") {
    return (
      initial.stableIdentity !== undefined &&
      initial.stableIdentity === current.stableIdentity
    );
  }
  return false;
}

async function uniqueSiblingPath(
  ctx: CommandContext,
  outputPath: string,
  purpose: "stage" | "backup",
): Promise<string> {
  const slash = outputPath.lastIndexOf("/");
  const parent = slash <= 0 ? "/" : outputPath.slice(0, slash);
  const basename = outputPath.slice(slash + 1);
  for (let attempts = 0; attempts < 100; attempts++) {
    const id = splitTransactionId++;
    const candidate = ctx.fs.resolvePath(
      parent,
      `.${basename}.just-bash-split-${purpose}-${id}`,
    );
    const identity = await resolveFileIdentity(ctx.fs, candidate);
    if (identity.existence === "missing") return candidate;
    if (identity.existence === "unknown") break;
  }
  throw new Error("unable to allocate transaction path");
}

export const split: Command = {
  name: "split",
  execute: async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
    if (hasHelpFlag(args)) {
      return showHelp(splitHelp);
    }

    const options: SplitOptions = {
      mode: "lines",
      lines: 1000,
      bytes: 0,
      chunks: 0,
      useNumericSuffix: false,
      suffixLength: 2,
      additionalSuffix: "",
    };

    const positionalArgs: string[] = [];
    let i = 0;

    while (i < args.length) {
      const arg = args[i];

      if (arg === "-l" && i + 1 < args.length) {
        const lines = parsePositiveSafeInteger(args[i + 1]);
        if (lines === null) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `split: invalid number of lines: '${args[i + 1]}'\n`,
          };
        }
        options.mode = "lines";
        options.lines = lines;
        i += 2;
      } else if (arg.match(/^-l\d+$/)) {
        const lines = parsePositiveSafeInteger(arg.slice(2));
        if (lines === null) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `split: invalid number of lines: '${arg.slice(2)}'\n`,
          };
        }
        options.mode = "lines";
        options.lines = lines;
        i++;
      } else if (arg === "-b" && i + 1 < args.length) {
        const bytes = parseSize(args[i + 1]);
        if (bytes === null) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `split: invalid number of bytes: '${args[i + 1]}'\n`,
          };
        }
        options.mode = "bytes";
        options.bytes = bytes;
        i += 2;
      } else if (arg.match(/^-b.+$/)) {
        const bytes = parseSize(arg.slice(2));
        if (bytes === null) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `split: invalid number of bytes: '${arg.slice(2)}'\n`,
          };
        }
        options.mode = "bytes";
        options.bytes = bytes;
        i++;
      } else if (arg === "-n" && i + 1 < args.length) {
        const chunks = parsePositiveSafeInteger(args[i + 1]);
        if (chunks === null) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `split: invalid number of chunks: '${args[i + 1]}'\n`,
          };
        }
        options.mode = "chunks";
        options.chunks = chunks;
        i += 2;
      } else if (arg.match(/^-n\d+$/)) {
        const chunks = parsePositiveSafeInteger(arg.slice(2));
        if (chunks === null) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `split: invalid number of chunks: '${arg.slice(2)}'\n`,
          };
        }
        options.mode = "chunks";
        options.chunks = chunks;
        i++;
      } else if (arg === "-a" && i + 1 < args.length) {
        const len = parsePositiveSafeInteger(args[i + 1]);
        if (
          len === null ||
          len >
            Math.min(ctx.limits.maxStringLength, ctx.limits.maxArrayElements)
        ) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `split: invalid suffix length: '${args[i + 1]}'\n`,
          };
        }
        options.suffixLength = len;
        i += 2;
      } else if (arg.match(/^-a\d+$/)) {
        const len = parsePositiveSafeInteger(arg.slice(2));
        if (
          len === null ||
          len >
            Math.min(ctx.limits.maxStringLength, ctx.limits.maxArrayElements)
        ) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `split: invalid suffix length: '${arg.slice(2)}'\n`,
          };
        }
        options.suffixLength = len;
        i++;
      } else if (arg === "-d" || arg === "--numeric-suffixes") {
        options.useNumericSuffix = true;
        i++;
      } else if (arg.startsWith("--additional-suffix=")) {
        options.additionalSuffix = arg.slice("--additional-suffix=".length);
        i++;
      } else if (arg === "--additional-suffix" && i + 1 < args.length) {
        options.additionalSuffix = args[i + 1];
        i += 2;
      } else if (arg === "--") {
        positionalArgs.push(...args.slice(i + 1));
        break;
      } else if (arg.startsWith("-") && arg !== "-") {
        return unknownOption("split", arg);
      } else {
        positionalArgs.push(arg);
        i++;
      }
    }

    // Parse positional args: [FILE [PREFIX]]
    let inputFile = "-";
    let prefix = "x";

    if (positionalArgs.length >= 1) {
      inputFile = positionalArgs[0];
    }
    if (positionalArgs.length >= 2) {
      prefix = positionalArgs[1];
    }
    if (positionalArgs.length > 2) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `split: extra operand '${positionalArgs[2]}'\n`,
      };
    }
    if (
      utf8ByteLength(prefix) > ctx.limits.maxStringLength ||
      utf8ByteLength(options.additionalSuffix) > ctx.limits.maxStringLength ||
      options.suffixLength >
        ctx.limits.maxStringLength -
          Math.min(ctx.limits.maxStringLength, utf8ByteLength(prefix)) -
          Math.min(
            ctx.limits.maxStringLength,
            utf8ByteLength(options.additionalSuffix),
          )
    ) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "split: output filename exceeds configured string limit\n",
      };
    }

    // Read input content. split is byte-clean — it chunks the file by line
    // or byte count and never interprets content. Both stdin and named
    // files are read as the latin1 byte view so the binary writes below
    // round-trip the bytes byte-for-byte. Reading the named file as utf8
    // would decode multibyte codepoints, then the binary write would
    // truncate each one back to a single low byte — silent data loss for
    // non-ASCII files.
    let content: Uint8Array;
    let inputPath: string | null = null;
    let contentLease: ResourceLease | undefined;
    if (inputFile === "-") {
      const inputLength = latin1FromBytes(ctx.stdin).length;
      contentLease = ctx.executionScope?.reserveBytes(
        "split transaction",
        inputLength * 2,
        "split",
      );
      content = toUint8Array(latin1FromBytes(ctx.stdin));
    } else {
      inputPath = ctx.fs.resolvePath(ctx.cwd, inputFile);
      try {
        const stat = await ctx.fs.stat(inputPath);
        contentLease = ctx.executionScope?.reserveBytes(
          "split transaction",
          stat.size * 2,
          "split",
        );
        content = await ctx.fs.readFileBuffer(inputPath);
        if (content.byteLength > stat.size) {
          throw new ExecutionLimitError(
            "split: input grew while being read",
            "string_length",
          );
        }
        ctx.executionScope?.consumeInput(content.byteLength, "split");
      } catch (error) {
        contentLease?.release();
        rethrowFatalExecutionError(error);
        return {
          exitCode: 1,
          stdout: "",
          stderr: `split: ${inputFile}: No such file or directory\n`,
        };
      }
    }

    try {
      // Handle empty input
      if (content.length === 0) {
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
        };
      }

      if (options.mode === "chunks" && options.chunks > MAX_OUTPUT_FILES) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `split: too many output files (${options.chunks}), limit is ${MAX_OUTPUT_FILES}\n`,
        };
      }

      // Split content
      let chunks: Uint8Array[];
      switch (options.mode) {
        case "lines":
          chunks = splitByLines(content, options.lines);
          break;
        case "bytes":
          chunks = splitByBytes(content, options.bytes);
          break;
        case "chunks":
          chunks = splitIntoChunks(content, options.chunks);
          break;
        default: {
          const _exhaustive: never = options.mode;
          return _exhaustive;
        }
      }

      // Guard against excessive file creation
      if (chunks.length > MAX_OUTPUT_FILES) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `split: too many output files (${chunks.length}), limit is ${MAX_OUTPUT_FILES}\n`,
        };
      }

      const capacity = suffixCapacity(
        options.useNumericSuffix,
        options.suffixLength,
      );
      if (chunks.length > capacity) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `split: output file suffixes exhausted at ${capacity} files\n`,
        };
      }
      ctx.executionScope?.consumeWork(
        chunks.length * options.suffixLength,
        "split suffix generation",
      );

      // Plan and validate every output before the first destructive write.
      const outputs: PlannedOutput[] = [];
      const identities = new Set<string>();
      const inputIdentity = inputPath
        ? await resolveFileIdentity(ctx.fs, inputPath)
        : null;
      if (inputIdentity?.existence === "unknown") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "split: cannot safely identify input file\n",
        };
      }
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const suffix = generateSuffix(
          chunkIndex,
          options.useNumericSuffix,
          options.suffixLength,
        );
        const filename = `${prefix}${suffix}${options.additionalSuffix}`;
        const path = ctx.fs.resolvePath(ctx.cwd, filename);
        const identity = await resolveFileIdentity(ctx.fs, path);
        const key = identityKey(identity);
        if (identity.existence === "unknown" || key === undefined) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `split: cannot safely identify output file '${filename}'\n`,
          };
        }
        if (key !== undefined && identities.has(key)) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `split: duplicate output file '${filename}'\n`,
          };
        }
        if (
          inputIdentity !== null &&
          ((inputIdentity.existence === "existing" &&
            identity.existence === "existing" &&
            inputIdentity.stableIdentity !== undefined &&
            inputIdentity.stableIdentity === identity.stableIdentity) ||
            (inputIdentity.canonicalPath !== undefined &&
              inputIdentity.canonicalPath === identity.canonicalPath))
        ) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `split: output file '${filename}' would overwrite input\n`,
          };
        }
        if (key !== undefined) identities.add(key);
        outputs.push({
          path,
          displayName: filename,
          content: chunks[chunkIndex],
          initialIdentity: identity,
          stagePath: "",
          committed: false,
        });
      }

      // Build every chunk under a new sibling name. Visible output names are
      // changed only during commit, and existing entries are renamed to backups
      // rather than opened/truncated. This keeps a hard-linked input inode safe.
      try {
        for (const output of outputs) {
          output.stagePath = await uniqueSiblingPath(ctx, output.path, "stage");
          await ctx.fs.writeFile(output.stagePath, output.content);
        }

        // Revalidate the source and complete destination set immediately before
        // the first visible mutation. A newly-created alias fails closed.
        if (
          inputPath !== null &&
          inputIdentity !== null &&
          !identityUnchanged(
            inputIdentity,
            await resolveFileIdentity(ctx.fs, inputPath),
          )
        ) {
          throw new Error("input identity changed during split");
        }
        for (const output of outputs) {
          const current = await resolveFileIdentity(ctx.fs, output.path);
          if (!identityUnchanged(output.initialIdentity, current)) {
            throw new Error("output identity changed during split");
          }
          if (
            inputIdentity?.existence === "existing" &&
            current.existence === "existing" &&
            inputIdentity.stableIdentity === current.stableIdentity
          ) {
            throw new Error("output aliases input");
          }
        }

        for (const output of outputs) {
          // Repeat per-output just before its destructive rename to narrow the
          // validation/commit race on custom and host-backed filesystems.
          if (
            !identityUnchanged(
              output.initialIdentity,
              await resolveFileIdentity(ctx.fs, output.path),
            )
          ) {
            throw new Error("output identity changed during split");
          }
          if (output.initialIdentity.existence === "existing") {
            output.backupPath = await uniqueSiblingPath(
              ctx,
              output.path,
              "backup",
            );
            await ctx.fs.mv(output.path, output.backupPath);
          }
          await ctx.fs.mv(output.stagePath, output.path);
          output.committed = true;
        }
        for (const output of outputs) {
          if (output.backupPath) {
            // The visible batch is fully committed. Backup cleanup is best
            // effort: a cleanup failure must not enter rollback after an older
            // backup has already been deleted.
            await ctx.fs
              .rm(output.backupPath, { force: true, recursive: true })
              .catch(() => {});
            output.backupPath = undefined;
          }
        }
      } catch {
        for (const output of [...outputs].reverse()) {
          if (output.committed) {
            await ctx.fs
              .rm(output.path, { force: true, recursive: true })
              .catch(() => {});
          }
          if (output.backupPath) {
            await ctx.fs.mv(output.backupPath, output.path).catch(() => {});
          }
          if (output.stagePath) {
            await ctx.fs
              .rm(output.stagePath, { force: true, recursive: true })
              .catch(() => {});
          }
        }
        return {
          exitCode: 1,
          stdout: "",
          stderr: "split: failed to write output\n",
        };
      }

      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    } finally {
      contentLease?.release();
    }
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "split",
  flags: [
    { flag: "-l", type: "value", valueHint: "number" },
    { flag: "-b", type: "value", valueHint: "string" },
    { flag: "-n", type: "value", valueHint: "number" },
    { flag: "-d", type: "boolean" },
    { flag: "-a", type: "value", valueHint: "number" },
  ],
  needsFiles: true,
};
