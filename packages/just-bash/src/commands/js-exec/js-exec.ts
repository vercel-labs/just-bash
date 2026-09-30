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
 * Whether every quote in `code` is closed, so that a `//` or a `/*` at its
 * end is a comment rather than the inside of a string.
 */
function quotesBalanced(code: string): boolean {
  let open: string | undefined;
  for (let index = 0; index < code.length; index++) {
    const char = code[index];
    if (open === undefined) {
      if (char === "'" || char === '"' || char === "`") open = char;
    } else if (char === "\\") {
      index++;
    } else if (char === open) {
      open = undefined;
    }
  }
  return open === undefined;
}

/**
 * The program without the trailing semicolons and comments that end a typed
 * expression (`1; // two`), so it can sit in an expression position.
 */
function trailingExpression(code: string): string {
  let expression = code;
  for (;;) {
    const trimmed = expression.trimEnd();
    let next = trimmed;
    if (trimmed.endsWith(";")) {
      next = trimmed.slice(0, -1);
    } else if (trimmed.endsWith("*/")) {
      const start = trimmed.lastIndexOf("/*");
      if (start !== -1 && quotesBalanced(trimmed.slice(0, start))) {
        next = trimmed.slice(0, start);
      }
    } else {
      // A `//` inside a string, or one whose first slash is escaped (the
      // end of a regex like /https:\/\//), is not a comment.
      let commentStart = trimmed.indexOf("//", trimmed.lastIndexOf("\n") + 1);
      while (
        commentStart !== -1 &&
        (trimmed[commentStart - 1] === "\\" ||
          !quotesBalanced(trimmed.slice(0, commentStart)))
      ) {
        commentStart = trimmed.indexOf("//", commentStart + 1);
      }
      if (commentStart !== -1) next = trimmed.slice(0, commentStart);
    }
    if (next === expression) return expression;
    expression = next;
  }
}

/**
 * How `-p` prints a value: strings as they are, and the rest the way node
 * inspects them for the kinds `console.log`'s JSON would lose (a RegExp as
 * `{}`, a Symbol or a function as nothing). Objects and arrays stay JSON,
 * as they are everywhere in this runtime. A declaration, so it hoists above
 * the expression and the expression keeps its place on line 1.
 */
const PRINT_VALUE = `function __jbPrint(v) { console.log(typeof v === 'string' ? v : typeof v === 'symbol' ? v.toString() : typeof v === 'bigint' ? v + 'n' : typeof v === 'function' ? (v.name ? '[Function: ' + v.name + ']' : '[Function (anonymous)]') : v instanceof RegExp ? String(v) : v instanceof Date ? v.toISOString() : v instanceof Error ? String(v) + (v.stack ? '\\n' + v.stack : '') : v === undefined || v === null || typeof v === 'number' || typeof v === 'boolean' ? String(v) : (function () { try { return JSON.stringify(v); } catch (_) { return String(v); } })()); }`;

/**
 * `-p` prints the value of one expression, which is what node prints for a
 * single expression statement; an empty program prints `undefined`, as
 * node does. A program of several statements is a syntax error here. The
 * newline after the expression keeps a comment inside it from swallowing
 * the closing parenthesis.
 */
function printSource(code: string): string {
  const expression = trailingExpression(code);
  return `__jbPrint((${expression === "" ? "undefined" : expression}\n));\n${PRINT_VALUE}`;
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
