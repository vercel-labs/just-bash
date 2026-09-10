/**
 * Arithmetic Text Expansion
 *
 * Functions for expanding variables within arithmetic expression text.
 * This handles the bash behavior where $(( $x * 3 )) with x='1 + 2' should
 * expand to $(( 1 + 2 * 3 )) = 7, not $(( (1+2) * 3 )) = 9.
 */

import type { InterpreterContext } from "../types.js";
import { runCommandSubstitutionText } from "./command-substitution.js";
import { getVariable } from "./variable.js";

/**
 * Expand $var patterns in arithmetic expression text for text substitution.
 * Only expands simple $var patterns, not ${...}, $(()), $(), etc.
 */
export async function expandDollarVarsInArithText(
  ctx: InterpreterContext,
  text: string,
): Promise<string> {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "$") {
      // Check for ${...} - don't expand, keep as-is for arithmetic parser
      if (text[i + 1] === "{") {
        // Find matching }
        let depth = 1;
        let j = i + 2;
        while (j < text.length && depth > 0) {
          if (text[j] === "{") depth++;
          else if (text[j] === "}") depth--;
          j++;
        }
        result += text.slice(i, j);
        i = j;
        continue;
      }
      // Check for $((, $( - don't expand
      if (text[i + 1] === "(") {
        // Find matching ) or ))
        let depth = 1;
        let j = i + 2;
        while (j < text.length && depth > 0) {
          if (text[j] === "(") depth++;
          else if (text[j] === ")") depth--;
          j++;
        }
        result += text.slice(i, j);
        i = j;
        continue;
      }
      // Check for $var pattern
      if (/[a-zA-Z_]/.test(text[i + 1] || "")) {
        let j = i + 1;
        while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) {
          j++;
        }
        const varName = text.slice(i + 1, j);
        const value = await getVariable(ctx, varName);
        result += value;
        i = j;
        continue;
      }
      // Check for $1, $2, etc. (positional parameters)
      if (/[0-9]/.test(text[i + 1] || "")) {
        let j = i + 1;
        while (j < text.length && /[0-9]/.test(text[j])) {
          j++;
        }
        const varName = text.slice(i + 1, j);
        const value = await getVariable(ctx, varName);
        result += value;
        i = j;
        continue;
      }
      // Check for special vars: $*, $@, $#, $?, etc.
      if (/[*@#?\-!$]/.test(text[i + 1] || "")) {
        const varName = text[i + 1];
        const value = await getVariable(ctx, varName);
        result += value;
        i += 2;
        continue;
      }
    }
    // Backtick command substitution - don't expand. Like $(...), the command
    // runs against the live interpreter state when the arithmetic node is
    // evaluated, so splicing variable values in here would both lose quoting
    // and let variable data be re-parsed as shell syntax.
    if (text[i] === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== "`") {
        // Skip escaped characters so \` stays inside the span
        if (text[j] === "\\") j++;
        j++;
      }
      result += text.slice(i, Math.min(j + 1, text.length));
      i = j + 1;
      continue;
    }
    // Check for double quotes - expand variables inside but keep the quotes
    // (arithmetic preprocessor will strip them)
    if (text[i] === '"') {
      result += '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "$" && /[a-zA-Z_]/.test(text[i + 1] || "")) {
          // Expand $var inside quotes
          let j = i + 1;
          while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) {
            j++;
          }
          const varName = text.slice(i + 1, j);
          const value = await getVariable(ctx, varName);
          result += value;
          i = j;
        } else if (text[i] === "\\") {
          // Keep escape sequences
          result += text[i];
          i++;
          if (i < text.length) {
            result += text[i];
            i++;
          }
        } else {
          result += text[i];
          i++;
        }
      }
      if (i < text.length) {
        result += '"';
        i++;
      }
      continue;
    }
    result += text[i];
    i++;
  }
  return result;
}

/**
 * Expand variable references and command substitutions in an array subscript.
 * e.g., "${array[@]}" -> "1 2 3", "$(echo 1)" -> "1"
 * This is needed for associative array subscripts like assoc["${array[@]}"]
 * where the subscript may contain variable or array expansions.
 */
export async function expandSubscriptForAssocArray(
  ctx: InterpreterContext,
  subscript: string,
): Promise<string> {
  // Remove surrounding quotes if present
  let inner = subscript;
  const hasDoubleQuotes = subscript.startsWith('"') && subscript.endsWith('"');
  const hasSingleQuotes = subscript.startsWith("'") && subscript.endsWith("'");

  if (hasDoubleQuotes || hasSingleQuotes) {
    inner = subscript.slice(1, -1);
  }

  // For single-quoted strings, no expansion
  if (hasSingleQuotes) {
    return inner;
  }

  // Expand $(...), ${...}, and $var references in the string
  let result = "";
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === "$") {
      // Check for $(...) command substitution
      if (inner[i + 1] === "(") {
        // Find matching closing paren
        let depth = 1;
        let j = i + 2;
        while (j < inner.length && depth > 0) {
          if (inner[j] === "(" && inner[j - 1] === "$") {
            depth++;
          } else if (inner[j] === "(") {
            depth++;
          } else if (inner[j] === ")") {
            depth--;
          }
          j++;
        }
        // Extract and execute the command against the current shell state
        const cmdStr = inner.slice(i + 2, j - 1);
        result += await runCommandSubstitutionText(ctx, cmdStr);
        i = j;
      } else if (inner[i + 1] === "{") {
        // Check for ${...} - find matching }
        let depth = 1;
        let j = i + 2;
        while (j < inner.length && depth > 0) {
          if (inner[j] === "{") depth++;
          else if (inner[j] === "}") depth--;
          j++;
        }
        const varExpr = inner.slice(i + 2, j - 1);
        // Use getVariable to properly handle array expansions like array[@] and array[*]
        const value = await getVariable(ctx, varExpr);
        result += value;
        i = j;
      } else if (/[a-zA-Z_]/.test(inner[i + 1] || "")) {
        // $name - find end of name
        let j = i + 1;
        while (j < inner.length && /[a-zA-Z0-9_]/.test(inner[j])) {
          j++;
        }
        const varName = inner.slice(i + 1, j);
        // Use getVariable for consistency
        const value = await getVariable(ctx, varName);
        result += value;
        i = j;
      } else {
        result += inner[i];
        i++;
      }
    } else if (inner[i] === "`") {
      // Legacy backtick command substitution
      let j = i + 1;
      while (j < inner.length && inner[j] !== "`") {
        j++;
      }
      const cmdStr = inner.slice(i + 1, j);
      result += await runCommandSubstitutionText(ctx, cmdStr);
      i = j + 1;
    } else {
      result += inner[i];
      i++;
    }
  }
  return result;
}
