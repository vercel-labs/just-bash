/**
 * Type Command Implementation
 *
 * Implements the `type` builtin command and related functionality:
 * - type [-afptP] name...
 * - command -v/-V name...
 *
 * Also includes helpers for function source serialization.
 */

import {
  AST,
  type CommandNode,
  type FunctionDefNode,
  type GroupNode,
  type PipelineNode,
  type SimpleCommandNode,
  type StatementNode,
  type WordNode,
  type WordPart,
} from "../ast/types.js";
import type { IFileSystem } from "../fs/interface.js";
import { serializeWord } from "../transform/serialize.js";
import type { CommandRegistry, ExecResult } from "../types.js";
import { searchPath } from "./command-resolution.js";
import { result } from "./helpers/result.js";
import { SHELL_BUILTINS, SHELL_KEYWORDS } from "./helpers/shell-constants.js";
import type { InterpreterState } from "./types.js";

/**
 * Context needed for type command operations
 */
export interface TypeCommandContext {
  state: InterpreterState;
  fs: IFileSystem;
  commands: CommandRegistry;
}

/**
 * Handle the `type` builtin command.
 * type [-afptP] name...
 */
export async function handleType(
  ctx: TypeCommandContext,
  args: string[],
  findFirstInPath: (name: string) => Promise<string | null>,
  findCommandInPath: (name: string) => Promise<string[]>,
): Promise<ExecResult> {
  // Parse options
  let typeOnly = false; // -t flag: print only the type word
  let pathOnly = false; // -p flag: print only paths to executables (respects aliases/functions/builtins)
  let forcePathSearch = false; // -P flag: force PATH search (ignores aliases/functions/builtins)
  let showAll = false; // -a flag: show all definitions
  let suppressFunctions = false; // -f flag: suppress function lookup
  const names: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("-") && arg.length > 1) {
      // Handle combined options like -ap, -tP, etc.
      for (const char of arg.slice(1)) {
        if (char === "t") {
          typeOnly = true;
        } else if (char === "p") {
          pathOnly = true;
        } else if (char === "P") {
          forcePathSearch = true;
        } else if (char === "a") {
          showAll = true;
        } else if (char === "f") {
          suppressFunctions = true;
        }
      }
    } else {
      names.push(arg);
    }
  }

  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let anyFileFound = false; // Track if any name was found as a file (for -p exit code)
  let anyNotFound = false; // Track if any name wasn't found

  for (const name of names) {
    let foundAny = false;

    // -P flag: force PATH search, ignoring aliases/functions/builtins
    if (forcePathSearch) {
      // -a -P: show all paths
      if (showAll) {
        const allPaths = await findCommandInPath(name);
        if (allPaths.length > 0) {
          for (const p of allPaths) {
            stdout += `${p}\n`;
          }
          anyFileFound = true;
          foundAny = true;
        }
      } else {
        const pathResult = await findFirstInPath(name);
        if (pathResult) {
          stdout += `${pathResult}\n`;
          anyFileFound = true;
          foundAny = true;
        }
      }
      if (!foundAny) {
        anyNotFound = true;
      }
      // For -P, don't print anything if not found in PATH
      continue;
    }

    // Check functions first (unless -f suppresses them)
    // Note: In bash, with -a, functions are checked first, then aliases, keywords, builtins, files
    // But without -a, the order is: alias, keyword, function, builtin, file
    // With -f, we skip function lookup entirely

    // When showing all (-a), we need to show in this order:
    // 1. function (unless -f)
    // 2. alias
    // 3. keyword
    // 4. builtin
    // 5. all file paths

    // Without -a, we stop at the first match (in order: alias, keyword, function, builtin, file)

    // Check functions (unless -f suppresses them)
    const hasFunction = !suppressFunctions && ctx.state.functions.has(name);
    if (showAll && hasFunction) {
      // -p: print nothing for functions (no path)
      if (pathOnly) {
        // Do nothing - functions have no path
      } else if (typeOnly) {
        stdout += "function\n";
      } else {
        // Get the function body for display
        const funcDef = ctx.state.functions.get(name);
        const funcSource = funcDef
          ? formatFunctionSource(name, funcDef)
          : `${name} is a function\n`;
        stdout += funcSource;
      }
      foundAny = true;
    }

    // Check aliases
    // Aliases are stored in env with BASH_ALIAS_ prefix
    const alias = ctx.state.env.get(`BASH_ALIAS_${name}`);
    const hasAlias = alias !== undefined;
    if (hasAlias && (showAll || !foundAny)) {
      // -p: print nothing for aliases (no path), but count as "found"
      if (pathOnly) {
        // Do nothing - aliases have no path
      } else if (typeOnly) {
        stdout += "alias\n";
      } else {
        stdout += `${name} is aliased to \`${alias}'\n`;
      }
      foundAny = true;
      if (!showAll) {
        // Not showing all, continue to next name
        continue;
      }
    }

    // Check keywords
    const hasKeyword = SHELL_KEYWORDS.has(name);
    if (hasKeyword && (showAll || !foundAny)) {
      // -p: print nothing for keywords (no path), but count as "found"
      if (pathOnly) {
        // Do nothing - keywords have no path
      } else if (typeOnly) {
        stdout += "keyword\n";
      } else {
        stdout += `${name} is a shell keyword\n`;
      }
      foundAny = true;
      if (!showAll) {
        continue;
      }
    }

    // Check functions (for non-showAll case, functions come before builtins)
    // This matches bash behavior: alias, keyword, function, builtin, file
    if (!showAll && hasFunction && !foundAny) {
      // -p: print nothing for functions (no path), but count as "found"
      if (pathOnly) {
        // Do nothing - functions have no path
      } else if (typeOnly) {
        stdout += "function\n";
      } else {
        const funcDef = ctx.state.functions.get(name);
        const funcSource = funcDef
          ? formatFunctionSource(name, funcDef)
          : `${name} is a function\n`;
        stdout += funcSource;
      }
      foundAny = true;
      continue;
    }

    // Check builtins
    const hasBuiltin = SHELL_BUILTINS.has(name);
    if (hasBuiltin && (showAll || !foundAny)) {
      // -p: print nothing for builtins (no path), but count as "found"
      if (pathOnly) {
        // Do nothing - builtins have no path
      } else if (typeOnly) {
        stdout += "builtin\n";
      } else {
        stdout += `${name} is a shell builtin\n`;
      }
      foundAny = true;
      if (!showAll) {
        continue;
      }
    }

    // Check PATH for external command(s)
    if (showAll) {
      // Show all file paths
      const allPaths = await findCommandInPath(name);
      for (const pathResult of allPaths) {
        if (pathOnly) {
          stdout += `${pathResult}\n`;
        } else if (typeOnly) {
          stdout += "file\n";
        } else {
          stdout += `${name} is ${pathResult}\n`;
        }
        anyFileFound = true;
        foundAny = true;
      }
    } else if (!foundAny) {
      // Just find first
      const pathResult = await findFirstInPath(name);
      if (pathResult) {
        if (pathOnly) {
          stdout += `${pathResult}\n`;
        } else if (typeOnly) {
          stdout += "file\n";
        } else {
          stdout += `${name} is ${pathResult}\n`;
        }
        anyFileFound = true;
        foundAny = true;
      }
    }

    if (!foundAny) {
      // Name not found anywhere
      anyNotFound = true;
      if (!typeOnly && !pathOnly) {
        // For relative paths (containing /), if the file exists but isn't executable,
        // don't print "not found" - it was found, just not as an executable command.
        // Only print "not found" if the file doesn't exist at all.
        let shouldPrintError = true;
        if (name.includes("/")) {
          const resolvedPath = ctx.fs.resolvePath(ctx.state.cwd, name);
          if (await ctx.fs.exists(resolvedPath)) {
            // File exists but isn't executable - don't print error
            shouldPrintError = false;
          }
        }
        if (shouldPrintError) {
          stderr += `bash: type: ${name}: not found\n`;
        }
      }
    }
  }

  // Set exit code based on results
  // For -p: exit 1 only if no files were found AND there was something not found
  // For -P: exit 1 if any name wasn't found in PATH
  // For regular type and type -t: exit 1 if any name wasn't found
  if (pathOnly) {
    // -p: exit 1 only if no files were found AND there was something not found
    exitCode = anyNotFound && !anyFileFound ? 1 : 0;
  } else if (forcePathSearch) {
    // -P: exit 1 if any name wasn't found in PATH
    exitCode = anyNotFound ? 1 : 0;
  } else {
    // Regular type or type -t: exit 1 if any name wasn't found
    exitCode = anyNotFound ? 1 : 0;
  }

  return result(stdout, stderr, exitCode);
}

