/** js-exec - Execute JavaScript code via the run package. */

import { decodeBytesToUtf8 } from "../../encoding.js";
import { sanitizeErrorMessage } from "../../fs/sanitize-error.js";
import type { ExecResult, RuntimeCommand } from "../../types.js";
import { hasHelpFlag } from "../help.js";
import { executeWithRun } from "./run-runtime.js";

const JS_EXEC_HELP = `js-exec - Sandboxed JavaScript/TypeScript runtime with Node.js-compatible APIs

Usage: js-exec [OPTIONS] [-c CODE | FILE] [ARGS...]

Options:
  -c CODE          Execute inline code
  -e, --eval CODE  Execute inline code (same as -c)
  -p, --print EXPR Evaluate an expression and print its value
  -m, --module     Enable ES module mode (import/export)
  --strip-types    Accepted for compatibility; type stripping is automatic
  --version, -V    Show version
  --help           Show this help

Examples:
  js-exec -c "console.log(1 + 2)"
  js-exec script.js
  js-exec app.ts
  echo 'console.log("hello")' | js-exec

File Extension Auto-Detection:
  .js              function-body mode
  .mjs             ES module mode
  .ts, .mts        ES module mode + TypeScript stripping

Node.js Compatibility:
  Code written for Node.js largely works here. Both require and import are
  supported for the documented built-ins. Filesystem and command APIs retain
  synchronous Node.js call semantics inside the sandbox.

  Available modules:
    fs, path, child_process, process, console,
    os, url, assert, util, events, buffer, stream,
    string_decoder, querystring

Limits:
  Memory: 64 MB per execution
  Timeout: configurable via maxJsTimeoutMs
  Engine: run (QuickJS)
`;

interface ParsedArgs {
  code: string | null;
  /** A `-` operand named stdin as the script, rather than stdin by default. */
  dashScript: boolean;
  print: boolean;
  scriptFile: string | null;
  showVersion: boolean;
  scriptArgs: string[];
  isModule: boolean;
}

/** Options that take inline code, spelled the way `js-exec` and `node` take them. */
const INLINE_CODE_OPTIONS: Record<string, { print: boolean }> = Object.assign(
  Object.create(null) as Record<string, { print: boolean }>,
  {
    "--eval": { print: false },
    "--print": { print: true },
    "-c": { print: false },
    "-e": { print: false },
    "-p": { print: true },
  },
);

function parseArgs(args: string[]): ParsedArgs | ExecResult {
  const result: ParsedArgs = {
    code: null,
    dashScript: false,
    isModule: false,
    print: false,
    scriptArgs: [],
    scriptFile: null,
    showVersion: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-m" || arg === "--module") {
      result.isModule = true;
      continue;
    }
    if (arg === "--strip-types") {
      // run strips supported TypeScript syntax automatically. Retain this
      // Node-compatible flag as an explicit compatibility alias.
      continue;
    }
    // `--eval=CODE` and `--print=CODE` carry the code in the same argument.
    const separator = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const option = separator === -1 ? arg : arg.slice(0, separator);
    const inline = INLINE_CODE_OPTIONS[option];
    if (inline !== undefined) {
      if (separator !== -1) {
        result.code = arg.slice(separator + 1);
        result.scriptArgs = args.slice(index + 1);
      } else {
        if (index + 1 >= args.length) {
          return {
            exitCode: 2,
            stderr: `js-exec: option requires an argument -- '${option.replace(/^-+/, "")}'\n`,
            stdout: "",
          };
        }
        result.code = args[index + 1];
        result.scriptArgs = args.slice(index + 2);
      }
      result.print = inline.print;
      return result;
    }
    if (arg === "--version" || arg === "-V") {
      result.showVersion = true;
      return result;
    }
    if (arg.startsWith("-") && arg !== "-" && arg !== "--") {
      return {
        exitCode: 2,
        stderr: `js-exec: unrecognized option '${arg}'\n`,
        stdout: "",
      };
    }
    if (arg === "--") {
      if (index + 1 < args.length) {
        result.scriptFile = args[index + 1];
        result.scriptArgs = args.slice(index + 2);
      }
      return result;
    }
    if (arg === "-") {
      result.dashScript = true;
      result.scriptArgs = args.slice(index + 1);
      return result;
    }
    result.scriptFile = arg;
    result.scriptArgs = args.slice(index + 1);
    return result;
  }
  return result;
}

/**
 * The program without the semicolons and whitespace that end it, so a typed
 * `1 + 2;` can sit in an expression position. A comment needs no trimming:
 * the wrapper closes on a new line, so a trailing `// comment` ends there.
 * One pass from the end, so the cost stays linear in the program's length.
 */
function withoutTrailingSemicolons(code: string): string {
  let end = code.length;
  while (end > 0 && (code[end - 1] === ";" || /\s/u.test(code[end - 1]))) {
    end--;
  }
  return code.slice(0, end);
}

/**
 * How `-p` prints a value: strings as they are, and the rest the way node
 * inspects them for the kinds `console.log`'s JSON would lose (a RegExp as
 * `{}`, a Symbol or a function as nothing). Objects and arrays stay JSON,
 * as they are everywhere in this runtime. An expression that takes
 * `console.log` as it is before the program runs and returns the printer,
 * so the program can neither see the printer nor change what it calls.
 */
