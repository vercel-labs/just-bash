import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { dirname } from "../../fs/path-utils.js";
import { sanitizeErrorMessage } from "../../fs/sanitize-error.js";
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
import { hasHelpFlag, showHelp } from "../help.js";

const lnHelp = {
  name: "ln",
  summary: "make links between files",
  usage: "ln [OPTIONS] TARGET LINK_NAME",
  options: [
    "-s, --symbolic       create a symbolic link",
    "-f, --force          remove existing destination files",
    "-n, --no-dereference treat a destination symlink as a normal file",
    "-r, --relative       create a relative symbolic link",
    "-v, --verbose        print each linked file",
    "    --help           display this help and exit",
  ],
};
const argDefs = {
  symbolic: { short: "s", long: "symbolic", type: "boolean" as const },
  force: { short: "f", long: "force", type: "boolean" as const },
  noDereference: {
    short: "n",
    long: "no-dereference",
    type: "boolean" as const,
  },
  relative: { short: "r", long: "relative", type: "boolean" as const },
  verbose: { short: "v", long: "verbose", type: "boolean" as const },
};

/** Canonicalize the existing prefix while retaining a dangling target suffix. */
async function resolveMissingTarget(
  ctx: RuntimeCommandContext,
  path: string,
): Promise<string> {
  const suffix: string[] = [];
  let candidate = path;
  while (true) {
    ctx.executionScope?.throwIfAborted("ln");
    ctx.executionScope?.consumeWork(1, "ln relative target");
    try {
      return [await ctx.fs.realpath(candidate), ...suffix]
        .join("/")
        .replace(/^\/\//, "/");
    } catch (error) {
      rethrowFatalExecutionError(error);
      if (getErrorCode(error) !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      suffix.unshift(candidate.slice(parent === "/" ? 1 : parent.length + 1));
      candidate = parent;
    }
  }
}

export const lnCommand: RuntimeCommand = {
  name: "ln",
  async execute(args, ctx): Promise<ExecResult> {
    if (hasHelpFlag(args)) return showHelp(lnHelp);
    const parsed = parseArgs("ln", args, argDefs);
    if (!parsed.ok) return parsed.error;
    const { symbolic, force, noDereference, relative, verbose } =
      parsed.result.flags;
    const remaining = parsed.result.positional;
    const fail = (message: string): ExecResult => ({
      stdout: "",
      stderr: `ln: ${message}\n`,
      exitCode: 1,
    });
    if (remaining.length < 2) return fail("missing file operand");
    if (remaining.length > 2) return fail(`extra operand '${remaining[2]}'`);
    if (relative && !symbolic)
      return fail("cannot do --relative without --symbolic");
    const target = remaining[0];
    let linkName = remaining[1];
    let linkPath = ctx.fs.resolvePath(ctx.cwd, linkName);
    try {
      try {
        const destination = noDereference
          ? await ctx.fs.lstat(linkPath)
          : await ctx.fs.stat(linkPath);
        if (destination.isDirectory) {
          const basename =
            target.replace(/\/+$/, "").split("/").pop() || target;
          linkName = `${linkName.replace(/\/+$/, "")}/${basename}`;
          linkPath = ctx.fs.resolvePath(ctx.cwd, linkName);
        }
      } catch (error) {
        if (getErrorCode(error) !== "ENOENT") throw error;
      }
      const parent = await ctx.fs.stat(dirname(linkPath));
      if (!parent.isDirectory)
        return fail(`failed to create link '${linkName}': Not a directory`);
      const canonicalParent = await ctx.fs.realpath(dirname(linkPath));
      linkPath = ctx.fs.resolvePath(
        canonicalParent,
        linkPath.split("/").pop() ?? "",
      );
      let storedTarget = target;
      if (relative) {
        const resolvedTarget = (
          await resolveMissingTarget(ctx, ctx.fs.resolvePath(ctx.cwd, target))
        )
          .split("/")
          .filter(Boolean);
        const resolvedParent = (await ctx.fs.realpath(dirname(linkPath)))
          .split("/")
          .filter(Boolean);
        let common = 0;
        while (
          common < resolvedTarget.length &&
          common < resolvedParent.length &&
          resolvedTarget[common] === resolvedParent[common]
        )
          common++;
        storedTarget =
          [
            ...resolvedParent.slice(common).map(() => ".."),
            ...resolvedTarget.slice(common),
          ].join("/") || ".";
      }
      let exists = false;
      try {
        const destination = await ctx.fs.lstat(linkPath);
        exists = true;
        if (destination.isDirectory)
          return fail(`failed to create link '${linkName}': File exists`);
      } catch (error) {
        if (getErrorCode(error) !== "ENOENT") throw error;
      }
      if (exists && !force)
        return fail(
          `failed to create ${symbolic ? "symbolic " : ""}link '${linkName}': File exists`,
        );
      if (!symbolic) {
        const targetPath = ctx.fs.resolvePath(ctx.cwd, target);
        if (!(await ctx.fs.exists(targetPath)))
          return fail(
            `failed to access '${target}': No such file or directory`,
          );
        if (
          exists &&
          (await ctx.fs.realpath(targetPath)) ===
            (await ctx.fs.realpath(linkPath))
        )
          return fail(`'${target}' and '${linkName}' are the same file`);
        if (exists) await ctx.fs.rm(linkPath, { force: true });
        await ctx.fs.link(targetPath, linkPath);
      } else {
        if (exists) await ctx.fs.rm(linkPath, { force: true });
        await ctx.fs.symlink(storedTarget, linkPath);
      }
      return {
        stdout: verbose ? `'${linkName}' -> '${storedTarget}'\n` : "",
        stderr: "",
        exitCode: 0,
      };
    } catch (error) {
      rethrowFatalExecutionError(error);
      if (getErrorCode(error) === "EPERM")
        return fail(
          symbolic
            ? `failed to create symbolic link '${linkName}': Operation not permitted`
            : `'${target}': hard link not allowed for directory`,
        );
      return fail(sanitizeErrorMessage(getErrorMessage(error)));
    }
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";
export const flagsForFuzzing: CommandFuzzInfo = {
  name: "ln",
  flags: [
    { flag: "-s", type: "boolean" },
    { flag: "-f", type: "boolean" },
    { flag: "-n", type: "boolean" },
    { flag: "-r", type: "boolean" },
    { flag: "-v", type: "boolean" },
  ],
  needsArgs: true,
  minArgs: 2,
};
