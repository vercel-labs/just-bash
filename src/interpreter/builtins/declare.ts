/**
 * declare/typeset - Declare variables and give them attributes
 *
 * Usage:
 *   declare              - List all variables
 *   declare -p           - List all variables (same as no args)
 *   declare NAME=value   - Declare variable with value
 *   declare -a NAME      - Declare indexed array
 *   declare -A NAME      - Declare associative array
 *   declare -r NAME      - Declare readonly variable
 *   declare -x NAME      - Export variable
 *
 * Also aliased as 'typeset'
 */

import { parseArithmeticExpression } from "../../parser/arithmetic-parser.js";
import { Parser } from "../../parser/parser.js";
import type { ExecResult } from "../../types.js";
import { evaluateArithmeticSync } from "../arithmetic.js";
import { getArrayIndices, getAssocArrayKeys } from "../helpers/array.js";
import {
  isNameref,
  markNameref,
  resolveNameref,
  unmarkNameref,
} from "../helpers/nameref.js";
import {
  checkReadonlyError,
  markExported,
  markReadonly,
} from "../helpers/readonly.js";
import { OK, result, success } from "../helpers/result.js";
import { expandTildesInValue } from "../helpers/tilde.js";
import type { InterpreterContext } from "../types.js";
import { parseAssignment, setVariable } from "./variable-helpers.js";

/**
 * Mark a variable as having the integer attribute.
 */
function markInteger(ctx: InterpreterContext, name: string): void {
  ctx.state.integerVars ??= new Set();
  ctx.state.integerVars.add(name);
}

/**
 * Check if a variable has the integer attribute.
 */
export function isInteger(ctx: InterpreterContext, name: string): boolean {
  return ctx.state.integerVars?.has(name) ?? false;
}

/**
 * Mark a variable as having the lowercase attribute.
 */
function markLowercase(ctx: InterpreterContext, name: string): void {
  ctx.state.lowercaseVars ??= new Set();
  ctx.state.lowercaseVars.add(name);
  // -l and -u are mutually exclusive; -l clears -u
  ctx.state.uppercaseVars?.delete(name);
}

/**
 * Check if a variable has the lowercase attribute.
 */
export function isLowercase(ctx: InterpreterContext, name: string): boolean {
  return ctx.state.lowercaseVars?.has(name) ?? false;
}

/**
 * Mark a variable as having the uppercase attribute.
 */
function markUppercase(ctx: InterpreterContext, name: string): void {
  ctx.state.uppercaseVars ??= new Set();
  ctx.state.uppercaseVars.add(name);
  // -l and -u are mutually exclusive; -u clears -l
  ctx.state.lowercaseVars?.delete(name);
}

/**
 * Check if a variable has the uppercase attribute.
 */
export function isUppercase(ctx: InterpreterContext, name: string): boolean {
  return ctx.state.uppercaseVars?.has(name) ?? false;
}

/**
 * Apply case transformation based on variable attributes.
 * Returns the transformed value.
 */
export function applyCaseTransform(
  ctx: InterpreterContext,
  name: string,
  value: string,
): string {
  if (isLowercase(ctx, name)) {
    return value.toLowerCase();
  }
  if (isUppercase(ctx, name)) {
    return value.toUpperCase();
  }
  return value;
}

/**
 * Evaluate a value as arithmetic if the variable has integer attribute.
 * Returns the evaluated string value.
 */
function evaluateIntegerValue(ctx: InterpreterContext, value: string): string {
  try {
    const parser = new Parser();
    const arithAst = parseArithmeticExpression(parser, value);
    const result = evaluateArithmeticSync(ctx, arithAst.expression);
    return String(result);
  } catch {
    // If parsing fails, return 0 (bash behavior for invalid expressions)
    return "0";
  }
}

