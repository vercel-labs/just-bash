/**
 * Shared utilities for xan subcommands
 */

import type { AstNode } from "../query-engine/parser.js";
import { parseMoonblade } from "./moonblade-parser.js";
import { moonbladeToJq } from "./moonblade-to-jq.js";

/**
 * Parse a moonblade expression and transform to jq AST
 */
export function parseMoonbladeExpr(expr: string): AstNode {
  const moonbladeAst = parseMoonblade(expr);
  return moonbladeToJq(moonbladeAst);
}

/**
 * Convert a glob pattern to a regular expression
 * Only supports * as wildcard
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${regexStr}$`);
}

/**
 * Parse column specification which can include:
 * - Column names (e.g., "name,email")
 * - Column indices (e.g., "0,2")
 * - Numeric ranges (e.g., "0-2" means columns 0, 1, 2)
 * - Column name ranges (e.g., "name:email" means columns from name to email)
 * - Glob patterns (e.g., "vec_*", "*_count")
 * - Negation (e.g., "!name" excludes column)
 * Returns an array of column names
 */
export function parseColumnSpec(spec: string, headers: string[]): string[] {
  const result: string[] = [];
  const excludes = new Set<string>();

  for (const part of spec.split(",")) {
    const trimmed = part.trim();

    // Handle negation (exclude)
    if (trimmed.startsWith("!")) {
      const toExclude = trimmed.slice(1);
      // Recursively parse what to exclude
      const excluded = parseColumnSpec(toExclude, headers);
      for (const col of excluded) {
        excludes.add(col);
      }
      continue;
    }

    // Check if it's * (select all)
    if (trimmed === "*") {
      for (const h of headers) {
        if (!result.includes(h)) result.push(h);
      }
      continue;
    }

    // Check if it's a glob pattern (contains * but not just *)
    if (trimmed.includes("*")) {
      const regex = globToRegex(trimmed);
      for (const h of headers) {
        if (regex.test(h) && !result.includes(h)) {
          result.push(h);
        }
      }
      continue;
    }

    // Check if it's a column name range (e.g., "name:email", ":email", "name:")
    const colRangeMatch = trimmed.match(/^([^:]*):([^:]*)$/);
    if (colRangeMatch && (colRangeMatch[1] || colRangeMatch[2])) {
      const startCol = colRangeMatch[1];
      const endCol = colRangeMatch[2];
      const startIdx = startCol ? headers.indexOf(startCol) : 0;
      const endIdx = endCol ? headers.indexOf(endCol) : headers.length - 1;

      if (startIdx !== -1 && endIdx !== -1) {
        const step = startIdx <= endIdx ? 1 : -1;
        for (
          let i = startIdx;
          step > 0 ? i <= endIdx : i >= endIdx;
          i += step
        ) {
          if (!result.includes(headers[i])) {
            result.push(headers[i]);
          }
        }
      }
      continue;
    }

    // Check if it's a numeric range (e.g., "0-2")
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end && i < headers.length; i++) {
        result.push(headers[i]);
      }
      continue;
    }

    // Check if it's an index
    const idx = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(idx) && idx >= 0 && idx < headers.length) {
      result.push(headers[idx]);
      continue;
    }

    // Otherwise treat as column name
    if (headers.includes(trimmed)) {
      result.push(trimmed);
    }
  }

  // Remove excluded columns
  if (excludes.size > 0) {
    return result.filter((col) => !excludes.has(col));
  }

  return result;
}
