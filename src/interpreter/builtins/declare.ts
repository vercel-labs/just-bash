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

import type { ExecResult } from "../../types.js";
import { checkReadonlyError, markReadonly } from "../helpers/readonly.js";
import { OK, success } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";
import { parseAssignment, setVariable } from "./variable-helpers.js";

export function handleDeclare(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  // Parse flags
  let declareArray = false;
  let declareAssoc = false;
  let declareReadonly = false;
  let _declareExport = false;
  let printMode = false;
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
      _declareExport = true;
    } else if (arg === "-p") {
      printMode = true;
    } else if (arg === "--") {
      // End of options, rest are arguments
      processedArgs.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith("-")) {
      // Handle combined flags like -ar
      for (const flag of arg.slice(1)) {
        if (flag === "a") declareArray = true;
        else if (flag === "A") declareAssoc = true;
        else if (flag === "r") declareReadonly = true;
        else if (flag === "x") _declareExport = true;
        else if (flag === "p") printMode = true;
      }
    } else {
      processedArgs.push(arg);
    }
  }

  // Print mode with specific variable names: declare -p varname
  if (printMode && processedArgs.length > 0) {
    let stdout = "";
    for (const name of processedArgs) {
      const value = ctx.state.env[name];
      if (value !== undefined) {
        // Use double quotes and escape properly for bash compatibility
        const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        stdout += `declare -- ${name}="${escapedValue}"\n`;
      }
    }
    return success(stdout);
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
        for (const [key, value] of entries) {
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
      continue;
    }

    // Check for scalar assignment: name=value
    if (arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      const name = arg.slice(0, eqIdx);
      const value = arg.slice(eqIdx + 1);

      // Check if variable is readonly
      const error = checkReadonlyError(ctx, name);
      if (error) return error;

      ctx.state.env[name] = value;
      if (declareReadonly) {
        markReadonly(ctx, name);
      }
    } else {
      // Just declare without value
      const name = arg;

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
export function parseAssocArrayLiteral(content: string): [string, string][] {
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
