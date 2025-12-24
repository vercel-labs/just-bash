/**
 * Bash Word Expander
 *
 * Performs all bash expansions in the correct order:
 * 1. Brace expansion
 * 2. Tilde expansion
 * 3. Parameter and variable expansion
 * 4. Command substitution
 * 5. Arithmetic expansion
 * 6. Word splitting (IFS-based)
 * 7. Pathname expansion (globbing)
 * 8. Quote removal
 *
 * This module transforms AST WordNodes into expanded string arrays.
 */

import type {
  ArithExpr,
  ArithmeticExpansionPart,
  BraceExpansionPart,
  CommandSubstitutionPart,
  DoubleQuotedPart,
  EscapedPart,
  GlobPart,
  LiteralPart,
  ParameterExpansionPart,
  ParameterOperation,
  ProcessSubstitutionPart,
  ScriptNode,
  SingleQuotedPart,
  TildeExpansionPart,
  WordNode,
  WordPart,
} from "../ast/types.js";

/**
 * Context for expansion - provides environment, functions, etc.
 */
export interface ExpansionContext {
  /** Environment variables */
  env: Record<string, string>;
  /** Current working directory */
  cwd: string;
  /** Positional parameters ($1, $2, etc.) */
  positionalParams: string[];
  /** Last exit code ($?) */
  lastExitCode: number;
  /** Current shell PID ($$) */
  shellPid: number;
  /** Last background PID ($!) */
  lastBackgroundPid: number;
  /** Special parameter $- (shell options) */
  shellOptions: string;
  /** Execute a command substitution */
  executeCommand: (script: ScriptNode) => Promise<string>;
  /** Resolve home directory for user */
  resolveHome: (user: string | null) => string;
  /** Glob pattern matching */
  glob: (pattern: string, cwd: string) => string[];
  /** Check if a file exists */
  fileExists: (path: string) => boolean;
  /** Read a file */
  readFile: (path: string) => string;
  /** IFS (Internal Field Separator) */
  ifs: string;
  /** Shell variables (local to function) */
  localVars?: Record<string, string>;
  /** Set a variable */
  setVariable: (name: string, value: string) => void;
  /** Special arrays like BASH_REMATCH */
  arrays: Record<string, string[]>;
}

/**
 * Result of expansion - may produce multiple fields
 */
export interface ExpandedWord {
  /** The expanded string values */
  fields: string[];
  /** Whether the word was quoted (affects word splitting and globbing) */
  quoted: boolean;
}

/**
 * Expander class - performs all bash expansions
 */
export class Expander {
  private ctx: ExpansionContext;

  constructor(context: ExpansionContext) {
    this.ctx = context;
  }

  /**
   * Expand a word node to string(s)
   */
  async expand(word: WordNode): Promise<string[]> {
    // Step 1: Brace expansion (produces multiple words)
    const afterBrace = this.expandBraces(word);

    // Process each word from brace expansion
    const results: string[] = [];
    for (const w of afterBrace) {
      // Step 2-6: Expand parts
      const expanded = await this.expandParts(w.parts, false);

      // Step 7: Word splitting (only for unquoted parts)
      const split = this.wordSplit(expanded);

      // Step 8: Pathname expansion (globbing)
      for (const field of split.fields) {
        if (!split.quoted && this.hasGlobChars(field)) {
          const globbed = this.ctx.glob(field, this.ctx.cwd);
          if (globbed.length > 0) {
            results.push(...globbed);
          } else {
            // No match - keep original (or error with failglob)
            results.push(field);
          }
        } else {
          results.push(field);
        }
      }
    }

    // Step 9: Quote removal (already done during part expansion)
    return results;
  }

  /**
   * Expand a word without word splitting or globbing
   * Used for assignments, here-strings, etc.
   */
  async expandNoSplit(word: WordNode): Promise<string> {
    const result = await this.expandParts(word.parts, true);
    return result.fields.join("");
  }

  /**
   * Expand a word for pattern matching (preserves glob chars)
   */
  async expandPattern(word: WordNode): Promise<string> {
    const parts: string[] = [];
    for (const part of word.parts) {
      parts.push(await this.expandPartForPattern(part));
    }
    return parts.join("");
  }

  // ===========================================================================
  // BRACE EXPANSION
  // ===========================================================================

