import { BoundedStringBuilder } from "../../bounded-builder.js";
import type { ResourceLease } from "../../execution-scope.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import type { FsStat } from "../../fs/interface.js";
import { dirname, isSameOrDescendantPath } from "../../fs/path-utils.js";
import {
  compareCanonicalContainment,
  compareFileIdentity,
  FileTraversalBudget,
  type TraversalEntry,
  traverseFileTree,
} from "../../fs/traversal.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
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

const cpHelp = {
  name: "cp",
  summary: "copy files and directories",
  usage: "cp [OPTION]... SOURCE... DEST",
  options: [
    "-r, -R, --recursive  copy directories recursively",
    "-a, --archive        preserve links, modes and timestamps recursively",
    "-n, --no-clobber     do not overwrite existing files",
    "-p, --preserve       preserve modes and timestamps",
    "-u, --update         copy only newer or missing files",
    "-v, --verbose        explain what is being done",
    "-T, --no-target-directory treat DEST as a file",
    "-t, --target-directory=DIR copy into DIR",
    "    --help           display this help and exit",
  ],
};
const argDefs = {
  recursive: { short: "r", long: "recursive", type: "boolean" as const },
  recursiveUpper: { short: "R", type: "boolean" as const },
  archive: { short: "a", long: "archive", type: "boolean" as const },
  noDereference: {
    short: "d",
    long: "no-dereference",
    type: "boolean" as const,
  },
  noClobber: { short: "n", long: "no-clobber", type: "boolean" as const },
  preserve: { short: "p", long: "preserve", type: "boolean" as const },
  update: { short: "u", long: "update", type: "boolean" as const },
  verbose: { short: "v", long: "verbose", type: "boolean" as const },
  noTargetDirectory: {
    short: "T",
    long: "no-target-directory",
    type: "boolean" as const,
  },
  targetDirectory: {
    short: "t",
    long: "target-directory",
    type: "string" as const,
  },
};

