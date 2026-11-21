/**
 * AWK RuntimeCommand - New AST-based Implementation
 *
 * This is the new implementation using proper lexer/parser/interpreter architecture.
 */

import { decodeBytesToUtf8 } from "../../encoding.js";
import type { ResourceLease } from "../../execution-scope.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { mapToRecord } from "../../helpers/env.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { ConstantRegex, createUserRegex } from "../../regex/index.js";
import {
  assertDefenseContext,
  awaitWithDefenseContext,
} from "../../security/defense-context.js";
import { SecurityViolationError } from "../../security/defense-in-depth-box.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { utf8ByteLength } from "../printf/escapes.js";
import type { AwkProgram } from "./ast.js";
import {
  type AwkFileSystem,
  AwkInterpreter,
  createRuntimeContext,
} from "./interpreter/index.js";
import { AwkParser } from "./parser2.js";

const awkHelp = {
  name: "awk",
  summary: "pattern scanning and text processing language",
  usage: "awk [OPTIONS] 'PROGRAM' [FILE...]",
  options: [
    "-F FS      use FS as field separator",
    "-v VAR=VAL assign VAL to variable VAR",
    "    --help display this help and exit",
  ],
};

export const awkCommand2: RuntimeCommand = {
  name: "awk",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    assertDefenseContext(ctx.requireDefenseContext, "awk", "execution entry");
    const withDefenseContext = <T>(
      phase: string,
      op: () => Promise<T>,
    ): Promise<T> =>
      awaitWithDefenseContext(ctx.requireDefenseContext, "awk", phase, op);

    if (hasHelpFlag(args)) {
      return showHelp(awkHelp);
    }

    let fieldSep: import("../../regex/index.js").RegexLike = new ConstantRegex(
      /\s+/,
    );
    let fieldSepStr = " ";
    // Use null-prototype to prevent prototype pollution with user-controlled -v names
    const vars: Record<string, string | number> = Object.create(null);
    let programIdx = 0;

    // Parse options
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-F" && i + 1 < args.length) {
        fieldSepStr = processEscapes(args[++i]);
        fieldSep = createFieldSepRegex(fieldSepStr);
        programIdx = i + 1;
      } else if (arg.startsWith("-F")) {
        fieldSepStr = processEscapes(arg.slice(2));
        fieldSep = createFieldSepRegex(fieldSepStr);
        programIdx = i + 1;
      } else if (arg === "-v" && i + 1 < args.length) {
        const assignment = args[++i];
        const eqIdx = assignment.indexOf("=");
        if (eqIdx > 0) {
          const varName = assignment.slice(0, eqIdx);
          const varValue = processEscapes(assignment.slice(eqIdx + 1));
          vars[varName] = varValue;
        }
        programIdx = i + 1;
      } else if (arg.startsWith("--")) {
        return unknownOption("awk", arg);
      } else if (arg.startsWith("-") && arg.length > 1) {
        const optChar = arg[1];
        if (optChar !== "F" && optChar !== "v") {
          return unknownOption("awk", `-${optChar}`);
        }
        programIdx = i + 1;
      } else if (!arg.startsWith("-")) {
        programIdx = i;
        break;
      }
    }

    if (programIdx >= args.length) {
      return { stdout: "", stderr: "awk: missing program\n", exitCode: 1 };
    }

    const program = args[programIdx];
    const files = args.slice(programIdx + 1);

    // Parse program
    const parser = new AwkParser({
      maxSourceLength: ctx.limits.maxStringLength,
      maxTokens: ctx.limits.maxAwkParserTokens,
      maxDepth: ctx.limits.maxAwkParserDepth,
      maxOperations: ctx.limits.maxAwkParserOperations,
    });
    let ast: AwkProgram;
    try {
      ast = parser.parse(program);
    } catch (e) {
      rethrowFatalExecutionError(e);
      const msg = e instanceof Error ? e.message : String(e);
      return { stdout: "", stderr: `awk: ${msg}\n`, exitCode: 1 };
    }

    // Buffered append adapter (issue #769): `print > file` used to re-read
    // the whole file and write `existing + content` back on every print,
    // which is quadratic in the file size. The filesystem's own appendFile
    // is a true in-place append on ReadWriteFs (O_APPEND) and OverlayFs
    // (appendChunks), but InMemoryFs still copies the whole buffer per
    // append, so appends are buffered per file and flushed through the
    // filesystem's appendFile at a size cap, before any read of a file awk
    // may have written to, and at exit (see flush points below).
    //
    // The buffer is bounded two ways: each file flushes at
    // AWK_APPEND_FLUSH_BYTES, and total pending output across ALL files
    // is capped at AWK_APPEND_PENDING_MAX_BYTES (flushing everything once
    // the cap would be exceeded), so a loop over many distinct files
    // cannot buffer unbounded memory. Buffered bytes are also charged
    // against the shared live-bytes budget (maxLiveBytes) while held, and
    // released on flush, so the buffer counts toward the memory limits.
    const AWK_APPEND_FLUSH_BYTES = 64 * 1024;
    const AWK_APPEND_PENDING_MAX_BYTES = 64 * 1024;
    let pendingTotalBytes = 0;
    const pendingAppend = new Map<
      string,
      { chunks: string[]; bytes: number; leases: ResourceLease[] }
    >();

    function releaseEntryLeases(entry: { leases: ResourceLease[] }): void {
      for (const lease of entry.leases) lease.release();
      entry.leases.length = 0;
    }

    /**
     * Release the live-bytes reservations for entries still pending. Used
     * when the command is returning after a failed exit flush: the buffer
     * ceases to exist with the command, so the bytes must not stay
     * charged against the shared budget. (Mid-run a failed flush keeps
     * its leases, because the entry is preserved for a later retry.)
     */
    function releasePendingLeases(): void {
      for (const entry of pendingAppend.values()) {
        releaseEntryLeases(entry);
      }
    }

    async function flushAppendedFile(filePath: string): Promise<void> {
      const entry = pendingAppend.get(filePath);
      if (!entry) return;
      const text = entry.chunks.join("");
      if (text.length === 0) {
        // Nothing buffered (only the first-write entry, which holds no
        // data): drop it without touching the filesystem.
        pendingAppend.delete(filePath);
        releaseEntryLeases(entry);
        return;
      }
      // Remove the entry before the write so the bytes are not
      // double-counted, but restore it if the write fails: the data must
      // survive for a later flush attempt instead of being silently lost.
      pendingAppend.delete(filePath);
      pendingTotalBytes -= entry.bytes;
      try {
        await withDefenseContext("appendFile flush", () =>
          ctx.fs.appendFile(filePath, text),
        );
      } catch (e) {
        pendingAppend.set(filePath, entry);
        pendingTotalBytes += entry.bytes;
        throw e;
      }
      releaseEntryLeases(entry);
    }

    async function flushAppendedOutput(filePath?: string): Promise<void> {
      if (filePath !== undefined) {
        await withDefenseContext("appended output flush", () =>
          flushAppendedFile(filePath),
        );
        return;
      }
      // Flush every file even if one fails, so a failure on one file does
      // not leave later files unflushed; report the first failure after.
      let firstError: unknown;
      for (const path of [...pendingAppend.keys()]) {
        try {
          await withDefenseContext("appended output flush", () =>
            flushAppendedFile(path),
          );
        } catch (e) {
          firstError ??= e;
        }
      }
      if (firstError !== undefined) throw firstError;
    }

    // True once the exit flush has run (via finish() or the finally below),
    // so the finally never flushes twice.
    let flushCompleted = false;

    /**
     * Flush buffered output on an exit path and, when the run itself
     * succeeded, turn a flush failure into a failed result instead of
     * returning success with incomplete output files. When the run already
     * failed, its error is preserved and the flush failure stays silent.
     */
    async function finish(result: ExecResult): Promise<ExecResult> {
      if (flushCompleted) return result;
      flushCompleted = true;
      try {
        await withDefenseContext("appended output exit flush", () =>
          flushAppendedOutput(),
        );
      } catch (e) {
        releasePendingLeases();
        rethrowFatalExecutionError(e);
        if (result.exitCode === 0) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            stdout: result.stdout,
            stderr: `awk: failed to flush buffered output: ${msg}\n`,
            exitCode: 1,
          };
        }
      }
      return result;
    }

    // Create filesystem adapter with appendFile support
    const awkFs: AwkFileSystem = {
      readFile: ctx.fs.readFile.bind(ctx.fs),
      writeFile: ctx.fs.writeFile.bind(ctx.fs),
      appendFile: async (path: string, content: string) => {
        let entry = pendingAppend.get(path);
        if (!entry) {
          // First append to this file: write through immediately, so an
          // unwritable path (directory, sandbox denial) still errors on
          // the first print, exactly as before, instead of only at flush
          // time. Later appends buffer until the size cap or a flush point.
          entry = { chunks: [], bytes: 0, leases: [] };
          pendingAppend.set(path, entry);
          try {
            await withDefenseContext("appendFile create", () =>
              ctx.fs.appendFile(path, content),
            );
          } catch (e) {
            pendingAppend.delete(path);
            throw e;
          }
          return;
        }
        const chunkBytes = utf8ByteLength(content);
        // An empty append changes nothing; storing it would let empty
        // writes grow the chunk list forever without ever hitting a
        // byte-based flush.
        if (chunkBytes === 0) return;
        // Aggregate cap: flush everything before buffering more, so total
        // pending output across all files stays bounded.
        if (pendingTotalBytes + chunkBytes > AWK_APPEND_PENDING_MAX_BYTES) {
          await withDefenseContext("appended output aggregate flush", () =>
            flushAppendedOutput(),
          );
          entry = pendingAppend.get(path) ?? {
            chunks: [],
            bytes: 0,
            leases: [],
          };
          if (!pendingAppend.has(path)) pendingAppend.set(path, entry);
        }
        // Charge the buffered bytes against the shared live-bytes budget
        // while they are held; the lease is released when the entry is
        // flushed. Without a scope (direct command invocation) the
        // aggregate cap above is the only bound.
        const lease = ctx.executionScope?.reserveBytes(
          "awk buffered output",
          chunkBytes,
          "awk",
        );
        if (lease) entry.leases.push(lease);
        entry.chunks.push(content);
        entry.bytes += chunkBytes;
        pendingTotalBytes += chunkBytes;
        if (entry.bytes >= AWK_APPEND_FLUSH_BYTES) {
          await withDefenseContext("appended output size flush", () =>
            flushAppendedFile(path),
          );
        }
      },
      flushOutput: flushAppendedOutput,
      resolvePath: ctx.fs.resolvePath.bind(ctx.fs),
    };

    // Create runtime context
    const execFn = ctx.exec;
    const runtimeCtx = createRuntimeContext({
      fieldSep,
      maxIterations: ctx.limits.maxAwkIterations,
      maxOutputSize: Math.min(
        ctx.limits.maxStringLength,
        ctx.limits.maxOutputSize,
      ),
      maxArrayElements: ctx.limits.maxArrayElements,
      fs: awkFs,
      cwd: ctx.cwd,
      // Wrap ctx.exec to match the expected signature for command pipe getline
      exec: execFn
        ? (cmd: string) =>
            withDefenseContext("command pipe exec", () =>
              execFn(cmd, { cwd: ctx.cwd, signal: ctx.signal }),
            )
        : undefined,
      coverage: ctx.coverage,
      requireDefenseContext: ctx.requireDefenseContext,
    });
    runtimeCtx.FS = fieldSepStr;
    // Use Object.assign with null-prototype to preserve safety
    runtimeCtx.vars = Object.assign(Object.create(null), vars);

    // Set up ARGC/ARGV
    // ARGV[0] is "awk", ARGV[1..n] are the input files
    runtimeCtx.ARGC = files.length + 1;
    // Use null-prototype to prevent prototype pollution
    runtimeCtx.ARGV = Object.create(null);
    runtimeCtx.ARGV["0"] = "awk";
    for (let i = 0; i < files.length; i++) {
      runtimeCtx.ARGV[String(i + 1)] = files[i];
    }

    // Set up ENVIRON from shell environment (null-prototype prevents prototype pollution)
    runtimeCtx.ENVIRON = mapToRecord(ctx.env);

    // Create interpreter
    const interp = new AwkInterpreter(runtimeCtx);
    interp.execute(ast);

    // Check if there are main rules (non-BEGIN/END patterns)
    const hasMainRules = ast.rules.some(
      (rule) => rule.pattern?.type !== "begin" && rule.pattern?.type !== "end",
    );
    // Check if there are END blocks (need to read files to populate NR)
    const hasEndBlocks = ast.rules.some((rule) => rule.pattern?.type === "end");

    // Execute BEGIN blocks
    try {
      await withDefenseContext("BEGIN execution", () => interp.executeBegin());
      if (runtimeCtx.shouldExit) {
        // exit in BEGIN still runs END blocks (AWK semantics)
        await withDefenseContext("END execution after BEGIN exit", () =>
          interp.executeEnd(),
        );
        return {
          stdout: interp.getOutput(),
          stderr: "",
          exitCode: interp.getExitCode(),
        };
      }

      // Only skip file reading if there are no main rules AND no END blocks
      // END blocks need NR to be populated from reading files
      if (!hasMainRules && !hasEndBlocks) {
        // Just run END blocks (none), no input processing needed
        return {
          stdout: interp.getOutput(),
          stderr: "",
          exitCode: interp.getExitCode(),
        };
      }

      const maxInputBytes = Math.min(
        ctx.limits.maxInputBytes,
        ctx.limits.maxStringLength,
      );
      const maxRecords = ctx.limits.maxArrayElements;
      let aggregateInputBytes = 0;

      const processInput = async (
        filename: string,
        content: string,
      ): Promise<void> => {
        const contentBytes = utf8ByteLength(content);
        if (contentBytes > maxInputBytes - aggregateInputBytes) {
          throw new ExecutionLimitError(
            `aggregate input size limit exceeded (${maxInputBytes} bytes)`,
            "string_length",
          );
        }
        aggregateInputBytes += contentBytes;

        let recordCount = content.length > 0 ? 1 : 0;
        for (let index = 0; index < content.length; index++) {
          if (content.charCodeAt(index) === 10) recordCount++;
          if (recordCount > maxRecords + 1) {
            throw new ExecutionLimitError(
              `record array limit exceeded (${maxRecords})`,
              "array_elements",
            );
          }
        }

        const lines = content.split("\n");
        if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
        if (lines.length > maxRecords) {
          throw new ExecutionLimitError(
            `record array limit exceeded (${maxRecords})`,
            "array_elements",
          );
        }

        runtimeCtx.FILENAME = filename;
        runtimeCtx.FNR = 0;
        runtimeCtx.lines = lines;
        runtimeCtx.lineIndex = -1;
        runtimeCtx.shouldNextFile = false;

        // Use while loop with lineIndex to support getline advancing the line
        while (runtimeCtx.lineIndex < lines.length - 1) {
          runtimeCtx.lineIndex++;
          const activeLineIndex = runtimeCtx.lineIndex;
          await withDefenseContext("line execution", () =>
            interp.executeLine(lines[activeLineIndex]),
          );
          if (runtimeCtx.shouldExit || runtimeCtx.shouldNextFile) break;
        }
      };

      if (files.length > 0) {
        for (const file of files) {
          // Flush point (issue #769): an output file of an earlier record
          // may also be a later input file, so buffered output must reach
          // the filesystem before it is read back.
          await withDefenseContext("appended output flush", () =>
            flushAppendedOutput(),
          );
          let content: string;
          try {
            const filePath = ctx.fs.resolvePath(ctx.cwd, file);
            const stat = await withDefenseContext("input file stat", () =>
              ctx.fs.stat(filePath),
            );
            if (stat.size > maxInputBytes - aggregateInputBytes) {
              throw new ExecutionLimitError(
                `aggregate input size limit exceeded (${maxInputBytes} bytes)`,
                "string_length",
              );
            }
            content = await withDefenseContext("input file read", () =>
              ctx.fs.readFile(filePath),
            );
          } catch (e) {
            if (
              e instanceof SecurityViolationError ||
              e instanceof ExecutionLimitError
            ) {
              throw e;
            }
            return {
              stdout: "",
              stderr: `awk: ${file}: No such file or directory\n`,
              exitCode: 1,
            };
          }
          await withDefenseContext("input processing", () =>
            processInput(file, content),
          );
          if (runtimeCtx.shouldExit) break;
        }
      } else {
        // awk parses fields with regex / FS — decode bytes to UTF-8 so
        // non-ASCII data isn't split mid-codepoint.
        await withDefenseContext("stdin processing", () =>
          processInput("", decodeBytesToUtf8(ctx.stdin)),
        );
      }

      // Execute END blocks (always run, even after exit - AWK semantics)
      await withDefenseContext("END execution", () => interp.executeEnd());

      // awk emits text; the pipeline handles encoding.
      return {
        stdout: interp.getOutput(),
        stderr: "",
        exitCode: interp.getExitCode(),
      };
    } catch (e) {
      if (e instanceof SecurityViolationError) {
        throw e;
      }
      // Handle errors during execution
      const msg = e instanceof Error ? e.message : String(e);
      const exitCode =
        e instanceof ExecutionLimitError ? ExecutionLimitError.EXIT_CODE : 2;
      return {
        stdout: interp.getOutput(),
        stderr: `awk: ${msg}\n`,
        exitCode,
      };
    } finally {
      // Flush point (issue #769): buffered output must reach the filesystem
      // on every exit path, including `exit` in BEGIN and error aborts.
      // Errors here are swallowed deliberately: throwing from finally would
      // mask the run's own result or error, and a persistently failing
      // filesystem already surfaces at the size-cap flush during execution.
      try {
        await flushAppendedOutput();
      } catch {
        // Ignore flush errors at exit.
      }
    }
  },
};

function processEscapes(str: string): string {
  return str
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\a/g, "\x07") // bell
    .replace(/\\v/g, "\v")
    .replace(/\\\\/g, "\\");
}

function createFieldSepRegex(
  sep: string,
): import("../../regex/index.js").UserRegex {
  if (sep === " ") {
    return createUserRegex("\\s+");
  }

  const regexMetachars = /[[\](){}.*+?^$|\\]/;
  if (regexMetachars.test(sep)) {
    try {
      return createUserRegex(sep);
    } catch {
      return createUserRegex(escapeForRegex(sep));
    }
  }

  return createUserRegex(escapeForRegex(sep));
}

function escapeForRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "awk",
  flags: [
    { flag: "-F", type: "value", valueHint: "delimiter" },
    { flag: "-v", type: "value", valueHint: "string" },
  ],
  stdinType: "text",
  needsArgs: true,
};