  private expandBraces(word: WordNode): WordNode[] {
    // Find brace expansion parts
    const braceIdx = word.parts.findIndex((p) => p.type === "BraceExpansion");
    if (braceIdx === -1) {
      return [word];
    }

    const bracePart = word.parts[braceIdx] as BraceExpansionPart;
    const prefix = word.parts.slice(0, braceIdx);
    const suffix = word.parts.slice(braceIdx + 1);

    // Generate alternatives
    const alternatives = this.generateBraceAlternatives(bracePart);

    // Combine prefix + alternative + suffix for each
    const results: WordNode[] = [];
    for (const alt of alternatives) {
      const newWord: WordNode = {
        type: "Word",
        parts: [...prefix, { type: "Literal", value: alt }, ...suffix],
      };
      // Recursively expand more braces
      results.push(...this.expandBraces(newWord));
    }

    return results;
  }

  private generateBraceAlternatives(part: BraceExpansionPart): string[] {
    const results: string[] = [];

    for (const item of part.items) {
      if (item.type === "Range") {
        // Generate range
        const { start, end, step = 1 } = item;

        if (typeof start === "number" && typeof end === "number") {
          // Numeric range
          const actualStep = start <= end ? Math.abs(step) : -Math.abs(step);
          if (start <= end) {
            for (let i = start; i <= end; i += actualStep) {
              results.push(String(i));
            }
          } else {
            for (let i = start; i >= end; i += actualStep) {
              results.push(String(i));
            }
          }
        } else if (typeof start === "string" && typeof end === "string") {
          // Character range
          const startCode = start.charCodeAt(0);
          const endCode = end.charCodeAt(0);
          if (startCode <= endCode) {
            for (let i = startCode; i <= endCode; i++) {
              results.push(String.fromCharCode(i));
            }
          } else {
            for (let i = startCode; i >= endCode; i--) {
              results.push(String.fromCharCode(i));
            }
          }
        }
      } else {
        // Word item - expand synchronously (no command substitution in braces)
        results.push(this.partToStringSync(item.word.parts));
      }
    }

    return results;
  }

  private partToStringSync(parts: WordPart[]): string {
    let result = "";
    for (const part of parts) {
      if (part.type === "Literal") {
        result += part.value;
      } else if (part.type === "SingleQuoted") {
        result += part.value;
      } else if (part.type === "DoubleQuoted") {
        result += this.partToStringSync(part.parts);
      } else if (part.type === "Escaped") {
        result += part.value;
      }
      // Other parts ignored in sync expansion
    }
    return result;
  }

  // ===========================================================================
  // PART EXPANSION
  // ===========================================================================

  private async expandParts(
    parts: WordPart[],
    preserveNull: boolean,
  ): Promise<ExpandedWord> {
    const fields: string[] = [];
    let currentField = "";
    let quoted = false;

    for (const part of parts) {
      const result = await this.expandPart(part);

      if (result.quoted) {
        quoted = true;
      }

      if (result.fields.length === 0 && preserveNull) {
        // Preserve empty field
        continue;
      }

      if (result.fields.length === 1) {
        currentField += result.fields[0];
      } else if (result.fields.length > 1) {
        // Multiple fields - first joins current, rest are separate
        currentField += result.fields[0];
        fields.push(currentField);
        for (let i = 1; i < result.fields.length - 1; i++) {
          fields.push(result.fields[i]);
        }
        currentField = result.fields[result.fields.length - 1];
      }
    }

    if (currentField || fields.length === 0) {
      fields.push(currentField);
    }

    return { fields, quoted };
  }

  private async expandPart(part: WordPart): Promise<ExpandedWord> {
    switch (part.type) {
      case "Literal":
        return this.expandLiteral(part);
      case "SingleQuoted":
        return this.expandSingleQuoted(part);
      case "DoubleQuoted":
        return this.expandDoubleQuoted(part);
      case "Escaped":
        return this.expandEscaped(part);
      case "ParameterExpansion":
        return this.expandParameter(part);
      case "CommandSubstitution":
        return this.expandCommandSubstitution(part);
      case "ArithmeticExpansion":
        return this.expandArithmetic(part);
      case "ProcessSubstitution":
        return this.expandProcessSubstitution(part);
      case "TildeExpansion":
        return this.expandTilde(part);
      case "Glob":
        return this.expandGlobPart(part);
      case "BraceExpansion":
        // Already handled in expandBraces
        return { fields: [""], quoted: false };
      default:
        return { fields: [""], quoted: false };
    }
  }

