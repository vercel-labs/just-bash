/**
 * AWK RuntimeCommand - New AST-based Implementation
 *
 * This is the new implementation using proper lexer/parser/interpreter architecture.
 */

import { decodeBytesToUtf8 } from "../../encoding.js";
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
import { isBuiltinScalarName, setVariable } from "./interpreter/variables.js";
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

    // Create filesystem adapter with appendFile support
    const awkFs: AwkFileSystem = {
      readFile: ctx.fs.readFile.bind(ctx.fs),
      writeFile: ctx.fs.writeFile.bind(ctx.fs),
      appendFile: async (path: string, content: string) => {
        // Append by reading existing content and writing back
        try {
          const existing = await withDefenseContext("appendFile read", () =>
            ctx.fs.readFile(path),
          );
          await withDefenseContext("appendFile write", () =>
            ctx.fs.writeFile(path, existing + content),
          );
        } catch (e) {
          if (e instanceof SecurityViolationError) {
            throw e;
          }
          // File doesn't exist, just write
          await withDefenseContext("appendFile create", () =>
            ctx.fs.writeFile(path, content),
          );
        }
      },
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
      executionScope: ctx.executionScope,
    });
    runtimeCtx.FS = fieldSepStr;
    // Plain -v variables land in vars here (null-prototype for
    // safety); built-in -v assignments are routed through their
    // setters in the loop after the ARGC/ARGV setup below, so they
    // reach the dedicated slots reads use.
    runtimeCtx.vars = Object.create(null);
    for (const [name, value] of Object.entries(vars)) {
      if (!isBuiltinScalarName(name)) runtimeCtx.vars[name] = value;
    }

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

    // The prepopulated ARGV/ENVIRON contents do not consume the
    // element allowance: only elements the program adds beyond them
    // count toward maxArrayElements, so an ordinary program still gets
    // its full allowance even with a small limit. Their initial sizes
    // are recorded so the setters can tell added elements from
    // prepopulated ones.
    runtimeCtx.arrayElementBaselines = new Map([
      ["ARGV", Object.keys(runtimeCtx.ARGV).length],
      ["ENVIRON", Object.keys(runtimeCtx.ENVIRON).length],
    ]);
    // Live sizes of the prepopulated stores, tracked incrementally
    // from here on (see variables.ts).
    runtimeCtx.specialStoreSizes = new Map([
      ["ARGV", Object.keys(runtimeCtx.ARGV).length],
      ["ENVIRON", Object.keys(runtimeCtx.ENVIRON).length],
    ]);

    // Route -v assignments for built-in variables through their
    // setters, so they reach the dedicated slots reads use instead of
    // sitting unread in vars: -v CONVFMT=%.0f used to leave
    // ctx.CONVFMT at "%.6g". This runs after the ARGC/ARGV setup.
    // FS, FNR, and ARGC are excluded: -v FS stays driven by -F
    // (routing it here would let it override -F regardless of
    // argument order), gawk ignores -v FNR outright, and -v ARGC is
    // overwritten by the argument count in gawk (argv wins).
    for (const [name, value] of Object.entries(vars)) {
      if (name === "FS" || name === "FNR" || name === "ARGC") continue;
      if (isBuiltinScalarName(name)) setVariable(runtimeCtx, name, value);
    }

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

      let readAnyInput = false;
      let stdinConsumed = false;
      const readStdin = (): string => {
        if (stdinConsumed) return "";
        stdinConsumed = true;
        // awk parses fields with regex / FS — decode bytes to UTF-8 so
        // non-ASCII data isn't split mid-codepoint.
        return decodeBytesToUtf8(ctx.stdin);
      };
      const processFile = async (file: string): Promise<ExecResult | null> => {
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
        readAnyInput = true;
        return null;
      };

      // A BEGIN block may reorder, delete, or replace ARGV entries
      // (e.g. asort(a, ARGV)), so the files to read come from the
      // current ARGV, not the argument list captured before BEGIN —
      // as in gawk. The loop walks the present ARGV indices, in
      // order, from a cached sorted list: a sparse ARGV (one entry
      // at index 999,999,999,999) never visits the missing indices
      // below it, and reading N unchanged files costs one key scan
      // instead of N. The list is refreshed only when ARGV (or its
      // ARGC bound) changed while a file was being processed, tracked
      // by runtimeCtx.argvVersion. Indices are never revisited: an
      // entry added behind the current position is not re-read, as
      // in gawk. Each entry is read fresh when its turn comes, so a
      // replacement or deletion made while processing an earlier file
      // takes effect; a lowered ARGC takes effect immediately.
      let pendingIndices: number[] = [];
      let pendingVersion = -1;
      let nextPending = 0;
      let lastIndex = 0;
      const refreshPendingIndices = (): void => {
        const argc = runtimeCtx.ARGC;
        const indices: number[] = [];
        for (const key of Object.keys(runtimeCtx.ARGV)) {
          const n = Number(key);
          if (
            Number.isInteger(n) &&
            n > lastIndex &&
            n >= 1 &&
            (!Number.isFinite(argc) || n < argc)
          ) {
            indices.push(n);
          }
        }
        indices.sort((a, b) => a - b);
        pendingIndices = indices;
        nextPending = 0;
        pendingVersion = runtimeCtx.argvVersion ?? 0;
      };
      for (;;) {
        if ((runtimeCtx.argvVersion ?? 0) !== pendingVersion) {
          refreshPendingIndices();
        }
        if (nextPending >= pendingIndices.length) break;
        const index = pendingIndices[nextPending++];
        lastIndex = index;
        // A lowered ARGC takes effect immediately, even if entries
        // past it are still present. The list is ascending, so once
        // an index reaches ARGC every later one does too.
        if (Number.isFinite(runtimeCtx.ARGC) && index >= runtimeCtx.ARGC) {
          break;
        }
        const entry = runtimeCtx.ARGV[String(index)];
        if (entry === undefined || entry === "") continue;
        // "-" means stdin (FILENAME "-"), as in gawk. A numeric entry
        // is skipped: gawk reads stdin instead when it is the only
        // input, which the fallback below provides. A numeric-looking
        // *string* is still a filename ("1" fails to open, as in
        // gawk), so only JS numbers are skipped here.
        if (typeof entry === "number") continue;
        if (entry === "-") {
          await withDefenseContext("stdin processing", () =>
            processInput("-", readStdin()),
          );
          readAnyInput = true;
          if (runtimeCtx.shouldExit) break;
          continue;
        }
        const missing = await processFile(entry);
        if (missing) return missing;
        if (runtimeCtx.shouldExit) break;
      }

      if (!readAnyInput) {
        // No files (or only numeric/empty entries): read stdin, with
        // FILENAME "-" as in gawk.
        await withDefenseContext("stdin processing", () =>
          processInput("-", readStdin()),
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