/**
 * Format a function definition for type output.
 * Produces bash-style output like:
 * f is a function
 * f ()
 * {
 *     echo
 * }
 */
function formatFunctionSource(name: string, funcDef: FunctionDefNode): string {
  // For function bodies that are Group nodes, unwrap them since we add { } ourselves
  let bodyStr: string;
  if (funcDef.body.type === "Group") {
    const group = funcDef.body as GroupNode;
    bodyStr = group.body.map((s) => serializeCompoundCommand(s)).join("; ");
  } else {
    bodyStr = serializeCompoundCommand(funcDef.body);
  }
  return `${name} is a function\n${name} () \n{ \n    ${bodyStr}\n}\n`;
}

/**
 * Serialize a compound command to its source representation.
 * This is a simplified serializer for function body display.
 */
function serializeCompoundCommand(
  node: CommandNode | StatementNode | StatementNode[],
): string {
  if (Array.isArray(node)) {
    return node.map((s) => serializeCompoundCommand(s)).join("; ");
  }

  if (node.type === "Statement") {
    const parts: string[] = [];
    for (let i = 0; i < node.pipelines.length; i++) {
      const pipeline = node.pipelines[i];
      parts.push(serializePipeline(pipeline));
      if (node.operators[i]) {
        parts.push(node.operators[i]);
      }
    }
    return parts.join(" ");
  }

  if (node.type === "SimpleCommand") {
    const cmd = node as SimpleCommandNode;
    const parts: string[] = [];
    if (cmd.name) {
      parts.push(serializeFunctionWord(cmd.name));
    }
    for (const arg of cmd.args) {
      parts.push(serializeFunctionWord(arg));
    }
    return parts.join(" ");
  }

  if (node.type === "Group") {
    const group = node as GroupNode;
    const body = group.body.map((s) => serializeCompoundCommand(s)).join("; ");
    return `{ ${body}; }`;
  }

  // For other compound commands, return a placeholder
  return "...";
}