  private expandLiteral(part: LiteralPart): ExpandedWord {
    return { fields: [part.value], quoted: false };
  }

  private expandSingleQuoted(part: SingleQuotedPart): ExpandedWord {
    return { fields: [part.value], quoted: true };
  }

  private async expandDoubleQuoted(
    part: DoubleQuotedPart,
  ): Promise<ExpandedWord> {
    const result = await this.expandParts(part.parts, true);
    return { fields: result.fields, quoted: true };
  }

  private expandEscaped(part: EscapedPart): ExpandedWord {
    return { fields: [part.value], quoted: true };
  }

  // ===========================================================================
  // PARAMETER EXPANSION
  // ===========================================================================

  private async expandParameter(
    part: ParameterExpansionPart,
  ): Promise<ExpandedWord> {
    const { parameter, operation } = part;

    // Get the parameter value
    let value = this.getParameterValue(parameter);

    // Apply operation if present
    if (operation) {
      value = await this.applyParameterOperation(parameter, value, operation);
    }

    // Special handling for $@ and $* inside double quotes
    if (parameter === "@") {
      return { fields: this.ctx.positionalParams, quoted: false };
    }

    return { fields: [value], quoted: false };
  }

  private getParameterValue(parameter: string): string {
    // Special parameters
    switch (parameter) {
      case "?":
        return String(this.ctx.lastExitCode);
      case "$":
        return String(this.ctx.shellPid);
      case "!":
        return String(this.ctx.lastBackgroundPid);
      case "-":
        return this.ctx.shellOptions;
      case "#":
        return String(this.ctx.positionalParams.length);
      case "@":
        return this.ctx.positionalParams.join(" ");
      case "*":
        return this.ctx.positionalParams.join(this.ctx.ifs[0] || " ");
      case "0":
        return "bash"; // Script name
    }

    // Positional parameters
    if (/^[1-9][0-9]*$/.test(parameter)) {
      const idx = Number.parseInt(parameter, 10) - 1;
      return this.ctx.positionalParams[idx] || "";
    }

    // Array subscript: var[idx]
    const arrayMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
    if (arrayMatch) {
      const [, name, subscript] = arrayMatch;
      if (subscript === "@" || subscript === "*") {
        const arr = this.ctx.arrays[name] || [];
        return arr.join(" ");
      }
      const idx = this.evaluateArithmeticString(subscript);
      const arr = this.ctx.arrays[name] || [];
      return arr[idx] || "";
    }

    // Local variables first, then environment
    if (this.ctx.localVars && parameter in this.ctx.localVars) {
      return this.ctx.localVars[parameter];
    }
    return this.ctx.env[parameter] || "";
  }