async function optionalStat(
  ctx: RuntimeCommandContext,
  path: string,
  follow = true,
): Promise<FsStat | undefined> {
  try {
    return follow ? await ctx.fs.stat(path) : await ctx.fs.lstat(path);
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

export const cpCommand: RuntimeCommand = {
  name: "cp",
  async execute(args, ctx): Promise<ExecResult> {
    if (hasHelpFlag(args)) return showHelp(cpHelp);
    const normalized: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--") {
        normalized.push(...args.slice(i));
        break;
      }
      normalized.push(arg === "--preserve=all" ? "--preserve" : arg);
      if ((arg === "-t" || arg === "--target-directory") && i + 1 < args.length)
        normalized.push(args[++i]);
    }
    const parsed = parseArgs("cp", normalized, argDefs);
    if (!parsed.ok) return parsed.error;
    const flags = parsed.result.flags;
    const recursive = flags.recursive || flags.recursiveUpper || flags.archive;
    const preserve = flags.preserve || flags.archive;
    const noDereference = flags.noDereference || flags.archive || recursive;
    const paths = parsed.result.positional;
    const fail = (message: string): ExecResult => ({
      stdout: "",
      stderr: `cp: ${message}\n`,
      exitCode: 1,
    });
    if (flags.targetDirectory !== undefined && flags.noTargetDirectory)
      return fail(
        "cannot combine --target-directory (-t) and --no-target-directory (-T)",
      );
    if (paths.length < (flags.targetDirectory === undefined ? 2 : 1))
      return fail("missing destination file operand");
    const dest = flags.targetDirectory ?? paths.pop() ?? "";
    const destPath = ctx.fs.resolvePath(ctx.cwd, dest);
    const output = new BoundedStringBuilder(
      Math.min(ctx.limits.maxOutputSize, ctx.limits.maxStringLength),
      "cp",
    );
    let stderr = "";
    let exitCode = 0;
    const budget = new FileTraversalBudget({
      limits: ctx.limits,
      signal: ctx.signal,
      executionScope: ctx.executionScope,
      site: "cp",
    });
    let destStat: FsStat | undefined;
    try {
      destStat = await optionalStat(ctx, destPath);
    } catch (error) {
      rethrowFatalExecutionError(error);
      return fail(getErrorMessage(error));
    }
    const destIsDir =
      destStat?.isDirectory === true && !flags.noTargetDirectory;
    if ((paths.length > 1 || flags.targetDirectory !== undefined) && !destIsDir)
      return fail(`target '${dest}' is not a directory`);

    for (const source of paths) {
      const leases: ResourceLease[] = [];
      try {
        const sourcePath = ctx.fs.resolvePath(ctx.cwd, source);
        const sourceStat = noDereference
          ? await ctx.fs.lstat(sourcePath)
          : await ctx.fs.stat(sourcePath);
        const sourceRoot =
          noDereference && sourceStat.isSymbolicLink
            ? ctx.fs.resolvePath(
                await ctx.fs.realpath(dirname(sourcePath)),
                sourcePath.split("/").pop() ?? "",
              )
            : await ctx.fs.realpath(sourcePath);
        const basename = source.replace(/\/+$/, "").split("/").pop() || source;
        const lexicalTarget = destIsDir
          ? `${destPath === "/" ? "" : destPath}/${basename}`
          : destPath;
        const targetPath = ctx.fs.resolvePath(
          await ctx.fs.realpath(dirname(lexicalTarget)),
          lexicalTarget.split("/").pop() ?? "",
        );
        const targetName = destIsDir
          ? `${dest.replace(/\/+$/, "")}/${basename}`
          : dest;
        if (sourceStat.isDirectory && !recursive) {
          stderr += `cp: -r not specified; omitting directory '${source}'\n`;
          exitCode = 1;
          continue;
        }
        if (sourceStat.isDirectory) {
          const containment = await compareCanonicalContainment(
            ctx.fs,
            sourceRoot,
            targetPath,
            budget,
          );
          if (
            isSameOrDescendantPath(sourceRoot, targetPath) ||
            containment === "inside"
          ) {
            stderr += `cp: cannot copy '${source}' into itself, '${targetPath}'\n`;
            exitCode = 1;
            continue;
          }
          if (containment === "unknown")
            throw new Error(
              `cannot safely determine whether '${targetPath}' is inside '${source}'`,
            );
        }
        // Retain the bounded traversal plan instead of walking/copying the tree
        // twice. No destination is changed before the full source is admitted.
        const plan: TraversalEntry[] = [];
        let planBytes = 0;
        await traverseFileTree(
          {
            fs: ctx.fs,
            root: sourceRoot,
            limits: ctx.limits,
            signal: ctx.signal,
            executionScope: ctx.executionScope,
            site: "cp",
            symlinks: "never",
            includeLeave: true,
            budget,
          },
          (entry) => {
            if (plan.length >= ctx.limits.maxArrayElements)
              throw new ExecutionLimitError(
                "cp: copy plan entry limit exceeded",
                "array_elements",
              );
            // Conservative retained-record estimate, including the path string.
            const bytes = 256 + entry.path.length * 2;
            if (bytes > ctx.limits.maxLiveBytes - planBytes)
              throw new ExecutionLimitError(
                "cp: copy plan memory limit exceeded",
                "string_length",
              );
            const lease = ctx.executionScope?.reserveBytes("cp-plan", bytes);
            if (lease) leases.push(lease);
            planBytes += bytes;
            plan.push(entry);
          },
        );
        for (const entry of plan) {
          budget.checkpoint();
          const suffix = entry.path.slice(sourceRoot.length);
          const target = `${targetPath}${suffix}`;
          const shownSource = `${source.replace(/\/+$/, "")}${suffix}`;
          const shownTarget = `${targetName}${suffix}`;
          if (entry.phase === "leave") {
            if (preserve) {
              await ctx.fs.chmod(target, entry.stat.mode & 0o7777);
              await ctx.fs.utimes(
                target,
                new Date((entry.stat.atime ?? entry.stat.mtime).getTime()),
                new Date(entry.stat.mtime.getTime()),
              );
            }
            continue;
          }
          const existing = await optionalStat(ctx, target, false);
          if (entry.stat.isDirectory) {
            if (existing && !(await ctx.fs.stat(target)).isDirectory)
              throw new Error(
                `cannot overwrite non-directory '${shownTarget}' with directory '${shownSource}'`,
              );
            if (!existing) {
              await ctx.fs.mkdir(target);
              if (flags.verbose)
                output.append(`'${shownSource}' -> '${shownTarget}'\n`);
            }
            continue;
          }
          if (existing && flags.noClobber) continue;
          if (existing?.isDirectory)
            throw new Error(
              `cannot overwrite directory '${shownTarget}' with non-directory`,
            );
          if (existing && flags.update && !entry.isSymlink) {
            const targetStat = await optionalStat(ctx, target);
            if (
              targetStat &&
              targetStat.mtime.getTime() >= entry.stat.mtime.getTime()
            )
              continue;
          }
          if (entry.isSymlink) {
            const sourceEntry = `${await ctx.fs.realpath(dirname(entry.path))}/${entry.path.split("/").pop()}`;
            const targetEntry = `${await ctx.fs.realpath(dirname(target))}/${target.split("/").pop()}`;
            if (sourceEntry === targetEntry)
              throw new Error(
                `'${shownSource}' and '${shownTarget}' are the same file`,
              );
            const linkTarget = await ctx.fs.readlink(entry.path);
            if (existing) await ctx.fs.rm(target);
            await ctx.fs.symlink(linkTarget, target);
            if (preserve)
              throw new Error(
                "ENOTSUP: preserving symbolic-link timestamps requires a non-following filesystem operation",
              );
          } else {
            const actualTarget = existing?.isSymbolicLink
              ? await ctx.fs.realpath(target)
              : target;
            const identity = await compareFileIdentity(
              ctx.fs,
              entry.path,
              actualTarget,
            );
            if (identity === "same")
              throw new Error(
                `'${shownSource}' and '${shownTarget}' are the same file`,
              );
            if (identity === "unknown")
              throw new Error(
                `cannot safely determine whether '${shownSource}' and '${shownTarget}' are the same file`,
              );
            const existingMode = existing
              ? (await ctx.fs.stat(actualTarget)).mode
              : undefined;
            if (!(await ctx.fs.stat(dirname(actualTarget))).isDirectory)
              throw new Error(`ENOTDIR: '${shownTarget}'`);
            await ctx.fs.cp(entry.path, actualTarget);
            const copiedMode = preserve
              ? entry.stat.mode
              : (existingMode ?? entry.stat.mode & ~0o022);
            await ctx.fs.chmod(actualTarget, copiedMode & 0o7777);
            if (preserve)
              await ctx.fs.utimes(
                actualTarget,
                new Date((entry.stat.atime ?? entry.stat.mtime).getTime()),
                new Date(entry.stat.mtime.getTime()),
              );
          }
          if (flags.verbose)
            output.append(`'${shownSource}' -> '${shownTarget}'\n`);
        }
      } catch (error) {
        rethrowFatalExecutionError(error);
        stderr +=
          getErrorCode(error) === "ENOENT"
            ? `cp: cannot stat '${source}': No such file or directory\n`
            : `cp: cannot copy '${source}': ${getErrorMessage(error)}\n`;
        exitCode = 1;
      } finally {
        for (const lease of leases) lease.release();
      }
    }
    return { stdout: output.build(), stderr, exitCode };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";
export const flagsForFuzzing: CommandFuzzInfo = {
  name: "cp",
  flags: [
    { flag: "-r", type: "boolean" },
    { flag: "-R", type: "boolean" },
    { flag: "-a", type: "boolean" },
    { flag: "-n", type: "boolean" },
    { flag: "-p", type: "boolean" },
    { flag: "-u", type: "boolean" },
    { flag: "-v", type: "boolean" },
  ],
  needsArgs: true,
  minArgs: 2,
};
