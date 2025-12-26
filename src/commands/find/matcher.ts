// Matcher functions for find command

import { matchGlob } from "../../utils/glob.js";
import type { EvalContext, Expression } from "./types.js";

export function evaluateExpression(
  expr: Expression,
  ctx: EvalContext,
): boolean {
  switch (expr.type) {
    case "name":
      return matchGlob(ctx.name, expr.pattern, expr.ignoreCase);
    case "path":
      return matchGlob(ctx.relativePath, expr.pattern, expr.ignoreCase);
    case "type":
      if (expr.fileType === "f") return ctx.isFile;
      if (expr.fileType === "d") return ctx.isDirectory;
      return false;
    case "empty":
      return ctx.isEmpty;
    case "mtime": {
      // mtime is in days, comparison is relative to now
      const now = Date.now();
      const fileAgeDays = (now - ctx.mtime) / (1000 * 60 * 60 * 24);
      if (expr.comparison === "more") {
        return fileAgeDays > expr.days;
      } else if (expr.comparison === "less") {
        return fileAgeDays < expr.days;
      }
      return Math.floor(fileAgeDays) === expr.days;
    }
    case "newer": {
      const refMtime = ctx.newerRefTimes.get(expr.refPath);
      if (refMtime === undefined) return false;
      return ctx.mtime > refMtime;
    }
    case "size": {
      // Convert size to bytes based on unit
      let targetBytes = expr.value;
      switch (expr.unit) {
        case "c":
          targetBytes = expr.value;
          break; // bytes
        case "k":
          targetBytes = expr.value * 1024;
          break; // kilobytes
        case "M":
          targetBytes = expr.value * 1024 * 1024;
          break; // megabytes
        case "G":
          targetBytes = expr.value * 1024 * 1024 * 1024;
          break; // gigabytes
        case "b":
          targetBytes = expr.value * 512;
          break; // 512-byte blocks (default)
      }
      if (expr.comparison === "more") {
        return ctx.size > targetBytes;
      } else if (expr.comparison === "less") {
        return ctx.size < targetBytes;
      }
      // For exact match with blocks, round up to nearest block
      if (expr.unit === "b") {
        const fileBlocks = Math.ceil(ctx.size / 512);
        return fileBlocks === expr.value;
      }
      return ctx.size === targetBytes;
    }
    case "perm": {
      // Permission mode matching
      // exact: file mode must match exactly
      // all (-mode): all specified bits must be set
      // any (/mode): at least one specified bit must be set
      const fileMode = ctx.mode & 0o777; // Only permission bits
      const targetMode = expr.mode & 0o777;
      if (expr.matchType === "exact") {
        return fileMode === targetMode;
      } else if (expr.matchType === "all") {
        return (fileMode & targetMode) === targetMode;
      } else {
        // any
        return (fileMode & targetMode) !== 0;
      }
    }
    case "not":
      return !evaluateExpression(expr.expr, ctx);
    case "and":
      return (
        evaluateExpression(expr.left, ctx) &&
        evaluateExpression(expr.right, ctx)
      );
    case "or":
      return (
        evaluateExpression(expr.left, ctx) ||
        evaluateExpression(expr.right, ctx)
      );
  }
}

// Helper to collect and resolve -newer reference file mtimes
export function collectNewerRefs(expr: Expression | null): string[] {
  const refs: string[] = [];

  const collect = (e: Expression | null): void => {
    if (!e) return;
    if (e.type === "newer") {
      refs.push(e.refPath);
    } else if (e.type === "not") {
      collect(e.expr);
    } else if (e.type === "and" || e.type === "or") {
      collect(e.left);
      collect(e.right);
    }
  };

  collect(expr);
  return refs;
}