  private async applyParameterOperation(
    parameter: string,
    value: string,
    operation: ParameterOperation,
  ): Promise<string> {
    const isUnset =
      !(parameter in this.ctx.env) &&
      !(this.ctx.localVars && parameter in this.ctx.localVars);
    const isEmpty = value === "";

    switch (operation.type) {
      case "DefaultValue": {
        const useDefault = isUnset || (operation.checkEmpty && isEmpty);
        if (useDefault) {
          return await this.expandNoSplit(operation.word);
        }
        return value;
      }

      case "AssignDefault": {
        const useDefault = isUnset || (operation.checkEmpty && isEmpty);
        if (useDefault) {
          const defaultValue = await this.expandNoSplit(operation.word);
          this.ctx.setVariable(parameter, defaultValue);
          return defaultValue;
        }
        return value;
      }

      case "ErrorIfUnset": {
        const shouldError = isUnset || (operation.checkEmpty && isEmpty);
        if (shouldError) {
          const message = operation.word
            ? await this.expandNoSplit(operation.word)
            : `${parameter}: parameter null or not set`;
          throw new Error(message);
        }
        return value;
      }

      case "UseAlternative": {
        const useAlternative = !(isUnset || (operation.checkEmpty && isEmpty));
        if (useAlternative) {
          return await this.expandNoSplit(operation.word);
        }
        return "";
      }

      case "Length":
        return String(value.length);

      case "Substring": {
        const offset = this.evaluateArithmeticNode(operation.offset);
        const length = operation.length
          ? this.evaluateArithmeticNode(operation.length)
          : undefined;

        let start = offset;
        if (start < 0) {
          start = Math.max(0, value.length + start);
        }

        if (length !== undefined) {
          if (length < 0) {
            // Negative length means end offset from end
            const end = value.length + length;
            return value.slice(start, Math.max(start, end));
          }
          return value.slice(start, start + length);
        }
        return value.slice(start);
      }

      case "PatternRemoval": {
        const pattern = await this.expandPattern(operation.pattern);
        const regex = this.patternToRegex(pattern, operation.greedy);

        if (operation.side === "prefix") {
          return value.replace(new RegExp(`^${regex}`), "");
        }
        return value.replace(new RegExp(`${regex}$`), "");
      }

      case "PatternReplacement": {
        const pattern = await this.expandPattern(operation.pattern);
        const replacement = operation.replacement
          ? await this.expandNoSplit(operation.replacement)
          : "";
        const regex = this.patternToRegex(pattern, true);

        let regexStr = regex;
        if (operation.anchor === "start") {
          regexStr = `^${regex}`;
        } else if (operation.anchor === "end") {
          regexStr = `${regex}$`;
        }

        const flags = operation.all ? "g" : "";
        return value.replace(new RegExp(regexStr, flags), replacement);
      }

      case "CaseModification": {
        const pattern = operation.pattern
          ? await this.expandPattern(operation.pattern)
          : ".";
        const regex = new RegExp(this.patternToRegex(pattern, false), "g");

        if (operation.direction === "upper") {
          if (operation.all) {
            return value.replace(regex, (c) => c.toUpperCase());
          }
          // First matching character only
          let done = false;
          return value.replace(regex, (c) => {
            if (!done) {
              done = true;
              return c.toUpperCase();
            }
            return c;
          });
        }
        // lower
        if (operation.all) {
          return value.replace(regex, (c) => c.toLowerCase());
        }
        let done = false;
        return value.replace(regex, (c) => {
          if (!done) {
            done = true;
            return c.toLowerCase();
          }
          return c;
        });
      }

      case "Indirection": {
        // value is the name of the variable to look up
        return this.getParameterValue(value);
      }

      default:
        return value;
    }
  }

  private patternToRegex(pattern: string, greedy: boolean): string {
    // Convert shell glob pattern to regex
    let regex = "";
    let i = 0;

    while (i < pattern.length) {
      const c = pattern[i];

      if (c === "*") {
        regex += greedy ? ".*" : ".*?";
      } else if (c === "?") {
        regex += ".";
      } else if (c === "[") {
        // Character class
        const closeIdx = pattern.indexOf("]", i + 1);
        if (closeIdx !== -1) {
          regex += pattern.slice(i, closeIdx + 1);
          i = closeIdx;
        } else {
          regex += "\\[";
        }
      } else if ("\\^$.|+(){}".includes(c)) {
        regex += `\\${c}`;
      } else {
        regex += c;
      }
      i++;
    }

    return regex;
  }

  // ===========================================================================
  // COMMAND SUBSTITUTION
  // ===========================================================================

  private async expandCommandSubstitution(
    part: CommandSubstitutionPart,
  ): Promise<ExpandedWord> {
    const output = await this.ctx.executeCommand(part.body);
    // Remove trailing newlines
    const trimmed = output.replace(/\n+$/, "");
    return { fields: [trimmed], quoted: false };
  }

  // ===========================================================================
  // ARITHMETIC EXPANSION
  // ===========================================================================

  private async expandArithmetic(
    part: ArithmeticExpansionPart,
  ): Promise<ExpandedWord> {
    const value = this.evaluateArithmeticNode(part.expression);
    return { fields: [String(value)], quoted: false };
  }

  private evaluateArithmeticNode(node: { expression: ArithExpr }): number {
    return this.evaluateArithExpr(node.expression);
  }

