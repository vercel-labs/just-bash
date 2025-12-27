import type { ParsedProgram } from "./types.js";

export function parseAwkProgram(program: string): ParsedProgram {
  const result: ParsedProgram = {
    begin: null,
    main: [],
    end: null,
    functions: {},
  };

  let remaining = program.trim();

  // Extract user-defined functions: function name(params) { body }
  const funcRegex = /function\s+(\w+)\s*\(([^)]*)\)\s*\{/g;

  // Process functions first
  for (
    let funcMatch = funcRegex.exec(remaining);
    funcMatch !== null;
    funcMatch = funcRegex.exec(remaining)
  ) {
    const funcName = funcMatch[1];
    const paramsStr = funcMatch[2];
    const funcStart = funcMatch.index;
    const bodyStart = funcMatch.index + funcMatch[0].length - 1; // Point to {

    const bodyEnd = findMatchingBrace(remaining, bodyStart);
    if (bodyEnd !== -1) {
      const params = paramsStr
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      const body = remaining.slice(bodyStart + 1, bodyEnd).trim();

      result.functions[funcName] = { params, body };

      // Remove function from remaining
      remaining = remaining.slice(0, funcStart) + remaining.slice(bodyEnd + 1);
      remaining = remaining.trim();

      // Reset regex position
      funcRegex.lastIndex = 0;
    }
  }

  // Check for BEGIN block - handle nested braces
  // Use regex to find BEGIN followed by { (not BEGIN inside strings)
  const beginMatch = remaining.match(/\bBEGIN\s*\{/);
  if (beginMatch && beginMatch.index !== undefined) {
    const beginIdx = beginMatch.index;
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
  // Use regex to find END followed by { (not END inside strings)
  const endMatch = remaining.match(/\bEND\s*\{/);
  if (endMatch && endMatch.index !== undefined) {
    const endIdx = endMatch.index;
    const afterEnd = remaining.slice(endIdx + 3).trim();
    if (afterEnd.startsWith("{")) {
      const endBrace = findMatchingBrace(afterEnd, 0);
      if (endBrace !== -1) {
        result.end = afterEnd.slice(1, endBrace).trim();
        remaining = remaining.slice(0, endIdx).trim();
      }
    }
  }

  // Parse main rules - loop to handle multiple rules
  while (remaining) {
    remaining = remaining.trim();
    if (!remaining) break;

    let consumed = false;

    // Simple case: just { action }
    if (remaining.startsWith("{")) {
      const endBrace = findMatchingBrace(remaining, 0);
      if (endBrace !== -1) {
        result.main.push({
          pattern: null,
          action: remaining.slice(1, endBrace).trim(),
        });
        remaining = remaining.slice(endBrace + 1).trim();
        consumed = true;
      }
    }

    if (!consumed) {
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
          remaining = remaining.slice(endBrace + 1).trim();
          consumed = true;
        }
      }
    }

    if (!consumed) {
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
          remaining = remaining.slice(endBrace + 1).trim();
          consumed = true;
        }
      }
    }

    if (!consumed) {
      // Pattern range only (no action) - /start/,/end/ - default action is print
      const rangeOnly = remaining.match(/^\/([^/]*)\/\s*,\s*\/([^/]*)\//);
      if (rangeOnly) {
        result.main.push({
          pattern: null,
          range: { start: rangeOnly[1], end: rangeOnly[2] },
          action: "print",
        });
        remaining = remaining.slice(rangeOnly[0].length).trim();
        consumed = true;
      }
    }

    if (!consumed) {
      // Pattern only (no action) - /pattern/ - default action is print
      const patternOnly = remaining.match(/^\/([^/]*)\//);
      if (patternOnly) {
        result.main.push({ pattern: patternOnly[1], action: "print" });
        remaining = remaining.slice(patternOnly[0].length).trim();
        consumed = true;
      }
    }

    if (!consumed && remaining.includes("{")) {
      // Condition { action }
      const braceIdx = remaining.indexOf("{");
      const endBrace = findMatchingBrace(remaining, braceIdx);
      if (endBrace !== -1) {
        result.main.push({
          pattern: remaining.slice(0, braceIdx).trim() || null,
          action: remaining.slice(braceIdx + 1, endBrace).trim(),
        });
        remaining = remaining.slice(endBrace + 1).trim();
        consumed = true;
      }
    }

    if (!consumed) {
      // Condition only (no action) or just a print expression
      if (remaining.startsWith("print") || remaining.startsWith("printf")) {
        result.main.push({ pattern: null, action: remaining });
        remaining = "";
      } else {
        // It's a condition without action - default to print
        result.main.push({ pattern: remaining, action: "print" });
        remaining = "";
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
