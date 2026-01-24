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
 *   declare -g NAME      - Declare global variable (inside functions)
 *
 * Also aliased as 'typeset'
 */

import { parseArithmeticExpression } from "../../parser/arithmetic-parser.js";
import { Parser } from "../../parser/parser.js";
import type { ExecResult } from "../../types.js";
import { evaluateArithmeticSync } from "../arithmetic.js";
import {
  clearArray,
  getArrayIndices,
  getAssocArrayKeys,
} from "../helpers/array.js";
import {
  isNameref,
  markNameref,
  markNamerefBound,
  markNamerefInvalid,
  resolveNameref,
  targetExists,
  unmarkNameref,
} from "../helpers/nameref.js";
import {
  quoteArrayValue,
  quoteDeclareValue,
  quoteValue,
} from "../helpers/quoting.js";
import {
  checkReadonlyError,
  isReadonly,
  markExported,
  markReadonly,
  unmarkExported,
} from "../helpers/readonly.js";
import { OK, result, success } from "../helpers/result.js";
import { expandTildesInValue } from "../helpers/tilde.js";
import type { InterpreterContext } from "../types.js";
import {
  markLocalVarDepth,
  parseAssignment,
  setVariable,
} from "./variable-helpers.js";

/**
 * Get the attribute flags string for a variable (e.g., "-r", "-x", "-rx", "--")
 * Order follows bash convention: a/A (array), i (integer), l (lowercase), n (nameref), r (readonly), u (uppercase), x (export)
 */
