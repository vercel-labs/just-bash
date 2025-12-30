// Matcher functions for find command

import { matchGlob } from "../../utils/glob.js";
import type { EvalContext, EvalResult, Expression } from "./types.js";

/**
 * Evaluate a find expression and return both match result and prune flag.
 * The prune flag is set when -prune is evaluated and returns true.
 */
export function evaluateExpressionWithPrune(
  expr: Expression,
  ctx: EvalContext,
): EvalResult {
  switch (expr.type) {
    case "name":
      return {
        matches: matchGlob(ctx.name, expr.pattern, expr.ignoreCase),
        pruned: false,
        printed: false,
      };
    case "path":
      return {
        matches: matchGlob(ctx.relativePath, expr.pattern, expr.ignoreCase),
        pruned: false,
        printed: false,
      };
    case "regex": {
      try {
        const flags = expr.ignoreCase ? "i" : "";
        const regex = new RegExp(expr.pattern, flags);
        return {
          matches: regex.test(ctx.relativePath),
          pruned: false,
          printed: false,
        };
      } catch {
        return { matches: false, pruned: false, printed: false };
      }
    }
    case "type":
      if (expr.fileType === "f")
        return { matches: ctx.isFile, pruned: false, printed: false };
      if (expr.fileType === "d")
        return { matches: ctx.isDirectory, pruned: false, printed: false };
      return { matches: false, pruned: false, printed: false };
    case "empty":
      return { matches: ctx.isEmpty, pruned: false, printed: false };
    case "mtime": {
      const now = Date.now();
      const fileAgeDays = (now - ctx.mtime) / (1000 * 60 * 60 * 24);
      let matches: boolean;
      if (expr.comparison === "more") {
        matches = fileAgeDays > expr.days;
      } else if (expr.comparison === "less") {
        matches = fileAgeDays < expr.days;
      } else {
        matches = Math.floor(fileAgeDays) === expr.days;
      }
      return { matches, pruned: false, printed: false };
    }
    case "newer": {
      const refMtime = ctx.newerRefTimes.get(expr.refPath);
      if (refMtime === undefined)
        return { matches: false, pruned: false, printed: false };
      return { matches: ctx.mtime > refMtime, pruned: false, printed: false };
    }
    case "size": {
      let targetBytes = expr.value;
      switch (expr.unit) {
        case "c":
          targetBytes = expr.value;
          break;
        case "k":
          targetBytes = expr.value * 1024;
          break;
        case "M":
          targetBytes = expr.value * 1024 * 1024;
          break;
        case "G":
          targetBytes = expr.value * 1024 * 1024 * 1024;
          break;
        case "b":
          targetBytes = expr.value * 512;
          break;
      }
      let matches: boolean;
      if (expr.comparison === "more") {
        matches = ctx.size > targetBytes;
      } else if (expr.comparison === "less") {
        matches = ctx.size < targetBytes;
      } else if (expr.unit === "b") {
        const fileBlocks = Math.ceil(ctx.size / 512);
        matches = fileBlocks === expr.value;
      } else {
        matches = ctx.size === targetBytes;
      }
      return { matches, pruned: false, printed: false };
    }
    case "perm": {
      const fileMode = ctx.mode & 0o777;
      const targetMode = expr.mode & 0o777;
      let matches: boolean;
      if (expr.matchType === "exact") {
        matches = fileMode === targetMode;
      } else if (expr.matchType === "all") {
        matches = (fileMode & targetMode) === targetMode;
      } else {
        matches = (fileMode & targetMode) !== 0;
      }
      return { matches, pruned: false, printed: false };
    }
    case "prune":
      // -prune always returns true and sets the prune flag
      return { matches: true, pruned: true, printed: false };
    case "print":
      // -print always returns true and sets the print flag
      return { matches: true, pruned: false, printed: true };
    case "not": {
      const inner = evaluateExpressionWithPrune(expr.expr, ctx);
      return { matches: !inner.matches, pruned: inner.pruned, printed: false };
    }
    case "and": {
      const left = evaluateExpressionWithPrune(expr.left, ctx);
      if (!left.matches) {
        // Short-circuit: if left is false, prune from left is still propagated
        return { matches: false, pruned: left.pruned, printed: false };
      }
      const right = evaluateExpressionWithPrune(expr.right, ctx);
      return {
        matches: right.matches,
        pruned: left.pruned || right.pruned,
        printed: left.printed || right.printed,
      };
    }
    case "or": {
      const left = evaluateExpressionWithPrune(expr.left, ctx);
      if (left.matches) {
        // Short-circuit: return left result (including prune and printed)
        return left;
      }
      const right = evaluateExpressionWithPrune(expr.right, ctx);
      return {
        matches: right.matches,
        pruned: left.pruned || right.pruned,
        printed: right.printed, // Only use right's printed since left didn't match
      };
    }
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