  private evaluateArithExpr(expr: ArithExpr): number {
    switch (expr.type) {
      case "ArithNumber":
        return expr.value;

      case "ArithVariable": {
        const value = this.getParameterValue(expr.name);
        return Number.parseInt(value, 10) || 0;
      }

      case "ArithBinary": {
        const left = this.evaluateArithExpr(expr.left);
        const right = this.evaluateArithExpr(expr.right);

        switch (expr.operator) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            return right !== 0 ? Math.trunc(left / right) : 0;
          case "%":
            return right !== 0 ? left % right : 0;
          case "**":
            return left ** right;
          case "<<":
            return left << right;
          case ">>":
            return left >> right;
          case "<":
            return left < right ? 1 : 0;
          case "<=":
            return left <= right ? 1 : 0;
          case ">":
            return left > right ? 1 : 0;
          case ">=":
            return left >= right ? 1 : 0;
          case "==":
            return left === right ? 1 : 0;
          case "!=":
            return left !== right ? 1 : 0;
          case "&":
            return left & right;
          case "|":
            return left | right;
          case "^":
            return left ^ right;
          case "&&":
            return left && right ? 1 : 0;
          case "||":
            return left || right ? 1 : 0;
          case ",":
            return right; // Comma operator returns right value
          default:
            return 0;
        }
      }

      case "ArithUnary": {
        const operand = this.evaluateArithExpr(expr.operand);

        switch (expr.operator) {
          case "-":
            return -operand;
          case "+":
            return +operand;
          case "!":
            return operand === 0 ? 1 : 0;
          case "~":
            return ~operand;
          case "++":
          case "--": {
            // Pre/post increment/decrement
            if (expr.operand.type === "ArithVariable") {
              const name = expr.operand.name;
              const current =
                Number.parseInt(this.getParameterValue(name), 10) || 0;
              const newValue =
                expr.operator === "++" ? current + 1 : current - 1;
              this.ctx.setVariable(name, String(newValue));
              return expr.prefix ? newValue : current;
            }
            return operand;
          }
          default:
            return operand;
        }
      }

      case "ArithTernary": {
        const condition = this.evaluateArithExpr(expr.condition);
        return condition
          ? this.evaluateArithExpr(expr.consequent)
          : this.evaluateArithExpr(expr.alternate);
      }

      case "ArithAssignment": {
        const name = expr.variable;
        const current = Number.parseInt(this.getParameterValue(name), 10) || 0;
        const value = this.evaluateArithExpr(expr.value);
        let newValue: number;

        switch (expr.operator) {
          case "=":
            newValue = value;
            break;
          case "+=":
            newValue = current + value;
            break;
          case "-=":
            newValue = current - value;
            break;
          case "*=":
            newValue = current * value;
            break;
          case "/=":
            newValue = value !== 0 ? Math.trunc(current / value) : 0;
            break;
          case "%=":
            newValue = value !== 0 ? current % value : 0;
            break;
          case "<<=":
            newValue = current << value;
            break;
          case ">>=":
            newValue = current >> value;
            break;
          case "&=":
            newValue = current & value;
            break;
          case "|=":
            newValue = current | value;
            break;
          case "^=":
            newValue = current ^ value;
            break;
          default:
            newValue = value;
        }

        this.ctx.setVariable(name, String(newValue));
        return newValue;
      }

      case "ArithGroup":
        return this.evaluateArithExpr(expr.expression);

      default:
        return 0;
    }
  }

  private evaluateArithmeticString(expr: string): number {
    // Simple arithmetic evaluation from string
    // This is a fallback for cases where we have a raw string
    const trimmed = expr.trim();

    // Try as number
    const num = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(num)) {
      return num;
    }

    // Try as variable
    const value = this.getParameterValue(trimmed);
    return Number.parseInt(value, 10) || 0;
  }

  // ===========================================================================
  // PROCESS SUBSTITUTION
  // ===========================================================================

  private async expandProcessSubstitution(
    _part: ProcessSubstitutionPart,
  ): Promise<ExpandedWord> {
    // Process substitution creates a /dev/fd/N path
    // For now, return a placeholder - actual implementation needs OS support
    return { fields: ["/dev/fd/63"], quoted: false };
  }

  // ===========================================================================
  // TILDE EXPANSION
  // ===========================================================================

  private expandTilde(part: TildeExpansionPart): ExpandedWord {
    const home = this.ctx.resolveHome(part.user);
    return { fields: [home], quoted: false };
  }

  // ===========================================================================
  // GLOB EXPANSION
  // ===========================================================================

  private expandGlobPart(part: GlobPart): ExpandedWord {
    // Keep glob pattern for later pathname expansion
    return { fields: [part.pattern], quoted: false };
  }

  private hasGlobChars(s: string): boolean {
    return /[*?[]/.test(s);
  }

  // ===========================================================================
  // WORD SPLITTING
  // ===========================================================================

  private wordSplit(expanded: ExpandedWord): ExpandedWord {
    if (expanded.quoted) {
      // No word splitting for quoted strings
      return expanded;
    }

    const ifs = this.ctx.ifs;
    if (!ifs) {
      // No splitting if IFS is empty
      return expanded;
    }

    const fields: string[] = [];

    for (const field of expanded.fields) {
      // Split on IFS characters
      const splitFields = this.splitOnIFS(field, ifs);
      fields.push(...splitFields);
    }

    return { fields, quoted: false };
  }

  private splitOnIFS(s: string, ifs: string): string[] {
    if (!s) return [];

    const ifsWhitespace = ifs.split("").filter((c) => " \t\n".includes(c));
    const ifsNonWhitespace = ifs.split("").filter((c) => !" \t\n".includes(c));

    // Build regex for splitting
    // IFS whitespace is trimmed, non-whitespace creates empty fields
    const fields: string[] = [];
    let current = "";
    let i = 0;

    // Skip leading IFS whitespace
    while (i < s.length && ifsWhitespace.includes(s[i])) {
      i++;
    }

    while (i < s.length) {
      const char = s[i];

      if (ifsWhitespace.includes(char)) {
        // IFS whitespace - end current field, skip consecutive whitespace
        if (current) {
          fields.push(current);
          current = "";
        }
        while (i < s.length && ifsWhitespace.includes(s[i])) {
          i++;
        }
      } else if (ifsNonWhitespace.includes(char)) {
        // IFS non-whitespace - end current field, creates delimiter
        fields.push(current);
        current = "";
        i++;
        // Skip following IFS whitespace
        while (i < s.length && ifsWhitespace.includes(s[i])) {
          i++;
        }
      } else {
        current += char;
        i++;
      }
    }

    // Add final field
    if (current) {
      fields.push(current);
    }

    return fields;
  }

  // ===========================================================================
  // PATTERN EXPANSION (for case patterns, [[]], etc.)
  // ===========================================================================

  private async expandPartForPattern(part: WordPart): Promise<string> {
    switch (part.type) {
      case "Literal":
        return part.value;
      case "SingleQuoted":
        // Escape special chars in single quotes for pattern
        return this.escapePatternChars(part.value);
      case "DoubleQuoted": {
        const parts: string[] = [];
        for (const p of part.parts) {
          parts.push(await this.expandPartForPattern(p));
        }
        return parts.join("");
      }
      case "Escaped":
        return this.escapePatternChars(part.value);
      case "ParameterExpansion": {
        const result = await this.expandParameter(part);
        return result.fields.join("");
      }
      case "CommandSubstitution": {
        const result = await this.expandCommandSubstitution(part);
        return result.fields.join("");
      }
      case "Glob":
        // Keep glob chars for pattern
        return part.pattern;
      default:
        return "";
    }
  }

  private escapePatternChars(s: string): string {
    return s.replace(/[*?[\]\\]/g, "\\$&");
  }
}

/**
 * Create a default expansion context
 */
export function createExpansionContext(
  env: Record<string, string>,
  options: Partial<ExpansionContext> = {},
): ExpansionContext {
  return {
    env,
    cwd: options.cwd || process.cwd(),
    positionalParams: options.positionalParams || [],
    lastExitCode: options.lastExitCode || 0,
    shellPid: options.shellPid || process.pid,
    lastBackgroundPid: options.lastBackgroundPid || 0,
    shellOptions: options.shellOptions || "",
    ifs: options.ifs ?? " \t\n",
    localVars: options.localVars,
    arrays: options.arrays || {},
    executeCommand: options.executeCommand || (async () => ""),
    resolveHome:
      options.resolveHome ||
      ((user) => {
        if (user) return `/home/${user}`;
        return env.HOME || "/";
      }),
    glob: options.glob || (() => []),
    fileExists: options.fileExists || (() => false),
    readFile: options.readFile || (() => ""),
    setVariable:
      options.setVariable ||
      ((name, value) => {
        env[name] = value;
      }),
  };
}
