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
  .js              script mode
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
  scriptFile: string | null;
  showVersion: boolean;
  scriptArgs: string[];
  isModule: boolean;
}

function parseArgs(args: string[]): ParsedArgs | ExecResult {
  const result: ParsedArgs = {
    code: null,
    isModule: false,
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
    if (arg === "-c") {
      if (index + 1 >= args.length) {
        return {
          exitCode: 2,
          stderr: "js-exec: option requires an argument -- 'c'\n",
          stdout: "",
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
    result.scriptFile = arg;
    result.scriptArgs = args.slice(index + 1);
    return result;
  }
  return result;
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
      source = parsed.code;
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
          "js-exec: no input provided (use -c CODE or provide a script file)\n",
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