const PRINTER = `((log) => (thunk) => { const v = thunk(); log(typeof v === 'string' ? v : typeof v === 'symbol' ? v.toString() : typeof v === 'bigint' ? v + 'n' : typeof v === 'function' ? (v.name ? '[Function: ' + v.name + ']' : '[Function (anonymous)]') : v instanceof RegExp ? String(v) : v instanceof Date ? (v.getTime() === v.getTime() ? v.toISOString() : 'Invalid Date') : v instanceof Error ? String(v) + (v.stack ? '\\n' + v.stack : '') : v === undefined || v === null || typeof v === 'number' || typeof v === 'boolean' ? String(v) : (function () { try { return JSON.stringify(v); } catch (_) { return String(v); } })()); })(console.log)`;

/**
 * Whether the program is nothing but whitespace, semicolons and comments,
 * which node prints as `undefined`. It reads from the start and stops at
 * the first other character, so it never has to tell a comment from a
 * string or a regex, and it stays linear in the program's length.
 */
function isEmptyProgram(code: string): boolean {
  let index = 0;
  while (index < code.length) {
    if (code[index] === ";" || /\s/u.test(code[index])) {
      index++;
    } else if (code.startsWith("//", index)) {
      const end = code.indexOf("\n", index);
      if (end === -1) return true;
      index = end + 1;
    } else if (code.startsWith("/*", index)) {
      const end = code.indexOf("*/", index + 2);
      if (end === -1) return false;
      index = end + 2;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * `-p` prints the value of one expression, which is what node prints for a
 * single expression statement; an empty program, or one that is only
 * comments, prints `undefined`, as node does. A program of several
 * statements is a syntax error here.
 *
 * The expression is parenthesized and returned by an arrow function, so it
 * must be exactly one expression (`1,` and `...a` are syntax errors, as
 * under node), and `forEach` takes the printer, which is built (and reads
 * `console.log`) before `forEach` calls the arrow. So the expression stays
 * on line 1 a few columns in, and no name the wrapper adds is in its scope.
 * The newline before the closing parenthesis keeps a trailing line comment
 * from swallowing it.
 */
function printSource(code: string): string {
  const expression = isEmptyProgram(code)
    ? "void 0"
    : withoutTrailingSemicolons(code);
  return `[() => (${expression}\n)].forEach(${PRINTER});\n`;
}

export const jsExecCommand: RuntimeCommand = {
  name: "js-exec",
  async execute(args, ctx) {
    if (hasHelpFlag(args)) {
      return { exitCode: 0, stderr: "", stdout: JS_EXEC_HELP };
    }
    const parsed = parseArgs(args);
    if ("exitCode" in parsed) return parsed;
    if (parsed.showVersion) {
      return { exitCode: 0, stderr: "", stdout: "QuickJS (run)\n" };
    }

    let source: string;
    let scriptPath: string;
    // What node puts at process.argv[1]: the file, `-` when stdin is named
    // as the script, and no entry for inline code or stdin by default.
    let argvScript: string | undefined;
    if (parsed.code !== null) {
      source = parsed.print ? printSource(parsed.code) : parsed.code;
      scriptPath = "-c";
    } else if (parsed.scriptFile !== null) {
      const filePath = ctx.fs.resolvePath(ctx.cwd, parsed.scriptFile);
      if (!(await ctx.fs.exists(filePath))) {
        return {
          exitCode: 2,
          stderr: `js-exec: can't open file '${parsed.scriptFile}': No such file or directory\n`,
          stdout: "",
        };
      }
      try {
        source = await ctx.fs.readFile(filePath);
        scriptPath = filePath;
        argvScript = filePath;
      } catch (error) {
        return {
          exitCode: 2,
          stderr: `js-exec: can't open file '${parsed.scriptFile}': ${sanitizeErrorMessage((error as Error).message)}\n`,
          stdout: "",
        };
      }
    } else if (decodeBytesToUtf8(ctx.stdin).trim()) {
      source = decodeBytesToUtf8(ctx.stdin);
      scriptPath = "<stdin>";
      if (parsed.dashScript) argvScript = "-";
    } else {
      return {
        exitCode: 2,
        stderr:
          "js-exec: no input provided (use -c CODE, -e CODE, or provide a script file)\n",
        stdout: "",
      };
    }

    const isModule =
      parsed.isModule ||
      scriptPath.endsWith(".mjs") ||
      scriptPath.endsWith(".mts") ||
      scriptPath.endsWith(".ts");
    return await executeWithRun(
      {
        argvScript,
        bootstrapCode: ctx.jsBootstrapCode,
        isModule,
        scriptArgs: parsed.scriptArgs,
        scriptPath,
        source,
      },
      ctx,
    );
  },
};

export const nodeStubCommand: RuntimeCommand = {
  name: "node",
  async execute(): Promise<ExecResult> {
    return {
      exitCode: 1,
      stderr: `node: this sandbox uses js-exec instead of node\n\n${JS_EXEC_HELP}`,
      stdout: "",
    };
  },
};
