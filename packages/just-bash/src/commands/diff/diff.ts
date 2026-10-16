/**
 * diff - Compare files line by line
 */

import { BoundedStringBuilder } from "../../bounded-builder.js";
import { decodeBytesToUtf8 } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { FileTraversalBudget } from "../../fs/traversal.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { hasHelpFlag, showHelp } from "../help.js";
import {
  computeChanges,
  DEFAULT_CONTEXT,
  formatContext,
  formatNormal,
  formatUnified,
  quoteFilename,
  splitLines,
} from "./format.js";

const diffHelp = {
  name: "diff",
  summary: "compare files line by line",
  usage: "diff [OPTION]... FILE1 FILE2",
  options: [
    "    --normal      output a normal diff (default)",
    "-u, -U N, --unified[=N]  output a unified diff (default 3 lines)",
    "-r, --recursive   recursively compare directories",
    "-w, --ignore-all-space  ignore all whitespace",
    "-b, --ignore-space-change  ignore changes in whitespace amount",
    "-B, --ignore-blank-lines  ignore blank-line-only changes",
    "-c, --context     output a context diff",
    "-q, --brief       report only whether files differ",
    "-s, --report-identical-files  report when files are the same",
    "-i, --ignore-case  ignore case differences",
    "    --version     output version information and exit",
    "    --help        display this help and exit",
  ],
};

const argDefs = {
  recursive: { short: "r", long: "recursive", type: "boolean" as const },
  contextLines: { short: "U", type: "string" as const },
  ignoreAllSpace: {
    short: "w",
    long: "ignore-all-space",
    type: "boolean" as const,
  },
  ignoreSpaceChange: {
    short: "b",
    long: "ignore-space-change",
    type: "boolean" as const,
  },
  ignoreBlankLines: {
    short: "B",
    long: "ignore-blank-lines",
    type: "boolean" as const,
  },
  normal: { long: "normal", type: "boolean" as const },
  unified: { short: "u", long: "unified", type: "boolean" as const },
  context: { short: "c", long: "context", type: "boolean" as const },
  brief: { short: "q", long: "brief", type: "boolean" as const },
  reportSame: {
    short: "s",
    long: "report-identical-files",
    type: "boolean" as const,
  },
  ignoreCase: { short: "i", long: "ignore-case", type: "boolean" as const },
  version: { long: "version", type: "boolean" as const },
};

