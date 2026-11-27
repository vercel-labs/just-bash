/**
 * Whether JavaScript source uses syntax only a module accepts: a static
 * `import` or `export` declaration, or `import.meta`. Node runs a `.js` file
 * or `-e` code that does as ESM, and js-exec follows it.
 *
 * Node finds out by compiling the code as a script and retrying as a module
 * on a module-syntax error. This reads tokens instead, without a parser: it
 * skips comments, string and template literals (with their `${}`
 * expressions) and regular expression literals, and looks at the code
 * between them. A dynamic `import(...)` and a property named `import` or
 * `export` (`a.export`, `{ export() {} }`) are valid in a script and do not
 * count. One pass from the start, so the cost is linear in the source's
 * length.
 *
 * Where a `/` begins a regular expression rather than a division is decided
 * from the token before it, the usual approximation; code that defeats it is
 * contrived, and the cost of a wrong answer is the mode a script runs in.
 */
export function hasModuleSyntax(source: string): boolean {
  const length = source.length;
  let index = 0;
  // The last significant token: "word" (an identifier, keyword or number),
  // "close" (`)`, `]`, or `}`), "dot", or "punct" (anything else, or none).
  let previous: "word" | "close" | "dot" | "punct" = "punct";
  let previousWord = "";
  // One entry per open `${` in a template literal: the depth of the braces
  // opened inside it, so its closing `}` resumes the template.
  const templateBraces: number[] = [];

  if (source.startsWith("#!")) {
    const end = source.indexOf("\n");
    index = end === -1 ? length : end;
  }

  const skipTemplate = (): void => {
    // `index` is just past a backtick or a closing `}` of `${`.
    while (index < length) {
      const char = source[index];
      if (char === "\\") {
        index += 2;
      } else if (char === "`") {
        index++;
        return;
      } else if (char === "$" && source[index + 1] === "{") {
        index += 2;
        templateBraces.push(0);
        return;
      } else {
        index++;
      }
    }
  };

  const nextSignificant = (from: number): number => {
    let at = from;
    while (at < length) {
      const char = source[at];
      if (/\s/u.test(char)) {
        at++;
      } else if (source.startsWith("//", at)) {
        const end = source.indexOf("\n", at);
        at = end === -1 ? length : end;
      } else if (source.startsWith("/*", at)) {
        const end = source.indexOf("*/", at + 2);
        at = end === -1 ? length : end + 2;
      } else {
        return at;
      }
    }
    return length;
  };

  while (index < length) {
    const char = source[index];
    if (/\s/u.test(char)) {
      index++;
    } else if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      index = end === -1 ? length : end;
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? length : end + 2;
    } else if (char === '"' || char === "'") {
      index++;
      while (index < length && source[index] !== char) {
        if (source[index] === "\n") break;
        index += source[index] === "\\" ? 2 : 1;
      }
      index++;
      previous = "word";
      previousWord = "";
    } else if (char === "`") {
      index++;
      skipTemplate();
      previous = "word";
      previousWord = "";
    } else if (char === "/") {
      const regexAllowed =
        previous === "punct" ||
        (previous === "word" && REGEX_PRECEDING_WORDS.has(previousWord));
      index++;
      if (regexAllowed) {
        let inClass = false;
        while (index < length && source[index] !== "\n") {
          const current = source[index];
          if (current === "\\") {
            index += 2;
            continue;
          }
          index++;
          if (current === "[") inClass = true;
          else if (current === "]") inClass = false;
          else if (current === "/" && !inClass) break;
        }
        previous = "word";
        previousWord = "";
      } else {
        previous = "punct";
      }
    } else if (/[\p{ID_Start}$_\\]/u.test(char)) {
      const start = index;
      index++;
      while (index < length && /[\p{ID_Continue}$\\]/u.test(source[index])) {
        index++;
      }
      const word = source.slice(start, index);
      if (previous !== "dot" && (word === "import" || word === "export")) {
        const next = nextSignificant(index);
        const following = source[next] ?? "";
        if (word === "import") {
          if (following === ".") {
            const after = nextSignificant(next + 1);
            if (
              /^meta(?![\p{ID_Continue}$])/u.test(
                source.slice(after, after + 5),
              )
            ) {
              return true;
            }
          } else if (/^[\p{ID_Start}$_{*"']/u.test(following)) {
            return true;
          }
        } else if (/^[\p{ID_Start}$_{*]/u.test(following)) {
          return true;
        }
      }
      previous = "word";
      previousWord = word;
    } else if (/[0-9]/u.test(char)) {
      index++;
      while (index < length && /[\w.]/u.test(source[index])) index++;
      previous = "word";
      previousWord = "";
    } else if (char === "{") {
      index++;
      if (templateBraces.length > 0)
        templateBraces[templateBraces.length - 1]++;
      previous = "punct";
    } else if (char === "}") {
      index++;
      if (templateBraces.length > 0) {
        if (templateBraces[templateBraces.length - 1] === 0) {
          templateBraces.pop();
          skipTemplate();
          previous = "word";
          previousWord = "";
          continue;
        }
        templateBraces[templateBraces.length - 1]--;
      }
      previous = "close";
    } else if (char === ")" || char === "]") {
      index++;
      previous = "close";
    } else if (char === ".") {
      index++;
      if (source.startsWith("..", index)) {
        index += 2;
        previous = "punct";
      } else {
        previous = "dot";
      }
    } else {
      index++;
      previous = "punct";
    }
  }
  return false;
}

/** Keywords after which a `/` starts a regular expression, not a division. */
const REGEX_PRECEDING_WORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);
