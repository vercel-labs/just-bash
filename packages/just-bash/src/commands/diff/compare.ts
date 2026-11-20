import { BoundedStringBuilder } from "../../bounded-builder.js";
import {
  decodeBytesToUtf8,
  latin1FromBytes,
  readBytesFrom,
} from "../../encoding.js";
import type { ResourceLease } from "../../execution-scope.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import type { FsStat } from "../../fs/interface.js";
import { FileTraversalBudget } from "../../fs/traversal.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { ExecResult, RuntimeCommandContext } from "../../types.js";
import {
  computeChanges,
  formatContext,
  formatNormal,
  formatUnified,
  splitLines,
} from "./format.js";

export interface DiffOptions {
  recursive: boolean;
  newFile: boolean;
  brief: boolean;
  reportSame: boolean;
  ignoreCase: boolean;
  style: "normal" | "unified" | "context";
  context: number;
  labels: string[];
  optionWords: string[];
}
interface Pair {
  left: string;
  right: string;
  depth: number;
  operandAdjusted?: boolean;
  leave?: boolean;
  identities?: string[];
}

/** Pairwise DFS keeps directory admission, identities and per-file buffers bounded. */
export async function comparePaths(
  ctx: RuntimeCommandContext,
  left: string,
  right: string,
  options: DiffOptions,
): Promise<ExecResult> {
  const output = new BoundedStringBuilder(
    Math.min(ctx.limits.maxOutputSize, ctx.limits.maxStringLength),
    "diff",
  );
  const errors = new BoundedStringBuilder(
    ctx.limits.maxOutputSize,
    "diff diagnostics",
  );
  const budget = new FileTraversalBudget({ ...ctx, site: "diff" });
  const active = new Set<string>();
  const stack: Pair[] = [{ left, right, depth: 0 }];
  let exitCode = 0;
  const error = (name: string, reason: string): void => {
    errors.append(`diff: ${name}: ${reason}\n`);
    exitCode = 2;
  };
  async function stat(name: string): Promise<FsStat | undefined> {
    if (name === "-") return undefined;
    try {
      return await ctx.fs.stat(ctx.fs.resolvePath(ctx.cwd, name));
    } catch (failure) {
      rethrowFatalExecutionError(failure);
      if (String(failure).includes("ENOENT")) return undefined;
      throw failure;
    }
  }
  while (stack.length) {
    const pair = stack.pop();
    if (!pair) break;
    if (pair.leave) {
      for (const identity of pair.identities ?? []) active.delete(identity);
      continue;
    }
    budget.visit(pair.depth);
    let a: FsStat | undefined;
    let b: FsStat | undefined;
    try {
      a = await stat(pair.left);
    } catch (failure) {
      rethrowFatalExecutionError(failure);
      error(pair.left, "cannot access file");
      continue;
    }
    try {
      b = await stat(pair.right);
    } catch (failure) {
      rethrowFatalExecutionError(failure);
      error(pair.right, "cannot access file");
      continue;
    }
    if ((!a && pair.left !== "-") || (!b && pair.right !== "-")) {
      if (!options.newFile) {
        if (pair.depth === 0) {
          if (!a && pair.left !== "-")
            error(pair.left, "No such file or directory");
          if (!b && pair.right !== "-")
            error(pair.right, "No such file or directory");
        } else {
          const existing = a ? pair.left : pair.right;
          const slash = existing.lastIndexOf("/");
          output.append(
            `Only in ${existing.slice(0, slash)}: ${existing.slice(slash + 1)}\n`,
          );
          exitCode = Math.max(exitCode, 1);
        }
        continue;
      }
    }
    if (a?.isDirectory || b?.isDirectory) {
      if (
        pair.depth === 0 &&
        !pair.operandAdjusted &&
        a &&
        b &&
        a.isDirectory !== b.isDirectory
      ) {
        stack.push({
          left: a.isDirectory
            ? joinShown(
                pair.left,
                pair.right.slice(pair.right.lastIndexOf("/") + 1),
              )
            : pair.left,
          right: b.isDirectory
            ? joinShown(
                pair.right,
                pair.left.slice(pair.left.lastIndexOf("/") + 1),
              )
            : pair.right,
          depth: 0,
          operandAdjusted: true,
        });
        continue;
      }
      if ((a && !a.isDirectory) || (b && !b.isDirectory)) {
        output.append(
          `File ${pair.left} is a ${a?.isDirectory ? "directory" : "regular file"} while file ${pair.right} is a ${b?.isDirectory ? "directory" : "regular file"}\n`,
        );
        exitCode = Math.max(exitCode, 1);
        continue;
      }
      if (pair.depth > 0 && !options.recursive) {
        output.append(
          `Common subdirectories: ${pair.left} and ${pair.right}\n`,
        );
        continue;
      }
      const identities: string[] = [];
      const canonicalPaths: string[] = [];
      try {
        for (const [index, name, metadata] of [
          [0, pair.left, a],
          [1, pair.right, b],
        ] as const) {
          if (!metadata) continue;
          const path = ctx.fs.resolvePath(ctx.cwd, name);
          const canonical = await ctx.fs.realpath(path);
          canonicalPaths[index] = canonical;
          const identity = `${index}:${canonical}`;
          if (active.has(identity)) throw new Error("recursive directory loop");
          identities.push(identity);
        }
        if (a && b && canonicalPaths[0] === canonicalPaths[1]) continue;
        const names = new Set<string>();
        for (const [index, metadata] of [
          [0, a],
          [1, b],
        ] as const) {
          if (!metadata) continue;
          const children = await ctx.fs.readdir(canonicalPaths[index]);
          budget.discover(children.length);
          for (const child of children) names.add(child);
        }
        for (const identity of identities) active.add(identity);
        stack.push({ ...pair, leave: true, identities });
        const sorted = [...names].sort();
        for (let i = sorted.length - 1; i >= 0; i--)
          stack.push({
            left: joinShown(pair.left, sorted[i]),
            right: joinShown(pair.right, sorted[i]),
            depth: pair.depth + 1,
          });
      } catch (failure) {
        rethrowFatalExecutionError(failure);
        error(
          `${pair.left}, ${pair.right}`,
          "cannot compare directories (unreadable or recursive loop)",
        );
      }
      continue;
    }
    const leases: ResourceLease[] = [];
    try {
      const read = async (
        name: string,
        metadata: FsStat | undefined,
      ): Promise<string> => {
        if (name === "-") return decodeBytesToUtf8(ctx.stdin);
        if (!metadata) return "";
        if (metadata.size > ctx.limits.maxInputBytes)
          throw new ExecutionLimitError(
            "diff: input size limit exceeded",
            "string_length",
          );
        const lease = ctx.executionScope?.reserveBytes(
          "diff-file",
          metadata.size * 8,
        );
        if (lease) leases.push(lease);
        const content = await readBytesFrom(
          ctx.fs,
          ctx.fs.resolvePath(ctx.cwd, name),
        );
        const size = latin1FromBytes(content).length;
        if (size > metadata.size || size > ctx.limits.maxInputBytes)
          throw new ExecutionLimitError(
            "diff: input grew while reading",
            "string_length",
          );
        ctx.executionScope?.consumeInput(size, "diff");
        return decodeBytesToUtf8(content, ctx.limits.maxInputBytes);
      };
      const oldText = await read(pair.left, a);
      const newText = await read(pair.right, b);
      const equal = options.ignoreCase
        ? oldText.toLowerCase() === newText.toLowerCase()
        : oldText === newText;
      if (equal) {
        if (options.reportSame)
          output.append(
            `Files ${options.labels[0] ?? pair.left} and ${options.labels[1] ?? pair.right} are identical\n`,
          );
        continue;
      }
      exitCode = Math.max(exitCode, 1);
      if (options.brief) {
        output.append(
          `Files ${options.labels[0] ?? pair.left} and ${options.labels[1] ?? pair.right} differ\n`,
        );
        continue;
      }
      if (pair.depth > 0)
        output.append(
          `diff ${options.optionWords.length ? `${options.optionWords.join(" ")} ` : ""}${pair.left} ${pair.right}\n`,
        );
      if (oldText.includes("\0") || newText.includes("\0")) {
        output.append(`Binary files ${pair.left} and ${pair.right} differ\n`);
        continue;
      }
      // Count before split/tokenization. The library's edit cutoff bounds its
      // diagonal search; the token count bounds the work within every diagonal.
      let count = 2;
      for (const text of [oldText, newText])
        for (let i = 0; i < text.length; i++) if (text[i] === "\n") count++;
      if (count > ctx.limits.maxArrayElements)
        throw new ExecutionLimitError(
          "diff: line array limit exceeded",
          "array_elements",
        );
      const maxEdits = Math.min(
        count,
        Math.floor(ctx.limits.maxTraversalWork / count) - 1,
      );
      if (maxEdits < 1)
        throw new ExecutionLimitError(
          "diff: comparison work limit exceeded",
          "iterations",
        );
      const oldFile = splitLines(oldText);
      const newFile = splitLines(newText);
      const changes = computeChanges(
        oldFile,
        newFile,
        options.ignoreCase,
        maxEdits,
      );
      ctx.executionScope?.consumeWork(
        count *
          (1 +
            changes.reduce(
              (sum, change) => sum + change.oldCount + change.newCount,
              0,
            )),
        "diff comparison",
      );
      const f1 = options.labels[0] ?? pair.left;
      const f2 = options.labels[1] ?? pair.right;
      output.append(
        options.style === "unified"
          ? formatUnified(
              f1,
              f2,
              oldFile,
              newFile,
              changes,
              options.context,
              options.labels,
            )
          : options.style === "context"
            ? formatContext(
                f1,
                f2,
                oldFile,
                newFile,
                changes,
                options.context,
                options.labels,
              )
            : formatNormal(oldFile, newFile, changes),
      );
    } catch (failure) {
      rethrowFatalExecutionError(failure);
      error(`${pair.left}, ${pair.right}`, "cannot read file");
    } finally {
      for (const lease of leases) lease.release();
    }
  }
  return { stdout: output.build(), stderr: errors.build(), exitCode };
}
function joinShown(parent: string, child: string): string {
  return parent.endsWith("/") ? `${parent}${child}` : `${parent}/${child}`;
}