export function handleDeclare(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  // Parse flags
  let declareArray = false;
  let declareAssoc = false;
  let declareReadonly = false;
  let declareExport = false;
  let printMode = false;
  let declareNameref = false;
  let removeNameref = false;
  let declareInteger = false;
  let declareLowercase = false;
  let declareUppercase = false;
  let functionMode = false; // -f flag: function definitions
  let functionNamesOnly = false; // -F flag: function names only
  const processedArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-a") {
      declareArray = true;
    } else if (arg === "-A") {
      declareAssoc = true;
    } else if (arg === "-r") {
      declareReadonly = true;
    } else if (arg === "-x") {
      declareExport = true;
    } else if (arg === "-p") {
      printMode = true;
    } else if (arg === "-n") {
      declareNameref = true;
    } else if (arg === "+n") {
      removeNameref = true;
    } else if (arg === "--") {
      // End of options, rest are arguments
      processedArgs.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith("+")) {
      // Handle +n (remove nameref)
      for (const flag of arg.slice(1)) {
        if (flag === "n") removeNameref = true;
      }
    } else if (arg === "-i") {
      declareInteger = true;
    } else if (arg === "-l") {
      declareLowercase = true;
    } else if (arg === "-u") {
      declareUppercase = true;
    } else if (arg === "-f") {
      functionMode = true;
    } else if (arg === "-F") {
      functionNamesOnly = true;
    } else if (arg.startsWith("-")) {
      // Handle combined flags like -ar
      for (const flag of arg.slice(1)) {
        if (flag === "a") declareArray = true;
        else if (flag === "A") declareAssoc = true;
        else if (flag === "r") declareReadonly = true;
        else if (flag === "x") declareExport = true;
        else if (flag === "p") printMode = true;
        else if (flag === "n") declareNameref = true;
        else if (flag === "i") declareInteger = true;
        else if (flag === "l") declareLowercase = true;
        else if (flag === "u") declareUppercase = true;
        else if (flag === "f") functionMode = true;
        else if (flag === "F") functionNamesOnly = true;
      }
    } else {
      processedArgs.push(arg);
    }
  }

  // Handle declare -F (function names only)
  if (functionNamesOnly) {
    if (processedArgs.length === 0) {
      // List all function names in sorted order
      const funcNames = Array.from(ctx.state.functions.keys()).sort();
      let stdout = "";
      for (const name of funcNames) {
        stdout += `declare -f ${name}\n`;
      }
      return success(stdout);
    }
    // With args, check if functions exist (similar to -f)
    let allExist = true;
    for (const name of processedArgs) {
      if (!ctx.state.functions.has(name)) {
        allExist = false;
      }
    }
    return result("", "", allExist ? 0 : 1);
  }

  // Handle declare -f (function definitions)
  if (functionMode) {
    if (processedArgs.length === 0) {
      // List all function definitions - we don't store source, so just list names
      let stdout = "";
      const funcNames = Array.from(ctx.state.functions.keys()).sort();
      for (const name of funcNames) {
        // Without source tracking, we can't print the full definition
        // Just print the function name declaration
        stdout += `${name} ()\n{\n    # function body\n}\n`;
      }
      return success(stdout);
    }
    // Check if all specified functions exist (exit code is the main use case)
    let allExist = true;
    for (const name of processedArgs) {
      if (!ctx.state.functions.has(name)) {
        allExist = false;
      }
    }
    return result("", "", allExist ? 0 : 1);
  }

  // Print mode with specific variable names: declare -p varname
  if (printMode && processedArgs.length > 0) {
    let stdout = "";
    let anyNotFound = false;
    for (const name of processedArgs) {
      // Check if this is an associative array
      const isAssoc = ctx.state.associativeArrays?.has(name);
      if (isAssoc) {
        const keys = getAssocArrayKeys(ctx, name);
        if (keys.length === 0) {
          stdout += `declare -A ${name}=()\n`;
        } else {
          const elements = keys.map((key) => {
            const value = ctx.state.env[`${name}_${key}`] ?? "";
            const escapedValue = value
              .replace(/\\/g, "\\\\")
              .replace(/"/g, '\\"');
            return `['${key}']="${escapedValue}"`;
          });
          stdout += `declare -A ${name}=(${elements.join(" ")})\n`;
        }
        continue;
      }

      // Check if this is an indexed array (has array elements)
      const arrayIndices = getArrayIndices(ctx, name);
      if (arrayIndices.length > 0) {
        const elements = arrayIndices.map((index) => {
          const value = ctx.state.env[`${name}_${index}`] ?? "";
          const escapedValue = value
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
          return `[${index}]="${escapedValue}"`;
        });
        stdout += `declare -a ${name}=(${elements.join(" ")})\n`;
        continue;
      }

      // Check if this is an empty array (has __length marker but no elements)
      if (ctx.state.env[`${name}__length`] !== undefined) {
        stdout += `declare -a ${name}=()\n`;
        continue;
      }

      // Regular scalar variable
      const value = ctx.state.env[name];
      if (value !== undefined) {
        // Use double quotes and escape properly for bash compatibility
        const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        stdout += `declare -- ${name}="${escapedValue}"\n`;
      } else {
        // Variable not found - set flag for exit code 1
        anyNotFound = true;
      }
    }
    return result(stdout, "", anyNotFound ? 1 : 0);
  }

  // No args: list all variables
  if (processedArgs.length === 0 && !printMode) {
    let stdout = "";
    const entries = Object.entries(ctx.state.env)
      .filter(([key]) => !key.startsWith("BASH_"))
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [name, value] of entries) {
      const escapedValue = value.replace(/'/g, "'\\''");
      stdout += `declare -- ${name}='${escapedValue}'\n`;
    }
    return success(stdout);
  }

  // Process each argument
  for (const arg of processedArgs) {
    // Check for array assignment: name=(...)
    const arrayMatch = arg.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=\((.*)\)$/s);
    if (arrayMatch) {
      const name = arrayMatch[1];
      const content = arrayMatch[2];

      // Track associative array declaration
      if (declareAssoc) {
        ctx.state.associativeArrays ??= new Set();
        ctx.state.associativeArrays.add(name);
      }

      // Check if this is associative array literal syntax: (['key']=value ...)
      if (declareAssoc && content.includes("[")) {
        const entries = parseAssocArrayLiteral(content);
        for (const [key, rawValue] of entries) {
          // Apply tilde expansion to the value
          const value = expandTildesInValue(ctx, rawValue);
          ctx.state.env[`${name}_${key}`] = value;
        }
      } else {
        // Parse as indexed array elements
        const elements = parseArrayElements(content);
        for (let i = 0; i < elements.length; i++) {
          ctx.state.env[`${name}_${i}`] = elements[i];
        }
        // Store array length marker
        ctx.state.env[`${name}__length`] = String(elements.length);
      }

      if (declareReadonly) {
        markReadonly(ctx, name);
      }
      if (declareExport) {
        markExported(ctx, name);
      }
      continue;
    }

    // Handle nameref removal (+n)
    if (removeNameref) {
      const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
      unmarkNameref(ctx, name);
      // After removing nameref, the value stays as-is (it's now a regular variable)
      if (!arg.includes("=")) {
        continue;
      }
    }

    // Check for array index assignment: name[index]=value
    const indexMatch = arg.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\[([^\]]+)\]=(.*)$/s,
    );
    if (indexMatch) {
      const name = indexMatch[1];
      const indexExpr = indexMatch[2];
      const value = indexMatch[3];

      // Check if variable is readonly
      const error = checkReadonlyError(ctx, name);
      if (error) return error;

      // Evaluate the index (can be arithmetic expression)
      let index: number;
      try {
        const parser = new Parser();
        const arithAst = parseArithmeticExpression(parser, indexExpr);
        index = evaluateArithmeticSync(ctx, arithAst.expression);
      } catch {
        // If parsing fails, try to parse as simple number
        const num = parseInt(indexExpr, 10);
        index = Number.isNaN(num) ? 0 : num;
      }

      // Set the array element
      ctx.state.env[`${name}_${index}`] = value;

      // Update array length if needed
      const currentLength = parseInt(
        ctx.state.env[`${name}__length`] ?? "0",
        10,
      );
      if (index >= currentLength) {
        ctx.state.env[`${name}__length`] = String(index + 1);
      }

      if (declareReadonly) {
        markReadonly(ctx, name);
      }
      if (declareExport) {
        markExported(ctx, name);
      }
      continue;
    }

    // Check for scalar assignment: name=value
    if (arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      const name = arg.slice(0, eqIdx);
      let value = arg.slice(eqIdx + 1);

      // Check if variable is readonly
      const error = checkReadonlyError(ctx, name);
      if (error) return error;

      // For namerefs being declared with a value, store the target name
      // (don't follow the reference, just store what variable it points to)
      if (declareNameref) {
        ctx.state.env[name] = value;
        markNameref(ctx, name);
        if (declareReadonly) {
          markReadonly(ctx, name);
        }
        if (declareExport) {
          markExported(ctx, name);
        }
        continue;
      }

      // Mark as integer if -i flag was used
      if (declareInteger) {
        markInteger(ctx, name);
      }

      // Mark as lowercase if -l flag was used
      if (declareLowercase) {
        markLowercase(ctx, name);
      }

      // Mark as uppercase if -u flag was used
      if (declareUppercase) {
        markUppercase(ctx, name);
      }

      // If variable has integer attribute (either just declared or previously), evaluate as arithmetic
      if (isInteger(ctx, name)) {
        value = evaluateIntegerValue(ctx, value);
      }

      // Apply case transformation based on variable attributes
      value = applyCaseTransform(ctx, name, value);

      // If this is an existing nameref (not being declared as one), write through it
      if (isNameref(ctx, name)) {
        const resolved = resolveNameref(ctx, name);
        if (resolved && resolved !== name) {
          ctx.state.env[resolved] = value;
        } else {
          ctx.state.env[name] = value;
        }
      } else {
        ctx.state.env[name] = value;
      }
      if (declareReadonly) {
        markReadonly(ctx, name);
      }
      if (declareExport) {
        markExported(ctx, name);
      }
    } else {
      // Just declare without value
      const name = arg;

      // For declare -n without a value, just mark as nameref
      if (declareNameref) {
        markNameref(ctx, name);
        if (declareReadonly) {
          markReadonly(ctx, name);
        }
        if (declareExport) {
          markExported(ctx, name);
        }
        continue;
      }

      // Mark as integer if -i flag was used
      if (declareInteger) {
        markInteger(ctx, name);
      }

      // Mark as lowercase if -l flag was used
      if (declareLowercase) {
        markLowercase(ctx, name);
      }

      // Mark as uppercase if -u flag was used
      if (declareUppercase) {
        markUppercase(ctx, name);
      }

      // Track associative array declaration
      if (declareAssoc) {
        ctx.state.associativeArrays ??= new Set();
        ctx.state.associativeArrays.add(name);
      }

      // Check if any array elements exist (numeric or string keys)
      const hasArrayElements = Object.keys(ctx.state.env).some(
        (key) =>
          key.startsWith(`${name}_`) && !key.startsWith(`${name}__length`),
      );
      if (!(name in ctx.state.env) && !hasArrayElements) {
        // If declaring as array, initialize empty array
        if (declareArray || declareAssoc) {
          ctx.state.env[`${name}__length`] = "0";
        } else {
          ctx.state.env[name] = "";
        }
      }
      if (declareReadonly) {
        markReadonly(ctx, name);
      }
      if (declareExport) {
        markExported(ctx, name);
      }
    }
  }

  return OK;
}

