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
import { isAwkNumericString } from "./interpreter/type-coercion.js";
import {
  isBuiltinScalarName,
  markStrnumArrayKey,
  markStrnumVar,
  setVariable,
} from "./interpreter/variables.js";
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

/**
 * A command-line var=value operand: a valid AWK identifier, "=" and the
 * rest of the entry as the literal value. Anything else (no "=", an
 * identifier that does not start the entry, "1x=42") is a filename.
 */
const ASSIGNMENT_OPERAND = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;

function parseAssignmentOperand(
  entry: string,
): { name: string; value: string } | null {
  const match = ASSIGNMENT_OPERAND.exec(entry);
  if (!match) return null;
  return { name: match[1], value: match[2] };
}

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
          // -v FS is a separator option, not a plain variable: gawk
          // honors whichever of -F and -v FS comes last, so apply it
          // here in option order (review 6010326757). The later
          // -v loop still skips FS — it is already in fieldSepStr.
          if (varName === "FS") {
            fieldSepStr = varValue;
            fieldSep = createFieldSepRegex(fieldSepStr);
          }
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
    // Numeric-looking initial ARGV/ENVIRON entries are numeric
    // strings in gawk: an array copied from them sorts "9" before
    // "10" numerically, and asort(ARGV) itself does too (verified
    // against gawk 5.2.1 — review 6010326757). Mark those keys here
    // so the strnum metadata exists from the start.
    for (const [key, value] of Object.entries(runtimeCtx.ARGV)) {
      if (typeof value === "string" && isAwkNumericString(value)) {
        markStrnumArrayKey(runtimeCtx, "ARGV", key, true);
      }
    }
    for (const [key, value] of Object.entries(runtimeCtx.ENVIRON)) {
      if (typeof value === "string" && isAwkNumericString(value)) {
        markStrnumArrayKey(runtimeCtx, "ENVIRON", key, true);
      }
    }

    // Route -v assignments for built-in variables through their
    // setters, so they reach the dedicated slots reads use instead of
    // sitting unread in vars: -v CONVFMT=%.0f used to leave
    // ctx.CONVFMT at "%.6g". This runs after the ARGC/ARGV setup.
    // FS, FNR, and ARGC are excluded: -v FS was already applied in
    // the option loop, in order with -F (last one wins, as in gawk);
    // gawk ignores -v FNR outright, and -v ARGC is overwritten by
    // the argument count in gawk (argv wins).
    for (const [name, value] of Object.entries(vars)) {
      if (name === "FS" || name === "FNR" || name === "ARGC") continue;
      if (isBuiltinScalarName(name)) setVariable(runtimeCtx, name, value);
    }

    // A -v value is a numeric string when it looks numeric, as in gawk:
    // -v v=42 sorts numerically, and -v IGNORECASE="0" reads as a
    // numeric string (falsy) rather than a plain "0" (truthy). Built-in
    // names are ignored here except IGNORECASE, which has no dedicated
    // slot (see markStrnumVar).
    for (const [name, value] of Object.entries(vars)) {
      if (isAwkNumericString(value)) markStrnumVar(runtimeCtx, name, true);
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
      // instead of N. The list is refreshed only when the SET of
      // present indices may have changed while a file was being
      // processed, tracked by runtimeCtx.argvIndexVersion: a value
      // replacement cannot change which files are read, so it must
      // not force a full key scan and sort after every file (review
      // 6010326757). Indices are never revisited: an entry added
      // behind the current position is not re-read, as in gawk. Each
      // entry is read fresh when its turn comes, so a replacement or
      // deletion made while processing an earlier file takes effect;
      // a lowered ARGC takes effect immediately.
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
            // Only a finite ARGC admits files: gawk converts a
            // non-finite ARGC (+inf/-inf) to no files and reads
            // stdin instead, so +inf must not read ARGV entries
            // and -inf must not either.
            Number.isFinite(argc) &&
            n < argc
          ) {
            indices.push(n);
          }
        }
        indices.sort((a, b) => a - b);
        // "01" and "1" are distinct ARGV keys in gawk, but only the
        // canonical key is consulted as input index 1; both keys map
        // to the same pending index here, so without dedup the file
        // would be read twice. gawk reads it once.
        pendingIndices = [...new Set(indices)];
        nextPending = 0;
        pendingVersion = runtimeCtx.argvIndexVersion ?? 0;
      };
      for (;;) {
        if ((runtimeCtx.argvIndexVersion ?? 0) !== pendingVersion) {
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
        // A var=value operand assigns the variable instead of naming a
        // file, as in gawk — and the assignment happens when the
        // operand's turn comes, so a file listed before it does not see
        // the value yet. Only a valid AWK identifier counts ("1x=42"
        // is a filename); the value is escape-processed like -v (gawk
        // converts v=a\tb to a three-character value containing a tab),
        // and is a numeric string when it looks numeric. Assigning to
        // an array name (ARGV=1) is a fatal type error, via
        // setVariable. An assignment is not input, so it leaves
        // readAnyInput alone: with no files at all, stdin is still
        // read after the assignments run.
        const assignment = parseAssignmentOperand(entry);
        if (assignment) {
          const value = processEscapes(assignment.value);
          setVariable(runtimeCtx, assignment.name, value);
          if (isAwkNumericString(value)) {
            markStrnumVar(runtimeCtx, assignment.name, true);
          }
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
  if (!str.includes("\\")) return str;
  // One left-to-right pass: the old chained .replace() calls decoded
  // `\\t` (backslash + t) as a tab, because the \t pass ran before
  // the \\ pass. gawk's set: the named escapes, octal \ddd (1-3
  // digits, truncated to a byte), hex \xHH (1-2 digits), and any
  // other \c as plain c (gawk warns; this keeps the character).
  // A lone trailing backslash is dropped, as in gawk.
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    if (i + 1 >= str.length) break;
    const next = str[i + 1];
    switch (next) {
      case "a":
        out += "\x07";
        i++;
        break;
      case "b":
        out += "\b";
        i++;
        break;
      case "f":
        out += "\f";
        i++;
        break;
      case "n":
        out += "\n";
        i++;
        break;
      case "r":
        out += "\r";
        i++;
        break;
      case "t":
        out += "\t";
        i++;
        break;
      case "v":
        out += "\v";
        i++;
        break;
      case "\\":
        out += "\\";
        i++;
        break;
      case '"':
        out += '"';
        i++;
        break;
      case "x": {
        // \xHH: one or two hex digits; with none, the x stays.
        let j = i + 2;
        let hex = "";
        while (j < str.length && hex.length < 2 && /[0-9A-Fa-f]/.test(str[j])) {
          hex += str[j];
          j++;
        }
        if (hex.length > 0) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i = j - 1;
        } else {
          out += "x";
          i++;
        }
        break;
      }
      default: {
        if (next >= "0" && next <= "7") {
          // \ddd: one to three octal digits, truncated to a byte.
          let j = i + 1;
          let oct = "";
          while (
            j < str.length &&
            oct.length < 3 &&
            str[j] >= "0" &&
            str[j] <= "7"
          ) {
            oct += str[j];
            j++;
          }
          out += String.fromCharCode(Number.parseInt(oct, 8) & 0xff);
          i = j - 1;
        } else {
          out += next;
          i++;
        }
        break;
      }
    }
  }
  return out;
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
