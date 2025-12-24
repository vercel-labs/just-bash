import type { ExecResult } from "../types.js";
import type { InterpreterContext } from "./types.js";

/**
 * Execute case statement: case WORD in pattern) commands;; esac
 */
export async function executeCaseStatement(
  input: string,
  ctx: InterpreterContext,
): Promise<ExecResult> {
  const parsed = parseCaseStatement(input);
  if (parsed.error) {
    return { stdout: "", stderr: parsed.error, exitCode: 2 };
  }

  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  // Expand the word to match against (strip quotes first)
  let wordToExpand = parsed.word;
  // Remove surrounding quotes if present
  if (
    (wordToExpand.startsWith('"') && wordToExpand.endsWith('"')) ||
    (wordToExpand.startsWith("'") && wordToExpand.endsWith("'"))
  ) {
    wordToExpand = wordToExpand.slice(1, -1);
  }
  const word = await ctx.expandVariables(wordToExpand);

  // Try each pattern until one matches
  for (const branch of parsed.branches) {
    // Check if any pattern in this branch matches
    let matched = false;
    for (const pattern of branch.patterns) {
      if (matchCasePattern(word, pattern)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      // Execute the commands for this branch
      // Don't collapse lines if there's a here document or control structures
      let body = branch.body;
      const hasHereDoc = body.includes("<<");
      const hasControlStructure =
        /\bcase\s+\S+\s+in\b/.test(body) ||
        /\bif\s+/.test(body) ||
        /\bfor\s+\w+\s+in\b/.test(body) ||
        /\bwhile\s+/.test(body) ||
        /\buntil\s+/.test(body);
      if (!hasHereDoc && !hasControlStructure) {
        // Safe to join lines with semicolons
        body = body
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line)
          .join("; ");
      }
      const result = await ctx.exec(body);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
      break; // Only execute first matching branch
    }
  }

  // If there's code after the case statement, execute it
  if (parsed.rest) {
    const restResult = await ctx.exec(parsed.rest);
    stdout += restResult.stdout;
    stderr += restResult.stderr;
    exitCode = restResult.exitCode;
  }

  return { stdout, stderr, exitCode };
}

/**
 * Parse case statement into structured form
 * Format: case WORD in [pattern [| pattern]...) commands ;;]... esac
 */
export function parseCaseStatement(input: string): {
  word: string;
  branches: { patterns: string[]; body: string }[];
  rest?: string;
  error?: string;
} {
  const branches: { patterns: string[]; body: string }[] = [];

  let rest = input.trim();

  // Must start with 'case '
  if (!rest.startsWith("case ")) {
    return {
      word: "",
      branches: [],
      error: "bash: syntax error near unexpected token\n",
    };
  }
  rest = rest.slice(5).trim();

  // Find 'in' keyword
  const inMatch = rest.match(/^(.+?)\s+in\s*/);
  if (!inMatch) {
    return {
      word: "",
      branches: [],
      error: "bash: syntax error: expected 'in'\n",
    };
  }
  const word = inMatch[1].trim();
  rest = rest.slice(inMatch[0].length);

  // Parse branches until 'esac'
  let depth = 1;
  let pos = 0;

  let esacEndPos = -1;
  while (pos < rest.length && depth > 0) {
    // Skip whitespace and newlines
    while (pos < rest.length && /[\s\n]/.test(rest[pos])) pos++;

    if (pos >= rest.length) break;

    // Check for esac
    if (rest.slice(pos).match(/^esac(\s|;|$)/)) {
      depth--;
      esacEndPos = pos + 4; // Position after 'esac'
      break;
    }

    // Check for nested case
    if (rest.slice(pos).match(/^case\s/)) {
      depth++;
    }

    // Parse pattern(s) - can be multiple patterns separated by |
    const patterns: string[] = [];
    let patternStart = pos;
    let inPattern = true;
    let parenDepth = 0;

    while (inPattern && pos < rest.length) {
      const char = rest[pos];

      if (char === "(") {
        // Optional opening paren before pattern - skip it
        if (patterns.length === 0 && pos === patternStart) {
          pos++;
          patternStart = pos;
          continue;
        }
        parenDepth++;
        pos++;
      } else if (char === ")") {
        if (parenDepth > 0) {
          parenDepth--;
          pos++;
        } else {
          // End of patterns
          const pattern = rest.slice(patternStart, pos).trim();
          if (pattern) patterns.push(pattern);
          pos++; // skip )
          inPattern = false;
        }
      } else if (char === "|" && parenDepth === 0) {
        // Pattern separator
        const pattern = rest.slice(patternStart, pos).trim();
        if (pattern) patterns.push(pattern);
        pos++;
        patternStart = pos;
      } else {
        pos++;
      }
    }

    if (patterns.length === 0) {
      return {
        word,
        branches,
        error: "bash: syntax error: expected pattern\n",
      };
    }

    // Skip whitespace
    while (pos < rest.length && /[\s\n]/.test(rest[pos])) pos++;

    // Parse body until ;; or esac
    const bodyStart = pos;
    let caseDepth = 0;

    while (pos < rest.length) {
      // Helper: check if position is at logical start of line (after newline+whitespace or semicolon)
      const isAtLineStart = (() => {
        if (pos === 0) return true;
        let i = pos - 1;
        // Skip back over whitespace
        while (i >= 0 && (rest[i] === " " || rest[i] === "\t")) i--;
        return i < 0 || rest[i] === "\n" || rest[i] === ";";
      })();

      // Check for nested case - must be at start of line (case WORD in)
      if (isAtLineStart && rest.slice(pos).match(/^case\s+\S+\s+in(\s|$)/)) {
        caseDepth++;
        pos += 4;
        continue;
      }
      // Check for esac - must be at start of line
      if (isAtLineStart && rest.slice(pos).match(/^esac(\s|;|$)/)) {
        if (caseDepth > 0) {
          caseDepth--;
          pos += 4;
          continue;
        }
        // End of body without ;; (last branch)
        const body = rest.slice(bodyStart, pos).trim();
        branches.push({ patterns, body });
        esacEndPos = pos + 4; // Position after 'esac'
        break;
      }
      // Check for ;;
      if (rest.slice(pos, pos + 2) === ";;" && caseDepth === 0) {
        const body = rest.slice(bodyStart, pos).trim();
        branches.push({ patterns, body });
        pos += 2;
        break;
      }
      pos++;
    }
  }

  // Get remaining content after esac
  let remaining: string | undefined;
  if (esacEndPos !== -1 && esacEndPos < rest.length) {
    remaining = rest.slice(esacEndPos).trim();
    if (!remaining) remaining = undefined;
  }

  return { word, branches, rest: remaining };
}

/**
 * Match a word against a case pattern (supports glob patterns)
 */
export function matchCasePattern(word: string, pattern: string): boolean {
  // Handle * wildcard (matches anything)
  if (pattern === "*") return true;

  // Convert glob pattern to regex
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      regex += ".*";
    } else if (char === "?") {
      regex += ".";
    } else if (char === "[") {
      // Character class
      const closeIdx = pattern.indexOf("]", i);
      if (closeIdx !== -1) {
        regex += pattern.slice(i, closeIdx + 1);
        i = closeIdx;
      } else {
        regex += "\\[";
      }
    } else if (/[.+^${}()|\\]/.test(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  regex += "$";

  try {
    return new RegExp(regex).test(word);
  } catch {
    // If regex fails, fall back to exact match
    return word === pattern;
  }
}
