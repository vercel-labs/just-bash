/**
 * Pattern Matching
 *
 * Converts shell glob patterns to regex equivalents for pattern matching
 * in parameter expansion (${var%pattern}, ${var/pattern/replacement}, etc.)
 * and case statements.
 */

/**
 * Convert a shell glob pattern to a regex string.
 * @param pattern - The glob pattern (*, ?, [...])
 * @param greedy - Whether * should be greedy (true for suffix matching, false for prefix)
 */
export function patternToRegex(pattern: string, greedy: boolean): string {
  let regex = "";
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === "\\") {
      // Shell escape: \X means literal X
      if (i + 1 < pattern.length) {
        const next = pattern[i + 1];
        // Escape for regex if it's a regex special char
        if (/[\\^$.|+(){}[\]*?]/.test(next)) {
          regex += `\\${next}`;
        } else {
          regex += next;
        }
        i += 2;
      } else {
        // Trailing backslash - treat as literal
        regex += "\\\\";
        i++;
      }
    } else if (char === "*") {
      regex += greedy ? ".*" : ".*?";
      i++;
    } else if (char === "?") {
      regex += ".";
      i++;
    } else if (char === "[") {
      // Character class - find the matching ]
      const classEnd = findCharClassEnd(pattern, i);
      if (classEnd === -1) {
        // No matching ], escape the [
        regex += "\\[";
        i++;
      } else {
        // Extract and convert the character class
        const classContent = pattern.slice(i + 1, classEnd);
        regex += convertCharClass(classContent);
        i = classEnd + 1;
      }
    } else if (/[\^$.|+(){}]/.test(char)) {
      // Escape regex special chars (but NOT [ and ] - handled above, and NOT \\ - handled above)
      regex += `\\${char}`;
      i++;
    } else {
      regex += char;
      i++;
    }
  }
  return regex;
}

/**
 * Find the end of a character class starting at position i (where pattern[i] is '[')
 */
function findCharClassEnd(pattern: string, start: number): number {
  let i = start + 1;

  // Handle negation
  if (i < pattern.length && pattern[i] === "^") {
    i++;
  }

  // A ] immediately after [ or [^ is literal, not closing
  if (i < pattern.length && pattern[i] === "]") {
    i++;
  }

  while (i < pattern.length) {
    // Handle escape sequences - \] should not end the class
    if (pattern[i] === "\\" && i + 1 < pattern.length) {
      i += 2; // Skip both the backslash and the escaped character
      continue;
    }

    if (pattern[i] === "]") {
      return i;
    }

    // Handle single quotes inside character class (bash extension)
    if (pattern[i] === "'") {
      const closeQuote = pattern.indexOf("'", i + 1);
      if (closeQuote !== -1) {
        i = closeQuote + 1;
        continue;
      }
    }

    // Handle POSIX classes [:name:]
    if (
      pattern[i] === "[" &&
      i + 1 < pattern.length &&
      pattern[i + 1] === ":"
    ) {
      const closePos = pattern.indexOf(":]", i + 2);
      if (closePos !== -1) {
        i = closePos + 2;
        continue;
      }
    }
    i++;
  }
  return -1;
}

/**
 * Convert a shell character class content to regex equivalent.
 * Input is the content inside [...], e.g., ":alpha:" for [[:alpha:]]
 */
function convertCharClass(content: string): string {
  let result = "[";
  let i = 0;

  // Handle negation
  if (content[0] === "^" || content[0] === "!") {
    result += "^";
    i++;
  }

  while (i < content.length) {
    // Handle single quotes inside character class (bash extension)
    // '...' makes its content literal, including ] and -
    if (content[i] === "'") {
      const closeQuote = content.indexOf("'", i + 1);
      if (closeQuote !== -1) {
        // Add quoted content as literal characters
        const quoted = content.slice(i + 1, closeQuote);
        for (const ch of quoted) {
          // Escape regex special chars inside character class
          if (ch === "\\") {
            result += "\\\\";
          } else if (ch === "]") {
            result += "\\]";
          } else if (ch === "^" && result === "[") {
            result += "\\^";
          } else {
            result += ch;
          }
        }
        i = closeQuote + 1;
        continue;
      }
    }

    // Handle POSIX classes like [:alpha:]
    if (
      content[i] === "[" &&
      i + 1 < content.length &&
      content[i + 1] === ":"
    ) {
      const closePos = content.indexOf(":]", i + 2);
      if (closePos !== -1) {
        const posixClass = content.slice(i + 2, closePos);
        result += posixClassToRegex(posixClass);
        i = closePos + 2;
        continue;
      }
    }

    // Handle literal characters (escape regex special chars inside class)
    const char = content[i];
    if (char === "\\") {
      // Escape sequence
      if (i + 1 < content.length) {
        result += `\\${content[i + 1]}`;
        i += 2;
      } else {
        result += "\\\\";
        i++;
      }
    } else if (char === "-" && i > 0 && i < content.length - 1) {
      // Range separator
      result += "-";
      i++;
    } else if (char === "^" && i === 0) {
      // Negation at start
      result += "^";
      i++;
    } else {
      // Regular character - some need escaping in regex char class
      if (char === "]" && i === 0) {
        result += "\\]";
      } else {
        result += char;
      }
      i++;
    }
  }

  result += "]";
  return result;
}

/**
 * Convert POSIX character class name to regex equivalent
 */
function posixClassToRegex(name: string): string {
  const posixClasses: Record<string, string> = {
    alnum: "a-zA-Z0-9",
    alpha: "a-zA-Z",
    ascii: "\\x00-\\x7F",
    blank: " \\t",
    cntrl: "\\x00-\\x1F\\x7F",
    digit: "0-9",
    graph: "!-~",
    lower: "a-z",
    print: " -~",
    punct: "!-/:-@\\[-`{-~",
    space: " \\t\\n\\r\\f\\v",
    upper: "A-Z",
    word: "a-zA-Z0-9_",
    xdigit: "0-9A-Fa-f",
  };
  return posixClasses[name] || "";
}