function serializeFunctionWord(word: WordNode): string {
  return word.parts.map(serializeFunctionWordPart).join("");
}

function serializeFunctionWordPart(part: WordPart): string {
  switch (part.type) {
    case "Literal":
      return part.value;
    case "Escaped":
      return `\\${part.value}`;
    case "SingleQuoted":
      return `'${part.value}'`;
    case "DoubleQuoted":
      return `"${part.parts.map(serializeFunctionWordPart).join("")}"`;
    default:
      return serializeWord(AST.word([part]));
  }
}

function serializePipeline(pipeline: PipelineNode): string {
  const parts = pipeline.commands.map((cmd) => serializeCompoundCommand(cmd));
  return (pipeline.negated ? "! " : "") + parts.join(" | ");
}

/**
 * Handle `command -v` and `command -V` flags
 * -v: print the name or path of the command (simple output)
 * -V: print a description like `type` does (verbose output)
 */
export async function handleCommandV(
  ctx: TypeCommandContext,
  names: string[],
  _showPath: boolean,
  verboseDescribe: boolean,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  for (const name of names) {
    // Empty name is not found
    if (!name) {
      exitCode = 1;
      continue;
    }

    // Check aliases first (before other checks)
    const alias = ctx.state.env.get(`BASH_ALIAS_${name}`);
    if (alias !== undefined) {
      if (verboseDescribe) {
        stdout += `${name} is an alias for "${alias}"\n`;
      } else {
        stdout += `alias ${name}='${alias}'\n`;
      }
    } else if (SHELL_KEYWORDS.has(name)) {
      if (verboseDescribe) {
        stdout += `${name} is a shell keyword\n`;
      } else {
        stdout += `${name}\n`;
      }
    } else if (SHELL_BUILTINS.has(name)) {
      if (verboseDescribe) {
        stdout += `${name} is a shell builtin\n`;
      } else {
        stdout += `${name}\n`;
      }
    } else if (ctx.state.functions.has(name)) {
      if (verboseDescribe) {
        stdout += `${name} is a function\n`;
      } else {
        stdout += `${name}\n`;
      }
    } else if (name.includes("/")) {
      // Path containing / - check if file exists and is executable
      const resolvedPath = ctx.fs.resolvePath(ctx.state.cwd, name);
      let found = false;
      if (await ctx.fs.exists(resolvedPath)) {
        try {
          const stat = await ctx.fs.stat(resolvedPath);
          if (!stat.isDirectory) {
            // Check if file is executable (owner, group, or other execute bit set)
            const isExecutable = (stat.mode & 0o111) !== 0;
            if (isExecutable) {
              if (verboseDescribe) {
                stdout += `${name} is ${name}\n`;
              } else {
                stdout += `${name}\n`;
              }
              found = true;
            }
          }
        } catch {
          // If stat fails, treat as not found
        }
      }
      if (!found) {
        // Not found - for -V, print error to stderr
        if (verboseDescribe) {
          stderr += `${name}: not found\n`;
        }
        exitCode = 1;
      }
    } else {
      const foundPath = await findFirstInPath(ctx, name);
      if (foundPath) {
        if (verboseDescribe) {
          stdout += `${name} is ${foundPath}\n`;
        } else {
          stdout += `${foundPath}\n`;
        }
      } else {
        // Not found - for -V, print error to stderr (matches test at line 237-255)
        if (verboseDescribe) {
          stderr += `${name}: not found\n`;
        }
        exitCode = 1;
      }
    }
  }

  return result(stdout, stderr, exitCode);
}