export const diffCommand: RuntimeCommand = {
  name: "diff",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) return showHelp(diffHelp);

    const endOptions = args.indexOf("--");
    const parsed = parseArgs(
      "diff",
      args.map((arg, index) =>
        (endOptions < 0 || index < endOptions) && arg.startsWith("--unified=")
          ? `-U${arg.slice("--unified=".length)}`
          : arg,
      ),
      argDefs,
    );
    if (!parsed.ok) return { ...parsed.error, exitCode: 2 };

    const flags = parsed.result.flags;
    if (flags.version) {
      // No version number: this command ships inside just-bash and has no
      // release cadence of its own, and a hard-coded package version would go
      // stale on the very next release.
      return { stdout: "diff (just-bash)\n", stderr: "", exitCode: 0 };
    }

    const unified = flags.unified || flags.contextLines !== undefined;
    if (flags.contextLines !== undefined && !/^\d+$/.test(flags.contextLines)) {
      return {
        stdout: "",
        stderr: `diff: invalid context length '${flags.contextLines}'\n`,
        exitCode: 2,
      };
    }
    const contextLines =
      flags.contextLines === undefined
        ? DEFAULT_CONTEXT
        : Number(flags.contextLines);
    const styleCount =
      Number(flags.normal) + Number(unified) + Number(flags.context);
    if (styleCount > 1) {
      return {
        stdout: "",
        stderr:
          "diff: conflicting output style options\n" +
          "diff: Try 'diff --help' for more information.\n",
        exitCode: 2,
      };
    }

    const brief = flags.brief;
    const reportSame = flags.reportSame;
    const ignoreCase = flags.ignoreCase;
    const files = parsed.result.positional;

    if (files.length < 2) {
      return { stdout: "", stderr: "diff: missing operand\n", exitCode: 2 };
    }

    const budget = new FileTraversalBudget({
      limits: ctx.limits,
      signal: ctx.signal,
      executionScope: ctx.executionScope,
      site: "diff",
    });
    const stdout = new BoundedStringBuilder(ctx.limits.maxOutputSize, "diff");
    const stderr = new BoundedStringBuilder(ctx.limits.maxOutputSize, "diff");
    let exitCode = 0;
    const shortOptions = Object.entries(argDefs)
      .filter(
        ([name, def]) =>
          def.type === "boolean" &&
          "short" in def &&
          flags[name as keyof typeof flags],
      )
      .map(([, def]) => ("short" in def ? def.short : ""))
      .join("");
    const headerOptions = [
      shortOptions && `-${shortOptions}`,
      flags.normal && "--normal",
      flags.contextLines !== undefined && `-U${flags.contextLines}`,
    ]
      .filter(Boolean)
      .join(" ");

    const activeLeft = new Set<string>();
    const activeRight = new Set<string>();
    async function compare(
      f1: string,
      f2: string,
      depth: number,
      directoryEntry = false,
    ): Promise<void> {
      budget.visit(depth);
      let path = f1;
      try {
        const s1 =
          f1 === "-"
            ? undefined
            : await ctx.fs.stat(ctx.fs.resolvePath(ctx.cwd, f1));
        path = f2;
        const s2 =
          f2 === "-"
            ? undefined
            : await ctx.fs.stat(ctx.fs.resolvePath(ctx.cwd, f2));
        if (s1?.isDirectory && s2?.isDirectory) {
          if (depth > 0 && !flags.recursive) {
            stdout.append(
              `Common subdirectories: ${quoteFilename(f1)} and ${quoteFilename(f2)}\n`,
            );
            return;
          }
          const leftIdentity = await ctx.fs.realpath(
            ctx.fs.resolvePath(ctx.cwd, f1),
          );
          const rightIdentity = await ctx.fs.realpath(
            ctx.fs.resolvePath(ctx.cwd, f2),
          );
          if (activeLeft.has(leftIdentity) || activeRight.has(rightIdentity)) {
            stderr.append(
              `diff: ${quoteFilename(activeLeft.has(leftIdentity) ? f1 : f2)}: recursive directory loop\n`,
            );
            exitCode = 2;
            return;
          }
          activeLeft.add(leftIdentity);
          activeRight.add(rightIdentity);
          try {
            path = f1;
            const left = new Set(
              await ctx.fs.readdir(ctx.fs.resolvePath(ctx.cwd, f1)),
            );
            path = f2;
            const right = new Set(
              await ctx.fs.readdir(ctx.fs.resolvePath(ctx.cwd, f2)),
            );
            budget.discover(left.size + right.size);
            for (const name of [...new Set([...left, ...right])].sort()) {
              if (!left.has(name) || !right.has(name)) {
                stdout.append(
                  `Only in ${quoteFilename(left.has(name) ? f1 : f2)}: ${quoteFilename(name)}\n`,
                );
                exitCode = Math.max(exitCode, 1);
              } else {
                await compare(
                  `${f1.replace(/\/$/, "")}/${name}`,
                  `${f2.replace(/\/$/, "")}/${name}`,
                  depth + 1,
                  true,
                );
              }
            }
          } finally {
            activeLeft.delete(leftIdentity);
            activeRight.delete(rightIdentity);
          }
          return;
        }
        if (s1?.isDirectory || s2?.isDirectory) {
          if (depth === 0 && f1 !== "-" && f2 !== "-") {
            await compare(
              s1?.isDirectory
                ? `${f1.replace(/\/$/, "")}/${f2.split("/").pop()}`
                : f1,
              s2?.isDirectory
                ? `${f2.replace(/\/$/, "")}/${f1.split("/").pop()}`
                : f2,
              depth + 1,
            );
            return;
          }
          stdout.append(
            `File ${quoteFilename(f1)} is a ${s1?.isDirectory ? "directory" : "regular file"} while file ${quoteFilename(f2)} is a ${s2?.isDirectory ? "directory" : "regular file"}\n`,
          );
          exitCode = Math.max(exitCode, 1);
          return;
        }
      } catch (error) {
        rethrowFatalExecutionError(error);
        stderr.append(
          `diff: ${quoteFilename(path)}: No such file or directory\n`,
        );
        exitCode = 2;
        return;
      }
      const result = await compareFiles(f1, f2);
      if (directoryEntry && result.exitCode === 1 && !brief) {
        stdout.append(
          `diff${headerOptions ? ` ${headerOptions}` : ""} ${quoteFilename(f1)} ${quoteFilename(f2)}\n`,
        );
      }
      stdout.append(result.stdout);
      stderr.append(result.stderr);
      exitCode = Math.max(exitCode, result.exitCode);
    }

    async function compareFiles(f1: string, f2: string): Promise<ExecResult> {
      let c1: string, c2: string;

      // diff compares lines as strings. Normalize stdin (byte buffer) to
      // UTF-8 so it compares correctly against file content (utf8 by default).
      try {
        c1 =
          f1 === "-"
            ? decodeBytesToUtf8(ctx.stdin)
            : await ctx.fs.readFile(ctx.fs.resolvePath(ctx.cwd, f1));
      } catch {
        return {
          stdout: "",
          stderr: `diff: ${quoteFilename(f1)}: No such file or directory\n`,
          exitCode: 2,
        };
      }

      try {
        c2 =
          f2 === "-"
            ? decodeBytesToUtf8(ctx.stdin)
            : await ctx.fs.readFile(ctx.fs.resolvePath(ctx.cwd, f2));
      } catch {
        return {
          stdout: "",
          stderr: `diff: ${quoteFilename(f2)}: No such file or directory\n`,
          exitCode: 2,
        };
      }

      const same = ignoreCase
        ? c1.toLowerCase() === c2.toLowerCase()
        : c1 === c2;
      if (same) {
        return {
          stdout: reportSame
            ? `Files ${quoteFilename(f1)} and ${quoteFilename(f2)} are identical\n`
            : "",
          stderr: "",
          exitCode: 0,
        };
      }
      if (
        brief &&
        !flags.ignoreAllSpace &&
        !flags.ignoreSpaceChange &&
        !flags.ignoreBlankLines
      ) {
        return {
          stdout: `Files ${quoteFilename(f1)} and ${quoteFilename(f2)} differ\n`,
          stderr: "",
          exitCode: 1,
        };
      }
      const oldFile = splitLines(c1);
      const newFile = splitLines(c2);
      const changes = computeChanges(oldFile, newFile, ignoreCase, flags);
      if (changes.every((change) => change.ignored)) {
        return {
          stdout: reportSame
            ? `Files ${quoteFilename(f1)} and ${quoteFilename(f2)} are identical\n`
            : "",
          stderr: "",
          exitCode: 0,
        };
      }
      if (brief) {
        return {
          stdout: `Files ${quoteFilename(f1)} and ${quoteFilename(f2)} differ\n`,
          stderr: "",
          exitCode: 1,
        };
      }

      let output: string;
      if (unified) {
        output = formatUnified(f1, f2, oldFile, newFile, changes, contextLines);
      } else if (flags.context) {
        output = formatContext(
          f1,
          f2,
          oldFile,
          newFile,
          changes,
          DEFAULT_CONTEXT,
        );
      } else {
        output = formatNormal(oldFile, newFile, changes);
      }

      // diff emits text; the pipeline handles encoding.
      return {
        stdout: output,
        stderr: "",
        exitCode: 1,
      };
    }
    await compare(files[0], files[1], 0);
    return { stdout: stdout.build(), stderr: stderr.build(), exitCode };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "diff",
  flags: [
    { flag: "--normal", type: "boolean" },
    { flag: "-u", type: "boolean" },
    { flag: "-r", type: "boolean" },
    { flag: "-w", type: "boolean" },
    { flag: "-b", type: "boolean" },
    { flag: "-B", type: "boolean" },
    { flag: "-c", type: "boolean" },
    { flag: "-q", type: "boolean" },
    { flag: "-s", type: "boolean" },
    { flag: "-i", type: "boolean" },
  ],
  needsArgs: true,
  minArgs: 2,
};
