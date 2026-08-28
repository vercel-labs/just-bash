/**
 * js-exec - Execute JavaScript code via the run package.
 */

import { decodeBytesToUtf8 } from "../../encoding.js";
import { sanitizeErrorMessage } from "../../fs/sanitize-error.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag } from "../help.js";
import { executeWithRun } from "./run-runtime.js";

const JS_EXEC_HELP = `js-exec - Sandboxed JavaScript/TypeScript runtime with Node.js-compatible APIs

Usage: js-exec [OPTIONS] [-c CODE | FILE] [ARGS...]

Options:
  -c CODE          Execute inline code
  -m, --module     Enable ES module mode (import/export)
  --strip-types    Strip TypeScript type annotations
  --version, -V    Show version
  --help           Show this help

Examples:
  js-exec -c "console.log(1 + 2)"
  js-exec script.js
  js-exec app.ts
  echo 'console.log("hello")' | js-exec

File Extension Auto-Detection:
  .js              script mode
  .mjs             ES module mode
  .ts, .mts        ES module mode + TypeScript stripping

Node.js Compatibility:
  Code written for Node.js largely works here. CommonJS module loading and
  standard globals like process, console, fetch, and Buffer are available.

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
  scriptFile: string | null;
  showVersion: boolean;
  scriptArgs: string[];
  isModule: boolean;
  stripTypes: boolean;
}

function parseArgs(args: string[]): ParsedArgs | ExecResult {
  const result: ParsedArgs = {
    code: null,
    scriptFile: null,
    showVersion: false,
    scriptArgs: [],
    isModule: false,
    stripTypes: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-m" || arg === "--module") {
      result.isModule = true;
      continue;
    }
    if (arg === "--strip-types") {
      result.stripTypes = true;
      continue;
    }
    if (arg === "-c") {
      if (index + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "js-exec: option requires an argument -- 'c'\n",
          exitCode: 2,
        };
      }
      result.code = args[index + 1];
      result.scriptArgs = args.slice(index + 2);
      return result;
    }
    if (arg === "--version" || arg === "-V") {
      result.showVersion = true;
      return result;
    }
    if (arg.startsWith("-") && arg !== "-" && arg !== "--") {
      return {
        stdout: "",
        stderr: `js-exec: unrecognized option '${arg}'\n`,
        exitCode: 2,
      };
    }
    if (arg === "--") {
      if (index + 1 < args.length) {
        result.scriptFile = args[index + 1];
        result.scriptArgs = args.slice(index + 2);
      }
      return result;
    }
    result.scriptFile = arg;
    result.scriptArgs = args.slice(index + 1);
    return result;
  }

  return result;
}

export const jsExecCommand: RuntimeCommand = {
  name: "js-exec",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return { stdout: JS_EXEC_HELP, stderr: "", exitCode: 0 };
    }

    const parsed = parseArgs(args);
    if ("exitCode" in parsed) return parsed;

    if (parsed.showVersion) {
      return { stdout: "QuickJS (run)\n", stderr: "", exitCode: 0 };
    }

    let source: string;
    let scriptPath: string;

    if (parsed.code !== null) {
      source = parsed.code;
      scriptPath = "-c";
    } else if (parsed.scriptFile !== null) {
      const filePath = ctx.fs.resolvePath(ctx.cwd, parsed.scriptFile);
      if (!(await ctx.fs.exists(filePath))) {
        return {
          stdout: "",
          stderr: `js-exec: can't open file '${parsed.scriptFile}': No such file or directory\n`,
          exitCode: 2,
        };
      }
      try {
        source = await ctx.fs.readFile(filePath);
        scriptPath = filePath;
      } catch (error) {
        return {
          stdout: "",
          stderr: `js-exec: can't open file '${parsed.scriptFile}': ${sanitizeErrorMessage((error as Error).message)}\n`,
          exitCode: 2,
        };
      }
    } else if (decodeBytesToUtf8(ctx.stdin).trim()) {
      source = decodeBytesToUtf8(ctx.stdin);
      scriptPath = "<stdin>";
    } else {
      return {
        stdout: "",
        stderr:
          "js-exec: no input provided (use -c CODE or provide a script file)\n",
        exitCode: 2,
      };
    }

    const isModule =
      parsed.isModule ||
      scriptPath.endsWith(".mjs") ||
      scriptPath.endsWith(".mts") ||
      scriptPath.endsWith(".ts");
    const stripTypes =
      parsed.stripTypes ||
      scriptPath.endsWith(".ts") ||
      scriptPath.endsWith(".mts");

    return executeWithRun(
      {
        source,
        scriptPath,
        scriptArgs: parsed.scriptArgs,
        bootstrapCode: ctx.jsBootstrapCode,
        isModule,
        stripTypes,
      },
      ctx,
    );
  },
};

export const nodeStubCommand: RuntimeCommand = {
  name: "node",
  async execute(): Promise<ExecResult> {
    return {
      stdout: "",
      stderr: `node: this sandbox uses js-exec instead of node\n\n${JS_EXEC_HELP}`,
      exitCode: 1,
    };
  },
};