/**
 * Find the first occurrence of a command in PATH.
 * Returns the full path if found, null otherwise.
 * Only returns executable files, not directories.
 */
export async function findFirstInPath(
  ctx: TypeCommandContext,
  name: string,
): Promise<string | null> {
  // If name contains /, it's a path - check if it exists and is executable
  if (name.includes("/")) {
    const resolvedPath = ctx.fs.resolvePath(ctx.state.cwd, name);
    if (await ctx.fs.exists(resolvedPath)) {
      // Check if it's a directory or not executable
      try {
        const stat = await ctx.fs.stat(resolvedPath);
        if (stat.isDirectory) {
          return null;
        }
        // Check if file is executable (owner, group, or other execute bit set)
        const isExecutable = (stat.mode & 0o111) !== 0;
        if (!isExecutable) {
          return null;
        }
      } catch {
        // If stat fails, assume it's not a valid path
        return null;
      }
      // Return the original path format (not resolved) to match bash behavior
      return name;
    }
    return null;
  }

  // Search PATH the way running the name does. Unlike bash, a file without
  // execute permission is not reported, since it cannot run.
  const match = await searchPath(ctx, name);
  if (match?.executable) {
    return match.displayPath;
  }

  // Fallback: check if command exists in registry
  // This handles virtual filesystems where commands are registered but
  // not necessarily present as individual files in /usr/bin
  if (ctx.commands.has(name) && !(await ctx.fs.exists("/usr/bin"))) {
    return `/usr/bin/${name}`;
  }

  return null;
}