/**
 * Parse array elements from content like "1 2 3" or "'a b' c d"
 */
export function parseArrayElements(content: string): string[] {
  const elements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (const char of content) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (
      (char === " " || char === "\t" || char === "\n") &&
      !inSingleQuote &&
      !inDoubleQuote
    ) {
      if (current) {
        elements.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    elements.push(current);
  }
  return elements;
}

/**
 * Parse associative array literal content like "['foo']=bar ['spam']=42"
 * Returns array of [key, value] pairs
 */
function parseAssocArrayLiteral(content: string): [string, string][] {
  const entries: [string, string][] = [];
  let pos = 0;

  while (pos < content.length) {
    // Skip whitespace
    while (pos < content.length && /\s/.test(content[pos])) {
      pos++;
    }
    if (pos >= content.length) break;

    // Expect [
    if (content[pos] !== "[") {
      // Skip non-bracket content
      pos++;
      continue;
    }
    pos++; // skip [

    // Parse key (may be quoted)
    let key = "";
    if (content[pos] === "'" || content[pos] === '"') {
      const quote = content[pos];
      pos++;
      while (pos < content.length && content[pos] !== quote) {
        key += content[pos];
        pos++;
      }
      if (content[pos] === quote) pos++;
    } else {
      while (
        pos < content.length &&
        content[pos] !== "]" &&
        content[pos] !== "="
      ) {
        key += content[pos];
        pos++;
      }
    }

    // Skip to ]
    while (pos < content.length && content[pos] !== "]") {
      pos++;
    }
    if (content[pos] === "]") pos++;

    // Expect =
    if (content[pos] !== "=") continue;
    pos++;

    // Parse value (may be quoted)
    let value = "";
    if (content[pos] === "'" || content[pos] === '"') {
      const quote = content[pos];
      pos++;
      while (pos < content.length && content[pos] !== quote) {
        if (content[pos] === "\\" && pos + 1 < content.length) {
          pos++;
          value += content[pos];
        } else {
          value += content[pos];
        }
        pos++;
      }
      if (content[pos] === quote) pos++;
    } else {
      while (pos < content.length && !/\s/.test(content[pos])) {
        value += content[pos];
        pos++;
      }
    }

    entries.push([key, value]);
  }

  return entries;
}

/**
 * readonly - Declare readonly variables
 *
 * Usage:
 *   readonly NAME=value   - Declare readonly variable
 *   readonly NAME         - Mark existing variable as readonly
 */
export function handleReadonly(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  // Parse flags
  let _declareArray = false;
  let _declareAssoc = false;
  const processedArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-a") {
      _declareArray = true;
    } else if (arg === "-A") {
      _declareAssoc = true;
    } else if (arg === "-p") {
      // Print mode - list readonly variables
      if (args.length === 1) {
        let stdout = "";
        for (const name of ctx.state.readonlyVars || []) {
          const value = ctx.state.env[name];
          if (value !== undefined) {
            stdout += `declare -r ${name}="${value}"\n`;
          }
        }
        return success(stdout);
      }
    } else if (arg === "--") {
      processedArgs.push(...args.slice(i + 1));
      break;
    } else if (!arg.startsWith("-")) {
      processedArgs.push(arg);
    }
  }

  for (const arg of processedArgs) {
    const assignment = parseAssignment(arg);

    // If no value provided, just mark as readonly
    if (assignment.value === undefined && !assignment.isArray) {
      markReadonly(ctx, assignment.name);
      continue;
    }

    // Set variable and mark as readonly
    const error = setVariable(ctx, assignment, { makeReadonly: true });
    if (error) {
      return error;
    }
  }

  return OK;
}
