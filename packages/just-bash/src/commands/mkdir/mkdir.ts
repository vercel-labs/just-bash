import { BoundedStringBuilder } from "../../bounded-builder.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { sanitizeErrorMessage } from "../../fs/sanitize-error.js";
import { FileTraversalBudget } from "../../fs/traversal.js";
import {
  getErrorCode,
  getErrorMessage,
} from "../../interpreter/helpers/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { parseFileMode } from "../file-mode.js";

const argDefs = {
  recursive: { short: "p", long: "parents", type: "boolean" as const },
  mode: { short: "m", long: "mode", type: "string" as const },
  verbose: { short: "v", long: "verbose", type: "boolean" as const },
};

export const mkdirCommand: RuntimeCommand = {
  name: "mkdir",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    const parsed = parseArgs("mkdir", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const recursive = parsed.result.flags.recursive;
    const verbose = parsed.result.flags.verbose;
    const dirs = parsed.result.positional;

    if (dirs.length === 0) {
      return {
        stdout: "",
        stderr: "mkdir: missing operand\n",
        exitCode: 1,
      };
    }

    const modeArg = parsed.result.flags.mode;
    let mode: number | undefined;
    try {
      if (modeArg !== undefined) mode = parseFileMode(modeArg, 0o777, true);
    } catch {
      return {
        stdout: "",
        stderr: `mkdir: invalid mode '${modeArg}'\n`,
        exitCode: 1,
      };
    }
    const output = new BoundedStringBuilder(
      Math.min(ctx.limits.maxOutputSize, ctx.limits.maxStringLength),
      "mkdir",
    );
    const budget = new FileTraversalBudget({
      limits: ctx.limits,
      executionScope: ctx.executionScope,
      signal: ctx.signal,
      site: "mkdir",
    });
    let stderr = "";
    let exitCode = 0;

    for (const dir of dirs) {
      try {
        const fullPath = ctx.fs.resolvePath(ctx.cwd, dir);
        function* candidates(): Generator<string> {
          if (!recursive) {
            yield dir;
            return;
          }
          let current = dir.startsWith("/") ? "/" : "";
          for (const part of dir.split("/")) {
            if (!part) continue;
            current =
              current === "/"
                ? `/${part}`
                : current
                  ? `${current}/${part}`
                  : part;
            yield current;
          }
        }
        let depth = 0;
        for (const candidate of candidates()) {
          budget.visit(depth++);
          const path = ctx.fs.resolvePath(ctx.cwd, candidate);
          if (recursive) {
            try {
              const stat = await ctx.fs.stat(path);
              if (stat.isDirectory) continue;
              throw new Error(`EEXIST: path exists '${candidate}'`);
            } catch (error) {
              if (getErrorCode(error) !== "ENOENT") throw error;
            }
          }
          await ctx.fs.mkdir(path);
          if (mode !== undefined && path === fullPath)
            await ctx.fs.chmod(path, mode);
          if (verbose)
            output.append(`mkdir: created directory '${candidate}'\n`);
        }
      } catch (error) {
        rethrowFatalExecutionError(error);
        const message = getErrorMessage(error);
        if (message.includes("ENOENT") || message.includes("no such file")) {
          stderr += `mkdir: cannot create directory '${dir}': No such file or directory\n`;
        } else if (
          message.includes("EEXIST") ||
          message.includes("already exists")
        ) {
          stderr += `mkdir: cannot create directory '${dir}': File exists\n`;
        } else {
          stderr += `mkdir: cannot create directory '${dir}': ${sanitizeErrorMessage(message)}\n`;
        }
        exitCode = 1;
      }
    }

    return { stdout: output.build(), stderr, exitCode };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "mkdir",
  flags: [
    { flag: "-p", type: "boolean" },
    { flag: "-v", type: "boolean" },
  ],
  needsArgs: true,
};
