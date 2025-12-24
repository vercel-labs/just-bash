import type { ParsedProgram } from "./types.js";

export function parseAwkProgram(program: string): ParsedProgram {
  const result: ParsedProgram = { begin: null, main: [], end: null };

  let remaining = program.trim();

  // Check for BEGIN block - handle nested braces
  const beginIdx = remaining.indexOf("BEGIN");
  if (beginIdx !== -1) {
    const afterBegin = remaining.slice(beginIdx + 5).trim();
    if (afterBegin.startsWith("{")) {
      const endBrace = findMatchingBrace(afterBegin, 0);
      if (endBrace !== -1) {
        result.begin = afterBegin.slice(1, endBrace).trim();
        remaining =
          remaining.slice(0, beginIdx) + afterBegin.slice(endBrace + 1);
        remaining = remaining.trim();
      }
    }
  }

  // Check for END block - handle nested braces
  const endIdx = remaining.lastIndexOf("END");
  if (endIdx !== -1) {
    const afterEnd = remaining.slice(endIdx + 3).trim();
    if (afterEnd.startsWith("{")) {
      const endBrace = findMatchingBrace(afterEnd, 0);
      if (endBrace !== -1) {
        result.end = afterEnd.slice(1, endBrace).trim();
        remaining = remaining.slice(0, endIdx).trim();
      }
    }
  }

  if (remaining) {
    // Parse main rules
    // Common patterns: { action }, /pattern/ { action }, condition { action }

    // Simple case: just { action }
    if (remaining.startsWith("{")) {
      const endBrace = findMatchingBrace(remaining, 0);
      if (endBrace !== -1) {
        result.main.push({
          pattern: null,
          action: remaining.slice(1, endBrace).trim(),
        });
      }
    } else {
      // Pattern range { action }: /start/,/end/ { action }
      const rangeAction = remaining.match(
        /^\/([^/]*)\/\s*,\s*\/([^/]*)\/\s*\{/,
      );
      if (rangeAction) {
        const actionStart = remaining.indexOf("{");
        const endBrace = findMatchingBrace(remaining, actionStart);
        if (endBrace !== -1) {
          result.main.push({
            pattern: null,
            range: { start: rangeAction[1], end: rangeAction[2] },
            action: remaining.slice(actionStart + 1, endBrace).trim(),
          });
        }
      } else {
        // Pattern { action }
        const patternAction = remaining.match(/^\/([^/]*)\/\s*\{/);
        if (patternAction) {
          const actionStart = remaining.indexOf("{");
          const endBrace = findMatchingBrace(remaining, actionStart);
          if (endBrace !== -1) {
            result.main.push({
              pattern: patternAction[1],
              action: remaining.slice(actionStart + 1, endBrace).trim(),
            });
          }
        } else {
          // Pattern range only (no action) - /start/,/end/ - default action is print
          const rangeOnly = remaining.match(/^\/([^/]*)\/\s*,\s*\/([^/]*)\/$/);
          if (rangeOnly) {
            result.main.push({
              pattern: null,
              range: { start: rangeOnly[1], end: rangeOnly[2] },
              action: "print",
            });
          } else {
            // Pattern only (no action) - /pattern/ - default action is print
            const patternOnly = remaining.match(/^\/([^/]*)\/$/);
            if (patternOnly) {
              result.main.push({ pattern: patternOnly[1], action: "print" });
            } else if (remaining.includes("{")) {
              // Condition { action }
              const braceIdx = remaining.indexOf("{");
              const endBrace = findMatchingBrace(remaining, braceIdx);
              if (endBrace !== -1) {
                result.main.push({
                  pattern: remaining.slice(0, braceIdx).trim(),
                  action: remaining.slice(braceIdx + 1, endBrace).trim(),
                });
              }
            } else {
              // Condition only (no action) or just a print expression
              if (
                remaining.startsWith("print") ||
                remaining.startsWith("printf")
              ) {
                result.main.push({ pattern: null, action: remaining });
              } else {
                // It's a condition without action - default to print
                result.main.push({ pattern: remaining, action: "print" });
              }
            }
          }
        }
      }
    }
  }

  // Default action is print if no action specified
  if (result.main.length === 0 && !result.begin && !result.end) {
    result.main.push({ pattern: null, action: "print" });
  }

  return result;
}

export function findMatchingBrace(str: string, start: number): number {
  if (str[start] !== "{") return -1;
  let depth = 1;
  let inString = false;
  let stringChar = "";

  for (let i = start + 1; i < str.length; i++) {
    const ch = str[i];
    const prev = str[i - 1];

    if (inString) {
      if (ch === stringChar && prev !== "\\") {
        inString = false;
      }
    } else {
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}
