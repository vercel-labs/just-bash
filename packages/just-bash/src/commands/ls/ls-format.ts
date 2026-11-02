import { BoundedStringBuilder } from "../../bounded-builder.js";
import { utf8ByteLength } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import type { FsStat } from "../../fs/interface.js";
import type { FileTraversalBudget } from "../../fs/traversal.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { ExecResult, RuntimeCommandContext } from "../../types.js";
import { DEFAULT_BATCH_SIZE } from "../../utils/constants.js";
import { commandTimeZone } from "../date/date.js";
import { allocatedFileBytes, formatHumanSize } from "../file-metadata.js";
import { formatMode } from "../format-mode.js";
import { formatStrftime } from "../printf/strftime.js";

export interface LongListingOptions {
  humanReadable: boolean;
  classifyFiles: boolean;
  timeStyle?: string;
  now: number;
}

export function classifySuffix(stat: FsStat): string {
  if (stat.isDirectory) return "/";
  if (stat.isSymbolicLink) return "@";
  return (stat.mode & 0o111) !== 0 ? "*" : "";
}

export function formatLsDate(
  date: Date,
  ctx: RuntimeCommandContext,
  options: LongListingOptions,
): string {
  const recent =
    date.getTime() > options.now - 15_778_476_000 &&
    date.getTime() <= options.now;
  let format = recent ? "%b %e %H:%M" : "%b %e  %Y";
  if (options.timeStyle === "long-iso") format = "%Y-%m-%d %H:%M";
  else if (options.timeStyle === "full-iso") format = "%Y-%m-%d %H:%M:%S.%N %z";
  else if (options.timeStyle?.startsWith("+")) {
    const formats = options.timeStyle.slice(1).split("\n");
    format = formats[recent && formats.length === 2 ? 1 : 0];
  }
  return formatStrftime(format, date.getTime() / 1000, commandTimeZone(ctx), {
    maxOperations: ctx.limits.maxStringLength,
    maxOutputBytes: ctx.limits.maxOutputSize,
  });
}

/** A listing's widths are shared by all rows, including multiple operands. */
export async function longListing(
  ctx: RuntimeCommandContext,
  paths: ReadonlyArray<{ name: string; path: string }>,
  options: LongListingOptions,
  budget: FileTraversalBudget,
  includeTotal: boolean,
): Promise<ExecResult> {
  const stderr = new BoundedStringBuilder(ctx.limits.maxOutputSize, "ls");
  const rows: { stat: FsStat; name: string; size: string }[] = [];
  let retainedNameBytes = 0;
  const reserveName = (bytes: number): void => {
    if (bytes > ctx.limits.maxOutputSize - retainedNameBytes)
      throw new ExecutionLimitError(
        `ls: output size limit exceeded (${ctx.limits.maxOutputSize} bytes)`,
        "output_size",
      );
    retainedNameBytes += bytes;
  };
  let exitCode = 0;
  for (let offset = 0; offset < paths.length; offset += DEFAULT_BATCH_SIZE) {
    const loaded = await Promise.all(
      paths.slice(offset, offset + DEFAULT_BATCH_SIZE).map(async (entry) => {
        try {
          budget.checkpoint();
          const stat = await ctx.fs.lstat(entry.path);
          let name = entry.name;
          reserveName(utf8ByteLength(name));
          if (stat.isSymbolicLink) {
            budget.checkpoint();
            const target = await ctx.fs.readlink(entry.path);
            let suffix = "";
            if (options.classifyFiles) {
              try {
                budget.checkpoint();
                suffix = classifySuffix(await ctx.fs.stat(entry.path));
              } catch (error) {
                rethrowFatalExecutionError(error);
              }
            }
            reserveName(4 + utf8ByteLength(target) + suffix.length);
            name += ` -> ${target}${suffix}`;
          } else if (options.classifyFiles) {
            const suffix = classifySuffix(stat);
            reserveName(suffix.length);
            name += suffix;
          }
          const size = stat.isDirectory
            ? (ctx.virtualFileMetadata?.directorySize ?? stat.size)
            : stat.size;
          return {
            row: {
              stat,
              name,
              size: options.humanReadable
                ? formatHumanSize(size)
                : String(size),
            },
          };
        } catch (error) {
          rethrowFatalExecutionError(error);
          return {
            error: `ls: cannot access '${entry.name}': No such file or directory\n`,
          };
        }
      }),
    );
    for (const entry of loaded) {
      if (entry.row) rows.push(entry.row);
      else {
        stderr.append(entry.error);
        exitCode = 2;
      }
    }
  }
  const output = new BoundedStringBuilder(ctx.limits.maxOutputSize, "ls");
  const width = rows.reduce((max, row) => Math.max(max, row.size.length), 0);
  if (includeTotal) {
    const total = rows.reduce(
      (sum, row) => sum + allocatedFileBytes(row.stat, ctx.virtualFileMetadata),
      0,
    );
    output.append(
      `total ${options.humanReadable ? formatHumanSize(total) : Math.ceil(total / 1024)}\n`,
    );
  }
  const nlink = ctx.virtualFileMetadata?.nlink ?? 1;
  const user = ctx.virtualFileMetadata?.user ?? "user";
  const group = ctx.virtualFileMetadata?.group ?? "user";
  for (const row of rows) {
    budget.checkpoint();
    output.append(
      `${formatMode(row.stat.mode, row.stat.isDirectory, row.stat.isSymbolicLink)} ${nlink} ${user} ${group} `,
    );
    output.repeat(" ", width - row.size.length);
    output.append(
      `${row.size} ${formatLsDate(row.stat.mtime, ctx, options)} ${row.name}\n`,
    );
  }
  return { stdout: output.build(), stderr: stderr.build(), exitCode };
}