function getVariableFlags(ctx: InterpreterContext, name: string): string {
  let flags = "";

  // Note: array flags (-a/-A) are handled separately in the caller
  // since they require different output format

  // Integer attribute
  if (ctx.state.integerVars?.has(name)) {
    flags += "i";
  }

  // Lowercase attribute
  if (ctx.state.lowercaseVars?.has(name)) {
    flags += "l";
  }

  // Nameref attribute
  if (isNameref(ctx, name)) {
    flags += "n";
  }

  // Readonly attribute
  if (isReadonly(ctx, name)) {
    flags += "r";
  }

  // Uppercase attribute
  if (ctx.state.uppercaseVars?.has(name)) {
    flags += "u";
  }

  // Export attribute
  if (ctx.state.exportedVars?.has(name)) {
    flags += "x";
  }

  return flags === "" ? "--" : `-${flags}`;
}

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
function isLowercase(ctx: InterpreterContext, name: string): boolean {
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
function isUppercase(ctx: InterpreterContext, name: string): boolean {
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

/**
 * Format a value for associative array output in declare -p.
 * Uses the oils/ysh-compatible format:
 * - Simple values (no spaces, no special chars): unquoted
 * - Empty strings or values with spaces/special chars: single-quoted with escaping
 */
function formatAssocValue(value: string): string {
  // Empty string needs quotes
  if (value === "") {
    return "''";
  }
  // If value contains spaces, single quotes, or other special chars, quote it
  if (/[\s'\\]/.test(value)) {
    // Escape single quotes as '\'' (end quote, escaped quote, start quote)
    const escaped = value.replace(/'/g, "'\\''");
    return `'${escaped}'`;
  }
  // Simple value - no quotes needed
  return value;
}

/**
 * Parse array assignment syntax: name[index]=value
 * Handles nested brackets like a[a[0]=1]=X
 * Returns null if not an array assignment pattern
 */
function parseArrayAssignment(
  arg: string,
): { name: string; indexExpr: string; value: string } | null {
  // Check for variable name at start
  const nameMatch = arg.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
  if (!nameMatch) return null;

  const name = nameMatch[0];
  let pos = name.length;

  // Must have [ after name
  if (arg[pos] !== "[") return null;

  // Find matching ] using bracket depth tracking
  let depth = 0;
  const subscriptStart = pos + 1;
  for (; pos < arg.length; pos++) {
    if (arg[pos] === "[") depth++;
    else if (arg[pos] === "]") {
      depth--;
      if (depth === 0) break;
    }
  }

  // If depth is not 0, brackets are unbalanced
  if (depth !== 0) return null;

  const indexExpr = arg.slice(subscriptStart, pos);
  pos++; // skip closing ]

  // Must have = after ]
  if (arg[pos] !== "=") return null;
  pos++; // skip =

  const value = arg.slice(pos);

  return { name, indexExpr, value };
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
  let removeArray = false; // +a flag: remove array attribute, treat value as scalar
  let removeExport = false; // +x flag: remove export attribute
  let declareInteger = false;
  let declareLowercase = false;
  let declareUppercase = false;
  let functionMode = false; // -f flag: function definitions
  let functionNamesOnly = false; // -F flag: function names only
  let declareGlobal = false; // -g flag: declare global variable (inside functions)
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
    } else if (arg === "+a") {
      removeArray = true;
    } else if (arg === "+x") {
      removeExport = true;
    } else if (arg === "--") {
      // End of options, rest are arguments
      processedArgs.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith("+")) {
      // Handle + flags that remove attributes
      // Valid + flags: +a, +n, +x, +r, +i, +f, +F
      for (const flag of arg.slice(1)) {
        if (flag === "n") removeNameref = true;
        else if (flag === "a") removeArray = true;
        else if (flag === "x") removeExport = true;
        else if (flag === "r") {
          // +r is accepted by bash but has no effect (can't un-readonly)
          // We just ignore it silently
        } else if (flag === "i") {
          // +i removes integer attribute - we just ignore since we don't track removal
        } else if (flag === "f" || flag === "F") {
          // +f/+F for function listing - we just ignore
        } else {
          // Unknown flag - bash returns exit code 2 for invalid options
          return result("", `bash: typeset: +${flag}: invalid option\n`, 2);
        }
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
    } else if (arg === "-g") {
      declareGlobal = true;
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
        else if (flag === "g") declareGlobal = true;
        else {
          // Unknown flag - bash returns exit code 2 for invalid options
          return result("", `bash: typeset: -${flag}: invalid option\n`, 2);
        }
      }
    } else {
      processedArgs.push(arg);
    }
  }

  // Determine if we should create local variables (inside a function, without -g flag)
  const isInsideFunction = ctx.state.localScopes.length > 0;
  const createLocal = isInsideFunction && !declareGlobal;

  // Helper to save variable to local scope (for restoration when function exits)
  const saveToLocalScope = (name: string): void => {
    if (!createLocal) return;
    const currentScope =
      ctx.state.localScopes[ctx.state.localScopes.length - 1];
    if (!currentScope.has(name)) {
      currentScope.set(name, ctx.state.env[name]);
    }
  };

  // Helper to save array elements to local scope
  const saveArrayToLocalScope = (name: string): void => {
    if (!createLocal) return;
    const currentScope =
      ctx.state.localScopes[ctx.state.localScopes.length - 1];
    // Save the base variable
    if (!currentScope.has(name)) {
      currentScope.set(name, ctx.state.env[name]);
    }
    // Save array elements
    const prefix = `${name}_`;
    for (const key of Object.keys(ctx.state.env)) {
      if (key.startsWith(prefix) && !key.includes("__")) {
        if (!currentScope.has(key)) {
          currentScope.set(key, ctx.state.env[key]);
        }
      }
    }
    // Save length metadata
    const lengthKey = `${name}__length`;
    if (
      ctx.state.env[lengthKey] !== undefined &&
      !currentScope.has(lengthKey)
    ) {
      currentScope.set(lengthKey, ctx.state.env[lengthKey]);
    }
  };

  // Helper to mark variable as local after setting it
  const markAsLocalIfNeeded = (name: string): void => {
    if (createLocal) {
      markLocalVarDepth(ctx, name);
    }
  };

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
    // With args, check if functions exist and output their names
    let allExist = true;
    let stdout = "";
    for (const name of processedArgs) {
      if (ctx.state.functions.has(name)) {
        stdout += `${name}\n`;
      } else {
        allExist = false;
      }
    }
    return result(stdout, "", allExist ? 0 : 1);
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
    let stderr = "";
    let anyNotFound = false;
    for (const name of processedArgs) {
      // Get the variable's attribute flags (for scalar variables)
      const flags = getVariableFlags(ctx, name);

      // Check if this is an associative array
      const isAssoc = ctx.state.associativeArrays?.has(name);
      if (isAssoc) {
        const keys = getAssocArrayKeys(ctx, name);
        if (keys.length === 0) {
          stdout += `declare -A ${name}=()\n`;
        } else {
          const elements = keys.map((key) => {
            const value = ctx.state.env[`${name}_${key}`] ?? "";
            // Format: ['key']=value (single quotes around key)
            const formattedValue = formatAssocValue(value);
            return `['${key}']=${formattedValue}`;
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
          return `[${index}]=${quoteArrayValue(value)}`;
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
        // Use $'...' quoting for control characters, double quotes otherwise
        stdout += `declare ${flags} ${name}=${quoteDeclareValue(value)}\n`;
      } else {
        // Check if variable is declared but unset (via declare or local)
        const isDeclared = ctx.state.declaredVars?.has(name);
        const isLocalVar = ctx.state.localVarDepth?.has(name);
        if (isDeclared || isLocalVar) {
          // Variable is declared but has no value - output without =""
          stdout += `declare ${flags} ${name}\n`;
        } else {
          // Variable not found - add error to stderr and set flag for exit code 1
          stderr += `bash: declare: ${name}: not found\n`;
          anyNotFound = true;
        }
      }
    }
    return result(stdout, stderr, anyNotFound ? 1 : 0);
  }

  // Print mode without args (declare -p): list all variables with attributes
  // When filtering flags are also set (-x, -r, -n, -a, -A), only show matching variables
  if (printMode && processedArgs.length === 0) {
    // Check if any filtering flags are set
    const filterExport = declareExport;
    const filterReadonly = declareReadonly;
    const filterNameref = declareNameref;
    const filterIndexedArray = declareArray;
    const filterAssocArray = declareAssoc;
    const hasFilter =
      filterExport ||
      filterReadonly ||
      filterNameref ||
      filterIndexedArray ||
      filterAssocArray;

    let stdout = "";

    // Collect all variable names (excluding internal markers like __length)
    const varNames = new Set<string>();
    for (const key of Object.keys(ctx.state.env)) {
      if (key.startsWith("BASH_")) continue;
      // For __length markers, extract the base name (for empty arrays)
      if (key.endsWith("__length")) {
        const baseName = key.slice(0, -8);
        varNames.add(baseName);
        continue;
      }
      // For array elements (name_index), extract base name
      const underscoreIdx = key.lastIndexOf("_");
      if (underscoreIdx > 0) {
        const baseName = key.slice(0, underscoreIdx);
        const suffix = key.slice(underscoreIdx + 1);
        // If suffix is numeric or baseName is an array, it's an array element
        if (
          /^\d+$/.test(suffix) ||
          ctx.state.associativeArrays?.has(baseName)
        ) {
          varNames.add(baseName);
          continue;
        }
      }
      varNames.add(key);
    }

    // Also include local variables if we're in a function scope
    if (ctx.state.localVarDepth) {
      for (const name of ctx.state.localVarDepth.keys()) {
        varNames.add(name);
      }
    }

    // Include associative array names (for empty associative arrays)
    if (ctx.state.associativeArrays) {
      for (const name of ctx.state.associativeArrays) {
        varNames.add(name);
      }
    }

    // Sort and output each variable
    const sortedNames = Array.from(varNames).sort();
    for (const name of sortedNames) {
      const flags = getVariableFlags(ctx, name);

      // Check if this is an associative array
      const isAssoc = ctx.state.associativeArrays?.has(name);

      // Check if this is an indexed array (not associative)
      const arrayIndices = getArrayIndices(ctx, name);
      const isIndexedArray =
        !isAssoc &&
        (arrayIndices.length > 0 ||
          ctx.state.env[`${name}__length`] !== undefined);

      // Apply filters if set
      if (hasFilter) {
        // If filtering for associative arrays only (-pA)
        if (filterAssocArray && !isAssoc) continue;
        // If filtering for indexed arrays only (-pa)
        if (filterIndexedArray && !isIndexedArray) continue;
        // If filtering for exported only (-px)
        if (filterExport && !ctx.state.exportedVars?.has(name)) continue;
        // If filtering for readonly only (-pr)
        if (filterReadonly && !ctx.state.readonlyVars?.has(name)) continue;
        // If filtering for nameref only (-pn)
        if (filterNameref && !isNameref(ctx, name)) continue;
      }

      if (isAssoc) {
        const keys = getAssocArrayKeys(ctx, name);
        if (keys.length === 0) {
          stdout += `declare -A ${name}=()\n`;
        } else {
          const elements = keys.map((key) => {
            const value = ctx.state.env[`${name}_${key}`] ?? "";
            // Format: ['key']=value (single quotes around key)
            const formattedValue = formatAssocValue(value);
            return `['${key}']=${formattedValue}`;
          });
          stdout += `declare -A ${name}=(${elements.join(" ")})\n`;
        }
        continue;
      }

      // Check if this is an indexed array
      if (arrayIndices.length > 0) {
        const elements = arrayIndices.map((index) => {
          const value = ctx.state.env[`${name}_${index}`] ?? "";
          return `[${index}]=${quoteArrayValue(value)}`;
        });
        stdout += `declare -a ${name}=(${elements.join(" ")})\n`;
        continue;
      }

      // Check if this is an empty array
      if (ctx.state.env[`${name}__length`] !== undefined) {
        stdout += `declare -a ${name}=()\n`;
        continue;
      }

      // Regular scalar variable
      const value = ctx.state.env[name];
      if (value !== undefined) {
        stdout += `declare ${flags} ${name}=${quoteDeclareValue(value)}\n`;
      }
    }
    return success(stdout);
  }

  // Handle declare -A without arguments: list all associative arrays
  if (processedArgs.length === 0 && declareAssoc && !printMode) {
    let stdout = "";

    // Get all associative array names and sort them
    const assocNames = Array.from(ctx.state.associativeArrays ?? []).sort();

    for (const name of assocNames) {
      const keys = getAssocArrayKeys(ctx, name);
      if (keys.length === 0) {
        // Empty associative array
        stdout += `declare -A ${name}=()\n`;
      } else {
        // Non-empty associative array: format as (['key']=value ...)
        const elements = keys.map((key) => {
          const value = ctx.state.env[`${name}_${key}`] ?? "";
          // Format: ['key']=value (single quotes around key)
          const formattedValue = formatAssocValue(value);
          return `['${key}']=${formattedValue}`;
        });
        stdout += `declare -A ${name}=(${elements.join(" ")})\n`;
      }
    }
    return success(stdout);
  }

  // Handle declare -a without arguments: list all indexed arrays
  if (processedArgs.length === 0 && declareArray && !printMode) {
    let stdout = "";

    // Find all indexed arrays
    const arrayNames = new Set<string>();
    for (const key of Object.keys(ctx.state.env)) {
      if (key.startsWith("BASH_")) continue;
      // Check for __length marker (empty arrays)
      if (key.endsWith("__length")) {
        const baseName = key.slice(0, -8);
        // Make sure it's not an associative array
        if (!ctx.state.associativeArrays?.has(baseName)) {
          arrayNames.add(baseName);
        }
        continue;
      }
      // Check for numeric index pattern (name_index)
      const lastUnderscore = key.lastIndexOf("_");
      if (lastUnderscore > 0) {
        const baseName = key.slice(0, lastUnderscore);
        const suffix = key.slice(lastUnderscore + 1);
        // If suffix is numeric, it's an array element
        if (/^\d+$/.test(suffix)) {
          // Make sure it's not an associative array
          if (!ctx.state.associativeArrays?.has(baseName)) {
            arrayNames.add(baseName);
          }
        }
      }
    }

    // Output each array in sorted order
    const sortedNames = Array.from(arrayNames).sort();
    for (const name of sortedNames) {
      const indices = getArrayIndices(ctx, name);
      if (indices.length === 0) {
        // Empty array
        stdout += `declare -a ${name}=()\n`;
      } else {
        // Non-empty array: format as ([index]="value" ...)
        const elements = indices.map((index) => {
          const value = ctx.state.env[`${name}_${index}`] ?? "";
          return `[${index}]=${quoteArrayValue(value)}`;
        });
        stdout += `declare -a ${name}=(${elements.join(" ")})\n`;
      }
    }
    return success(stdout);
  }

  // No args: list all variables (without -p flag, just print name=value)
  if (processedArgs.length === 0 && !printMode) {
    let stdout = "";

    // Collect all variable names (excluding internal markers)
    const varNames = new Set<string>();
    for (const key of Object.keys(ctx.state.env)) {
      if (key.startsWith("BASH_")) continue;
      // For __length markers, extract the base name (for arrays)
      if (key.endsWith("__length")) {
        const baseName = key.slice(0, -8);
        varNames.add(baseName);
        continue;
      }
      // For array elements (name_index), extract base name
      const underscoreIdx = key.lastIndexOf("_");
      if (underscoreIdx > 0) {
        const baseName = key.slice(0, underscoreIdx);
        const suffix = key.slice(underscoreIdx + 1);
        // If suffix is numeric or baseName is an associative array
        if (
          /^\d+$/.test(suffix) ||
          ctx.state.associativeArrays?.has(baseName)
        ) {
          varNames.add(baseName);
          continue;
        }
      }
      varNames.add(key);
    }

    const sortedNames = Array.from(varNames).sort();
    for (const name of sortedNames) {
      // Check if this is an associative array
      const isAssoc = ctx.state.associativeArrays?.has(name);
      if (isAssoc) {
        // Skip associative arrays for simple declare output
        continue;
      }

      // Check if this is an indexed array
      const arrayIndices = getArrayIndices(ctx, name);
      if (
        arrayIndices.length > 0 ||
        ctx.state.env[`${name}__length`] !== undefined
      ) {
        // Skip indexed arrays for simple declare output
        continue;
      }

      // Regular scalar variable - output as name=value
      const value = ctx.state.env[name];
      if (value !== undefined) {
        stdout += `${name}=${quoteValue(value)}\n`;
      }
    }
    return success(stdout);
  }

  // Track errors during processing
  let stderr = "";
  let exitCode = 0;

  // Process each argument
  for (const arg of processedArgs) {
    // Check for array assignment: name=(...)
    // When +a (removeArray) is set, don't interpret (...) as array syntax - treat it as a literal string
    const arrayMatch = arg.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=\((.*)\)$/s);
    if (arrayMatch && !removeArray) {
      const name = arrayMatch[1];
      const content = arrayMatch[2];

      // Check for type conversion errors
      // Cannot convert indexed array to associative array
      if (declareAssoc) {
        const existingIndices = getArrayIndices(ctx, name);
        if (existingIndices.length > 0) {
          stderr += `bash: declare: ${name}: cannot convert indexed to associative array\n`;
          exitCode = 1;
          continue;
        }
      }
      // Cannot convert associative array to indexed array
      if (declareArray || (!declareAssoc && !declareArray)) {
        // If no -A flag is set and variable is already an assoc array, error
        if (ctx.state.associativeArrays?.has(name)) {
          stderr += `bash: declare: ${name}: cannot convert associative to indexed array\n`;
          exitCode = 1;
          continue;
        }
      }

      // Save to local scope before modifying (for local variable restoration)
      saveArrayToLocalScope(name);

      // Track associative array declaration
      if (declareAssoc) {
        ctx.state.associativeArrays ??= new Set();
        ctx.state.associativeArrays.add(name);
      }

      // Clear existing array elements before assigning new ones
      // This ensures arr=(a b c); arr=(d e) results in just (d e), not merged
      clearArray(ctx, name);
      // Also clear the scalar value and length marker
      delete ctx.state.env[name];
      delete ctx.state.env[`${name}__length`];

      // Check if this is associative array literal syntax: (['key']=value ...)
      if (declareAssoc && content.includes("[")) {
        const entries = parseAssocArrayLiteral(content);
        for (const [key, rawValue] of entries) {
          // Apply tilde expansion to the value
          const value = expandTildesInValue(ctx, rawValue);
          ctx.state.env[`${name}_${key}`] = value;
        }
      } else if (declareAssoc) {
        // For associative arrays without [key]=value syntax,
        // bash treats bare values as alternating key-value pairs
        // e.g., (1 2 3) becomes ['1']=2, ['3']=''
        const elements = parseArrayElements(content);
        for (let i = 0; i < elements.length; i += 2) {
          const key = elements[i];
          const value =
            i + 1 < elements.length
              ? expandTildesInValue(ctx, elements[i + 1])
              : "";
          ctx.state.env[`${name}_${key}`] = value;
        }
      } else {
        // Parse as indexed array elements
        const elements = parseArrayElements(content);
        // Check if any element has [index]=value syntax (index can be number, variable, or expression)
        const hasKeyedElements = elements.some((el) => /^\[[^\]]+\]=/.test(el));
        if (hasKeyedElements) {
          // Handle sparse array with [index]=value syntax
          // Track current index - non-keyed elements use previous keyed index + 1
          let currentIndex = 0;
          for (const element of elements) {
            // Match [index]=value where index can be any expression (not just digits)
            const keyedMatch = element.match(/^\[([^\]]+)\]=(.*)$/);
            if (keyedMatch) {
              const indexExpr = keyedMatch[1];
              const rawValue = keyedMatch[2];
              const value = expandTildesInValue(ctx, rawValue);
              // Evaluate index as arithmetic expression (handles numbers, variables, expressions)
              let index: number;
              if (/^-?\d+$/.test(indexExpr)) {
                index = Number.parseInt(indexExpr, 10);
              } else {
                // Evaluate as arithmetic expression
                try {
                  const parser = new Parser();
                  const arithAst = parseArithmeticExpression(parser, indexExpr);
                  index = evaluateArithmeticSync(ctx, arithAst.expression);
                } catch {
                  // If parsing fails, treat as 0 (like unset variable)
                  index = 0;
                }
              }
              ctx.state.env[`${name}_${index}`] = value;
              currentIndex = index + 1;
            } else {
              // Non-keyed element: use currentIndex and increment
              const value = expandTildesInValue(ctx, element);
              ctx.state.env[`${name}_${currentIndex}`] = value;
              currentIndex++;
            }
          }
        } else {
          // Simple sequential assignment
          for (let i = 0; i < elements.length; i++) {
            ctx.state.env[`${name}_${i}`] = elements[i];
          }
          // Store array length marker
          ctx.state.env[`${name}__length`] = String(elements.length);
        }
      }

      // Mark as local if inside a function
      markAsLocalIfNeeded(name);

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

    // Handle export removal (+x)
    if (removeExport) {
      const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
      unmarkExported(ctx, name);
      // After removing export, continue processing to set any value if provided
      if (!arg.includes("=")) {
        continue;
      }
    }

    // Check for array index assignment: name[index]=value
    // We need to handle nested brackets like a[a[0]=1]=X
    // The regex approach doesn't work for nested brackets, so we parse manually
    const arrayAssignMatch = parseArrayAssignment(arg);
    if (arrayAssignMatch) {
      const { name, indexExpr, value } = arrayAssignMatch;

      // Check if variable is readonly
      const error = checkReadonlyError(ctx, name);
      if (error) return error;

      // Save to local scope before modifying
      saveArrayToLocalScope(name);

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

      // Mark as local if inside a function
      markAsLocalIfNeeded(name);

      if (declareReadonly) {
        markReadonly(ctx, name);
      }
      if (declareExport) {
        markExported(ctx, name);
      }
      continue;
    }

    // Check for array append syntax: typeset NAME+=(...)
    const arrayAppendMatch = arg.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\+=\((.*)\)$/s,
    );
    if (arrayAppendMatch && !removeArray) {
      const name = arrayAppendMatch[1];
      const content = arrayAppendMatch[2];

      // Check if variable is readonly
      const error = checkReadonlyError(ctx, name);
      if (error) return error;

      // Save to local scope before modifying
      saveArrayToLocalScope(name);

      // Parse new elements
      const newElements = parseArrayElements(content);

      // Check if this is an associative array
      if (ctx.state.associativeArrays?.has(name)) {
        // For associative arrays, we need keyed elements: ([key]=value ...)
        const entries = parseAssocArrayLiteral(content);
        for (const [key, rawValue] of entries) {
          const value = expandTildesInValue(ctx, rawValue);
          ctx.state.env[`${name}_${key}`] = value;
        }
      } else {
        // For indexed arrays, get current highest index and append
        const existingIndices = getArrayIndices(ctx, name);

        // If variable was a scalar, convert it to array element 0
        let startIndex = 0;
        if (existingIndices.length === 0 && ctx.state.env[name] !== undefined) {
          // Variable exists as scalar - convert to array element 0
          const scalarValue = ctx.state.env[name];
          ctx.state.env[`${name}_0`] = scalarValue;
          delete ctx.state.env[name];
          startIndex = 1;
        } else if (existingIndices.length > 0) {
          // Find highest existing index + 1
          startIndex = Math.max(...existingIndices) + 1;
        }

        // Append new elements
        for (let i = 0; i < newElements.length; i++) {
          ctx.state.env[`${name}_${startIndex + i}`] = expandTildesInValue(
            ctx,
            newElements[i],
          );
        }

        // Update length marker
        const newLength = startIndex + newElements.length;
        ctx.state.env[`${name}__length`] = String(newLength);
      }

      // Mark as local if inside a function
      markAsLocalIfNeeded(name);

      if (declareReadonly) {
        markReadonly(ctx, name);
      }
      if (declareExport) {
        markExported(ctx, name);
      }
      continue;
    }

    // Check for += append syntax: typeset NAME+=value (scalar append)
    const appendMatch = arg.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\+=(.*)$/);
    if (appendMatch) {
      const name = appendMatch[1];
      let appendValue = expandTildesInValue(ctx, appendMatch[2]);

      // Check if variable is readonly
      const error = checkReadonlyError(ctx, name);
      if (error) return error;

      // Save to local scope before modifying
      saveToLocalScope(name);

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

      // Check if this is an array (bash appends to element 0 for array+=string)
      const existingIndices = getArrayIndices(ctx, name);
      const isArray =
        existingIndices.length > 0 || ctx.state.associativeArrays?.has(name);

      // If variable has integer attribute, evaluate as arithmetic and add
      if (isInteger(ctx, name)) {
        const existing = ctx.state.env[name] ?? "0";
        const existingNum = parseInt(existing, 10) || 0;
        const appendNum =
          parseInt(evaluateIntegerValue(ctx, appendValue), 10) || 0;
        appendValue = String(existingNum + appendNum);
        ctx.state.env[name] = appendValue;
      } else if (isArray) {
        // For arrays, append to element 0 (bash behavior)
        appendValue = applyCaseTransform(ctx, name, appendValue);
        const element0Key = `${name}_0`;
        const existing = ctx.state.env[element0Key] ?? "";
        ctx.state.env[element0Key] = existing + appendValue;
      } else {
        // Apply case transformation
        appendValue = applyCaseTransform(ctx, name, appendValue);

        // Append to existing value (or set if not defined)
        const existing = ctx.state.env[name] ?? "";
        ctx.state.env[name] = existing + appendValue;
      }

      // Mark as local if inside a function
      markAsLocalIfNeeded(name);

      if (declareReadonly) {
        markReadonly(ctx, name);
      }
      if (declareExport) {
        markExported(ctx, name);
      }
      // If allexport is enabled (set -a), auto-export the variable
      if (ctx.state.options.allexport && !removeExport) {
        ctx.state.exportedVars = ctx.state.exportedVars || new Set();
        ctx.state.exportedVars.add(name);
      }
      continue;
    }

    // Check for scalar assignment: name=value
    if (arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      const name = arg.slice(0, eqIdx);
      let value = arg.slice(eqIdx + 1);

      // Validate variable name
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        stderr += `bash: typeset: \`${name}': not a valid identifier\n`;
        exitCode = 1;
        continue;
      }

      // Check if variable is readonly
      const error = checkReadonlyError(ctx, name);
      if (error) return error;

      // Save to local scope before modifying
      saveToLocalScope(name);

      // For namerefs being declared with a value, store the target name
      // (don't follow the reference, just store what variable it points to)
      if (declareNameref) {
        // Validate the target: must be a valid variable name or array subscript,
        // not a special parameter like @, *, #, etc.
        // bash gives an error: "declare: `@': invalid variable name for name reference"
        if (value !== "" && !/^[a-zA-Z_][a-zA-Z0-9_]*(\[.+\])?$/.test(value)) {
          stderr += `bash: declare: \`${value}': invalid variable name for name reference\n`;
          exitCode = 1;
          continue;
        }
        ctx.state.env[name] = value;
        markNameref(ctx, name);
        // If the target variable exists at creation time, mark this nameref as "bound".
        // Bound namerefs always resolve through to their target, even if unset later.
        // Unbound namerefs (target never existed) act like regular variables.
        if (value !== "" && targetExists(ctx, value)) {
          markNamerefBound(ctx, name);
        }
        markAsLocalIfNeeded(name);
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

      // Mark as local if inside a function
      markAsLocalIfNeeded(name);

      if (declareReadonly) {
        markReadonly(ctx, name);
      }
      if (declareExport) {
        markExported(ctx, name);
      }
      // If allexport is enabled (set -a), auto-export the variable
      if (ctx.state.options.allexport && !removeExport) {
        ctx.state.exportedVars = ctx.state.exportedVars || new Set();
        ctx.state.exportedVars.add(name);
      }
    } else {
      // Just declare without value
      const name = arg;

      // Validate variable name
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        stderr += `bash: typeset: \`${name}': not a valid identifier\n`;
        exitCode = 1;
        continue;
      }

      // Save to local scope before modifying
      if (declareArray || declareAssoc) {
        saveArrayToLocalScope(name);
      } else {
        saveToLocalScope(name);
      }

      // For declare -n without a value, just mark as nameref
      if (declareNameref) {
        markNameref(ctx, name);
        // If the existing value is not a valid variable name, mark as invalid nameref.
        // Invalid namerefs act as regular variables (no resolution).
        const existingValue = ctx.state.env[name];
        if (
          existingValue !== undefined &&
          existingValue !== "" &&
          !/^[a-zA-Z_][a-zA-Z0-9_]*(\[.+\])?$/.test(existingValue)
        ) {
          markNamerefInvalid(ctx, name);
        } else if (existingValue && targetExists(ctx, existingValue)) {
          // If target exists at creation time, mark as bound
          markNamerefBound(ctx, name);
        }
        markAsLocalIfNeeded(name);
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
        // Check if this is already an indexed array - can't convert
        const existingIndices = getArrayIndices(ctx, name);
        if (existingIndices.length > 0) {
          // bash: declare: z: cannot convert indexed to associative array
          stderr += `bash: declare: ${name}: cannot convert indexed to associative array\n`;
          exitCode = 1;
          continue;
        }
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
          // Mark variable as declared but don't set a value
          // This distinguishes "declare x" (unset) from "declare x=" (empty string)
          ctx.state.declaredVars ??= new Set();
          ctx.state.declaredVars.add(name);
        }
      }

      // Mark as local if inside a function
      markAsLocalIfNeeded(name);

      if (declareReadonly) {
        markReadonly(ctx, name);
      }
      if (declareExport) {
        markExported(ctx, name);
      }
    }
  }

  return result("", stderr, exitCode);
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
  // Track whether we've seen content that should result in an element,
  // including empty quoted strings like '' or ""
  let hasContent = false;

  for (const char of content) {
    if (escaped) {
      current += char;
      escaped = false;
      hasContent = true;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      // Entering or leaving single quotes - either way, this indicates an element exists
      if (!inSingleQuote) {
        // Entering quotes - mark that we have content (even if empty)
        hasContent = true;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      // Entering or leaving double quotes - either way, this indicates an element exists
      if (!inDoubleQuote) {
        // Entering quotes - mark that we have content (even if empty)
        hasContent = true;
      }
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (
      (char === " " || char === "\t" || char === "\n") &&
      !inSingleQuote &&
      !inDoubleQuote
    ) {
      if (hasContent) {
        elements.push(current);
        current = "";
        hasContent = false;
      }
      continue;
    }
    current += char;
    hasContent = true;
  }
  if (hasContent) {
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
  let _printMode = false;
  const processedArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-a") {
      _declareArray = true;
    } else if (arg === "-A") {
      _declareAssoc = true;
    } else if (arg === "-p") {
      _printMode = true;
    } else if (arg === "--") {
      processedArgs.push(...args.slice(i + 1));
      break;
    } else if (!arg.startsWith("-")) {
      processedArgs.push(arg);
    }
  }

  // When called with no args (or just -p), list readonly variables
  if (processedArgs.length === 0) {
    let stdout = "";
    const readonlyNames = Array.from(ctx.state.readonlyVars || []).sort();
    for (const name of readonlyNames) {
      const value = ctx.state.env[name];
      if (value !== undefined) {
        const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        stdout += `declare -r ${name}="${escapedValue}"\n`;
      }
    }
    return success(stdout);
  }

  for (const arg of processedArgs) {
    // Check for array append syntax: readonly NAME+=(...)
    const arrayAppendMatch = arg.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\+=\((.*)\)$/s,
    );
    if (arrayAppendMatch) {
      const name = arrayAppendMatch[1];
      const content = arrayAppendMatch[2];

      // Check if variable is already readonly
      const error = checkReadonlyError(ctx, name);
      if (error) return error;

      // Parse new elements
      const newElements = parseArrayElements(content);

      // Check if this is an associative array
      if (ctx.state.associativeArrays?.has(name)) {
        // For associative arrays, we need keyed elements: ([key]=value ...)
        const entries = parseAssocArrayLiteral(content);
        for (const [key, rawValue] of entries) {
          const value = expandTildesInValue(ctx, rawValue);
          ctx.state.env[`${name}_${key}`] = value;
        }
      } else {
        // For indexed arrays, get current highest index and append
        const existingIndices = getArrayIndices(ctx, name);

        // If variable was a scalar, convert it to array element 0
        let startIndex = 0;
        if (existingIndices.length === 0 && ctx.state.env[name] !== undefined) {
          // Variable exists as scalar - convert to array element 0
          const scalarValue = ctx.state.env[name];
          ctx.state.env[`${name}_0`] = scalarValue;
          delete ctx.state.env[name];
          startIndex = 1;
        } else if (existingIndices.length > 0) {
          // Find highest existing index + 1
          startIndex = Math.max(...existingIndices) + 1;
        }

        // Append new elements
        for (let i = 0; i < newElements.length; i++) {
          ctx.state.env[`${name}_${startIndex + i}`] = expandTildesInValue(
            ctx,
            newElements[i],
          );
        }

        // Update length marker
        const newLength = startIndex + newElements.length;
        ctx.state.env[`${name}__length`] = String(newLength);
      }

      markReadonly(ctx, name);
      continue;
    }

    // Check for += append syntax: readonly NAME+=value (scalar append)
    const appendMatch = arg.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\+=(.*)$/);
    if (appendMatch) {
      const name = appendMatch[1];
      const appendValue = expandTildesInValue(ctx, appendMatch[2]);

      // Check if variable is already readonly
      const error = checkReadonlyError(ctx, name);
      if (error) return error;

      // Append to existing value (or set if not defined)
      const existing = ctx.state.env[name] ?? "";
      ctx.state.env[name] = existing + appendValue;
      markReadonly(ctx, name);
      continue;
    }

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
