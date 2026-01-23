/**
 * Interpreter - AST Execution Engine
 *
 * Main interpreter class that executes bash AST nodes.
 * Delegates to specialized modules for:
 * - Word expansion (expansion.ts)
 * - Arithmetic evaluation (arithmetic.ts)
 * - Conditional evaluation (conditionals.ts)
 * - Built-in commands (builtins.ts)
 * - Redirections (redirections.ts)
 */

import type {
  ArithmeticCommandNode,
  CommandNode,
  ConditionalCommandNode,
  GroupNode,
  HereDocNode,
  PipelineNode,
  ScriptNode,
  SimpleCommandNode,
  StatementNode,
  SubshellNode,
  WordNode,
} from "../ast/types.js";
import { isBrowserExcludedCommand } from "../commands/browser-excluded.js";
import type { IFileSystem } from "../fs/interface.js";
import type { ExecutionLimits } from "../limits.js";
import type { SecureFetch } from "../network/index.js";
import { parseArithmeticExpression } from "../parser/arithmetic-parser.js";
import { Parser } from "../parser/parser.js";
import type {
  Command,
  CommandContext,
  CommandRegistry,
  ExecResult,
  TraceCallback,
} from "../types.js";
import { evaluateArithmetic, evaluateArithmeticSync } from "./arithmetic.js";
import {
  handleBreak,
  handleCd,
  handleContinue,
  handleDeclare,
  handleDirs,
  handleEval,
  handleExit,
  handleExport,
  handleGetopts,
  handleHash,
  handleLet,
  handleLocal,
  handleMapfile,
  handlePopd,
  handlePushd,
  handleRead,
  handleReadonly,
  handleReturn,
  handleSet,
  handleShift,
  handleSource,
  handleUnset,
  applyCaseTransform,
  isInteger,
} from "./builtins/index.js";
import { handleShopt } from "./builtins/shopt.js";
import { evaluateConditional, evaluateTestArgs } from "./conditionals.js";
import {
  executeCase,
  executeCStyleFor,
  executeFor,
  executeIf,
  executeUntil,
  executeWhile,
} from "./control-flow.js";

/**
 * POSIX special built-in commands.
 * In POSIX mode, these have special behaviors:
 * - Prefix assignments persist after the command
 * - Cannot be redefined as functions
 * - Errors may be fatal
 */
const POSIX_SPECIAL_BUILTINS = new Set([
  ":",
  ".",
  "break",
  "continue",
  "eval",
  "exec",
  "exit",
  "export",
  "readonly",
  "return",
  "set",
  "shift",
  "trap",
  "unset",
]);

/**
 * Check if a command name is a POSIX special built-in
 */
function isPosixSpecialBuiltin(name: string): boolean {
  return POSIX_SPECIAL_BUILTINS.has(name);
}

import {
  ArithmeticError,
  BadSubstitutionError,
  BreakError,
  ContinueError,
  ErrexitError,
  ExecutionLimitError,
  ExitError,
  GlobError,
  isScopeExitError,
  NounsetError,
  PosixFatalError,
  ReturnError,
  SubshellExitError,
} from "./errors.js";
import {
  expandWord,
  expandWordWithGlob,
  getArrayElements,
} from "./expansion.js";
import { callFunction, executeFunctionDef } from "./functions.js";
import {
  parseAssocArrayElement,
  wordToLiteralString,
} from "./helpers/array.js";
import { getErrorMessage } from "./helpers/errors.js";
import { isNameref, resolveNameref } from "./helpers/nameref.js";
import { checkReadonlyError } from "./helpers/readonly.js";
import {
  failure,
  OK,
  result,
  testResult,
  throwExecutionLimit,
} from "./helpers/result.js";
import { expandTildesInValue } from "./helpers/tilde.js";
import {
  applyRedirections,
  preOpenOutputRedirects,
  processFdVariableRedirections,
} from "./redirections.js";
import type { InterpreterContext, InterpreterState } from "./types.js";

export type { InterpreterContext, InterpreterState } from "./types.js";

export interface InterpreterOptions {
  fs: IFileSystem;
  commands: CommandRegistry;
  limits: Required<ExecutionLimits>;
  exec: (
    script: string,
    options?: { env?: Record<string, string>; cwd?: string },
  ) => Promise<ExecResult>;
  /** Optional secure fetch function for network-enabled commands */
  fetch?: SecureFetch;
  /** Optional sleep function for testing with mock clocks */
  sleep?: (ms: number) => Promise<void>;
  /** Optional trace callback for performance profiling */
  trace?: TraceCallback;
}

export class Interpreter {
  private ctx: InterpreterContext;

  constructor(options: InterpreterOptions, state: InterpreterState) {
    this.ctx = {
      state,
      fs: options.fs,
      commands: options.commands,
      limits: options.limits,
      execFn: options.exec,
      executeScript: this.executeScript.bind(this),
      executeStatement: this.executeStatement.bind(this),
      executeCommand: this.executeCommand.bind(this),
      fetch: options.fetch,
      sleep: options.sleep,
      trace: options.trace,
    };
  }

  // ===========================================================================
  // AST EXECUTION
  // ===========================================================================

  async executeScript(node: ScriptNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    for (const statement of node.statements) {
      try {
        const result = await this.executeStatement(statement);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
        this.ctx.state.lastExitCode = exitCode;
        this.ctx.state.env["?"] = String(exitCode);
      } catch (error) {
        // ExitError always propagates up to terminate the script
        // This allows 'eval exit 42' and 'source exit.sh' to exit properly
        if (error instanceof ExitError) {
          error.prependOutput(stdout, stderr);
          throw error;
        }
        // ExecutionLimitError must always propagate - these are safety limits
        if (error instanceof ExecutionLimitError) {
          throw error;
        }
        if (error instanceof ErrexitError) {
          stdout += error.stdout;
          stderr += error.stderr;
          exitCode = error.exitCode;
          this.ctx.state.lastExitCode = exitCode;
          this.ctx.state.env["?"] = String(exitCode);
          return { stdout, stderr, exitCode, env: { ...this.ctx.state.env } };
        }
        if (error instanceof NounsetError) {
          stdout += error.stdout;
          stderr += error.stderr;
          exitCode = 1;
          this.ctx.state.lastExitCode = exitCode;
          this.ctx.state.env["?"] = String(exitCode);
          return { stdout, stderr, exitCode, env: { ...this.ctx.state.env } };
        }
        if (error instanceof BadSubstitutionError) {
          stdout += error.stdout;
          stderr += error.stderr;
          exitCode = 1;
          this.ctx.state.lastExitCode = exitCode;
          this.ctx.state.env["?"] = String(exitCode);
          return { stdout, stderr, exitCode, env: { ...this.ctx.state.env } };
        }
        // Handle break/continue errors
        if (error instanceof BreakError || error instanceof ContinueError) {
          // If we're inside a loop, propagate the error up (for eval/source inside loops)
          if (this.ctx.state.loopDepth > 0) {
            error.prependOutput(stdout, stderr);
            throw error;
          }
          // Outside loops (level exceeded loop depth), silently continue with next statement
          stdout += error.stdout;
          stderr += error.stderr;
          continue;
        }
        // Handle return - prepend accumulated output before propagating
        if (error instanceof ReturnError) {
          error.prependOutput(stdout, stderr);
          throw error;
        }
        throw error;
      }
    }

    return { stdout, stderr, exitCode, env: { ...this.ctx.state.env } };
  }

  private async executeStatement(node: StatementNode): Promise<ExecResult> {
    this.ctx.state.commandCount++;
    if (this.ctx.state.commandCount > this.ctx.limits.maxCommandCount) {
      throwExecutionLimit(
        `too many commands executed (>${this.ctx.limits.maxCommandCount}), increase executionLimits.maxCommandCount`,
        "commands",
      );
    }

    // Reset errexitSafe at the start of each statement
    // It will be set by inner compound command executions if needed
    this.ctx.state.errexitSafe = false;

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let lastExecutedIndex = -1;
    let lastPipelineNegated = false;

    for (let i = 0; i < node.pipelines.length; i++) {
      const pipeline = node.pipelines[i];
      const operator = i > 0 ? node.operators[i - 1] : null;

      if (operator === "&&" && exitCode !== 0) continue;
      if (operator === "||" && exitCode === 0) continue;

      const result = await this.executePipeline(pipeline);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
      lastExecutedIndex = i;
      lastPipelineNegated = pipeline.negated;

      // Update $? after each pipeline so it's available for subsequent commands
      this.ctx.state.lastExitCode = exitCode;
      this.ctx.state.env["?"] = String(exitCode);
    }

    // Track whether this exit code is "safe" for errexit purposes
    // (i.e., the failure was from a && or || chain where the final command wasn't reached,
    // OR the failure came from a compound command where the inner statement was errexit-safe)
    const wasShortCircuited = lastExecutedIndex < node.pipelines.length - 1;
    // Preserve errexitSafe if it was set by an inner compound command
    const innerWasSafe = this.ctx.state.errexitSafe;
    this.ctx.state.errexitSafe =
      wasShortCircuited || lastPipelineNegated || innerWasSafe;

    // Check errexit (set -e): exit if command failed
    // Exceptions:
    // - Command was in a && or || list and wasn't the final command (short-circuit)
    // - Command was negated with !
    // - Command is part of a condition in if/while/until
    // - Exit code came from a compound command where inner execution was errexit-safe
    if (
      this.ctx.state.options.errexit &&
      exitCode !== 0 &&
      lastExecutedIndex === node.pipelines.length - 1 &&
      !lastPipelineNegated &&
      !this.ctx.state.inCondition &&
      !innerWasSafe
    ) {
      throw new ErrexitError(exitCode, stdout, stderr);
    }

    return result(stdout, stderr, exitCode);
  }

  private async executePipeline(node: PipelineNode): Promise<ExecResult> {
    let stdin = "";
    let lastResult: ExecResult = OK;
    let pipefailExitCode = 0; // Track rightmost failing command
    const pipestatusExitCodes: number[] = []; // Track all exit codes for PIPESTATUS

    for (let i = 0; i < node.commands.length; i++) {
      const command = node.commands[i];
      const isLast = i === node.commands.length - 1;

      let result: ExecResult;
      try {
        result = await this.executeCommand(command, stdin);
      } catch (error) {
        // BadSubstitutionError should fail the command but not abort the script
        if (error instanceof BadSubstitutionError) {
          result = {
            stdout: error.stdout,
            stderr: error.stderr,
            exitCode: 1,
          };
        }
        // In a MULTI-command pipeline, each command runs in a subshell context
        // So exit/return/errexit only affect that segment, not the whole script
        // For single commands, let these errors propagate to terminate the script
        else if (error instanceof ExitError && node.commands.length > 1) {
          result = {
            stdout: error.stdout,
            stderr: error.stderr,
            exitCode: error.exitCode,
          };
        } else if (error instanceof ErrexitError && node.commands.length > 1) {
          // Errexit inside a pipeline segment should only fail that segment
          // The pipeline's exit code comes from the last command (or pipefail)
          result = {
            stdout: error.stdout,
            stderr: error.stderr,
            exitCode: error.exitCode,
          };
        } else {
          throw error;
        }
      }

      // Track exit code for PIPESTATUS
      pipestatusExitCodes.push(result.exitCode);

      // Track the exit code of failing commands for pipefail
      if (result.exitCode !== 0) {
        pipefailExitCode = result.exitCode;
      }

      if (!isLast) {
        stdin = result.stdout;
        lastResult = {
          stdout: "",
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      } else {
        lastResult = result;
      }
    }

    // Set PIPESTATUS array with exit codes from all pipeline commands
    // Clear any previous PIPESTATUS entries
    for (const key of Object.keys(this.ctx.state.env)) {
      if (key.startsWith("PIPESTATUS_")) {
        delete this.ctx.state.env[key];
      }
    }
    // Set new PIPESTATUS entries
    for (let i = 0; i < pipestatusExitCodes.length; i++) {
      this.ctx.state.env[`PIPESTATUS_${i}`] = String(pipestatusExitCodes[i]);
    }
    this.ctx.state.env.PIPESTATUS__length = String(pipestatusExitCodes.length);

    // If pipefail is enabled, use the rightmost failing exit code
    if (this.ctx.state.options.pipefail && pipefailExitCode !== 0) {
      lastResult = {
        ...lastResult,
        exitCode: pipefailExitCode,
      };
    }

    if (node.negated) {
      lastResult = {
        ...lastResult,
        exitCode: lastResult.exitCode === 0 ? 1 : 0,
      };
    }

    return lastResult;
  }

  private async executeCommand(
    node: CommandNode,
    stdin: string,
  ): Promise<ExecResult> {
    switch (node.type) {
      case "SimpleCommand":
        return this.executeSimpleCommand(node, stdin);
      case "If":
        return executeIf(this.ctx, node);
      case "For":
        return executeFor(this.ctx, node);
      case "CStyleFor":
        return executeCStyleFor(this.ctx, node);
      case "While":
        return executeWhile(this.ctx, node, stdin);
      case "Until":
        return executeUntil(this.ctx, node);
      case "Case":
        return executeCase(this.ctx, node);
      case "Subshell":
        return this.executeSubshell(node, stdin);
      case "Group":
        return this.executeGroup(node, stdin);
      case "FunctionDef":
        return executeFunctionDef(this.ctx, node);
      case "ArithmeticCommand":
        return this.executeArithmeticCommand(node);
      case "ConditionalCommand":
        return this.executeConditionalCommand(node);
      default:
        return OK;
    }
  }

  // ===========================================================================
  // SIMPLE COMMAND EXECUTION
  // ===========================================================================

  private async executeSimpleCommand(
    node: SimpleCommandNode,
    stdin: string,
  ): Promise<ExecResult> {
    try {
      return await this.executeSimpleCommandInner(node, stdin);
    } catch (error) {
      if (error instanceof ArithmeticError) {
        // Arithmetic errors in expansion should not terminate the script
        // Just return exit code 1 with the error message on stderr
        return failure(error.stderr);
      }
      if (error instanceof GlobError) {
        // GlobError from failglob should return exit code 1 with error message
        return failure(error.stderr);
      }
      throw error;
    }
  }

  private async executeSimpleCommandInner(
    node: SimpleCommandNode,
    stdin: string,
  ): Promise<ExecResult> {
    // Update currentLine for $LINENO
    if (node.line !== undefined) {
      this.ctx.state.currentLine = node.line;
    }

    // Clear expansion stderr at the start
    this.ctx.state.expansionStderr = "";
    const tempAssignments: Record<string, string | undefined> = {};

    for (const assignment of node.assignments) {
      const name = assignment.name;

      // Handle array assignment: VAR=(a b c) or VAR+=(a b c)
      // Each element can be a glob that expands to multiple values
      if (assignment.array) {
        // Check if trying to assign array to subscripted element: a[0]=(1 2) is invalid
        // This should be a runtime error (exit code 1) not a parse error
        if (/\[.+\]$/.test(name)) {
          // Bash outputs to stderr and returns exit code 1
          return result(
            "",
            `bash: ${name}: cannot assign list to array member\n`,
            1,
          );
        }
        // Check if array variable is readonly
        const readonlyError = checkReadonlyError(this.ctx, name);
        if (readonlyError) return readonlyError;

        // Check if this is an associative array
        const isAssoc = this.ctx.state.associativeArrays?.has(name);

        // Check if elements use [key]=value syntax
        // This is detected by looking at the Word structure:
        // - First part is Glob with pattern like "[key]"
        // - Second part is Literal starting with "="
        const hasKeyedElements = assignment.array.some((element) => {
          if (element.parts.length >= 2) {
            const first = element.parts[0];
            const second = element.parts[1];
            return (
              first.type === "Glob" &&
              first.pattern.startsWith("[") &&
              first.pattern.endsWith("]") &&
              second.type === "Literal" &&
              second.value.startsWith("=")
            );
          }
          return false;
        });

        // Helper to clear existing array elements (called after expansion)
        const clearExistingElements = () => {
          const prefix = `${name}_`;
          for (const key of Object.keys(this.ctx.state.env)) {
            if (key.startsWith(prefix) && !key.includes("__")) {
              delete this.ctx.state.env[key];
            }
          }
        };

        if (isAssoc && hasKeyedElements) {
          // For associative arrays with keyed elements, expand first then clear
          // (keyed elements don't reference the array being assigned)
          if (!assignment.append) {
            clearExistingElements();
          }
          // Handle associative array with [key]=value syntax
          for (const element of assignment.array) {
            const literalStr = wordToLiteralString(element);
            const parsed = parseAssocArrayElement(literalStr);
            if (parsed) {
              const [key, rawValue] = parsed;
              // Apply tilde expansion to the value (e.g., ~ becomes $HOME)
              const value = expandTildesInValue(this.ctx, rawValue);
              this.ctx.state.env[`${name}_${key}`] = value;
            } else {
              // Fall back to treating as regular element (shouldn't happen for assoc)
              const expanded = await expandWordWithGlob(this.ctx, element);
              for (const val of expanded.values) {
                this.ctx.state.env[`${name}_${val}`] = "";
              }
            }
          }
        } else if (hasKeyedElements) {
          // Handle indexed array with [index]=value syntax (sparse array)
          // Clear existing elements first (keyed elements don't reference the array)
          if (!assignment.append) {
            clearExistingElements();
          }
          for (const element of assignment.array) {
            const literalStr = wordToLiteralString(element);
            const parsed = parseAssocArrayElement(literalStr);
            if (parsed) {
              const [indexStr, rawValue] = parsed;
              // Apply tilde expansion to the value (e.g., ~ becomes $HOME)
              const value = expandTildesInValue(this.ctx, rawValue);
              // Evaluate index as arithmetic expression
              let index: number;
              if (/^-?\d+$/.test(indexStr)) {
                index = Number.parseInt(indexStr, 10);
              } else {
                // Try to evaluate as variable or expression
                const varValue = this.ctx.state.env[indexStr];
                index = varValue ? Number.parseInt(varValue, 10) : 0;
                if (Number.isNaN(index)) index = 0;
              }
              this.ctx.state.env[`${name}_${index}`] = value;
            } else {
              // Fall back to sequential assignment
              const expanded = await expandWordWithGlob(this.ctx, element);
              const elements = getArrayElements(this.ctx, name);
              let nextIdx =
                elements.length > 0
                  ? Math.max(
                      ...elements.map(([idx]) =>
                        typeof idx === "number" ? idx : 0,
                      ),
                    ) + 1
                  : 0;
              for (const val of expanded.values) {
                this.ctx.state.env[`${name}_${nextIdx++}`] = val;
              }
            }
          }
        } else {
          // Regular array assignment without keyed elements
          // IMPORTANT: Expand elements FIRST (they may reference the current array)
          // then clear, then assign. e.g., a=(0 "${a[@]}" 1) should see old a[@]
          const allElements: string[] = [];
          for (const element of assignment.array) {
            const expanded = await expandWordWithGlob(this.ctx, element);
            allElements.push(...expanded.values);
          }

          // For append mode (+=), find the max existing index BEFORE clearing
          let startIndex = 0;
          if (assignment.append) {
            const elements = getArrayElements(this.ctx, name);
            if (elements.length > 0) {
              const maxIndex = Math.max(
                ...elements.map(([idx]) => (typeof idx === "number" ? idx : 0)),
              );
              startIndex = maxIndex + 1;
            }
          } else {
            // Clear existing elements AFTER expansion (self-reference already read)
            clearExistingElements();
          }

          for (let i = 0; i < allElements.length; i++) {
            this.ctx.state.env[`${name}_${startIndex + i}`] = allElements[i];
          }
          // Update length only for non-append (length tracking is not reliable with sparse arrays)
          if (!assignment.append) {
            this.ctx.state.env[`${name}__length`] = String(allElements.length);
          }
        }
        continue;
      }

      const value = assignment.value
        ? await expandWord(this.ctx, assignment.value)
        : "";

      // Check for empty subscript assignment: a[]=value is invalid
      const emptySubscriptMatch = name.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[\]$/);
      if (emptySubscriptMatch) {
        return result("", `bash: ${name}: bad array subscript\n`, 1);
      }

      // Check for array subscript assignment: a[subscript]=value
      const subscriptMatch = name.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
      if (subscriptMatch) {
        let arrayName = subscriptMatch[1];
        const subscriptExpr = subscriptMatch[2];

        // Check if arrayName is a nameref - if so, resolve it
        if (isNameref(this.ctx, arrayName)) {
          const resolved = resolveNameref(this.ctx, arrayName);
          if (resolved && resolved !== arrayName) {
            arrayName = resolved;
          }
        }

        // Check if array variable is readonly
        const readonlyError = checkReadonlyError(this.ctx, arrayName);
        if (readonlyError) return readonlyError;

        const isAssoc = this.ctx.state.associativeArrays?.has(arrayName);
        let envKey: string;

        if (isAssoc) {
          // For associative arrays, expand variables in subscript first, then use as key
          // e.g., foo["$key"]=value where key=bar should set foo_bar
          let key: string;
          if (subscriptExpr.startsWith("'") && subscriptExpr.endsWith("'")) {
            // Single-quoted: literal value, no expansion
            key = subscriptExpr.slice(1, -1);
          } else if (
            subscriptExpr.startsWith('"') &&
            subscriptExpr.endsWith('"')
          ) {
            // Double-quoted: expand variables inside
            const inner = subscriptExpr.slice(1, -1);
            const parser = new Parser();
            const wordNode = parser.parseWordFromString(inner, true, false);
            key = await expandWord(this.ctx, wordNode);
          } else if (subscriptExpr.includes("$")) {
            // Unquoted with variable reference
            const parser = new Parser();
            const wordNode = parser.parseWordFromString(
              subscriptExpr,
              false,
              false,
            );
            key = await expandWord(this.ctx, wordNode);
          } else {
            // Plain literal
            key = subscriptExpr;
          }
          envKey = `${arrayName}_${key}`;
        } else {
          // Evaluate subscript as arithmetic expression for indexed arrays
          // This handles: a[0], a[x], a[x+1], a[a[0]], a[b=2], etc.
          let index: number;
          if (/^-?\d+$/.test(subscriptExpr)) {
            // Simple numeric subscript
            index = Number.parseInt(subscriptExpr, 10);
          } else {
            // Parse and evaluate as arithmetic expression
            try {
              const parser = new Parser();
              const arithAst = parseArithmeticExpression(parser, subscriptExpr);
              index = evaluateArithmeticSync(this.ctx, arithAst.expression);
            } catch {
              // Fall back to variable lookup for backwards compatibility
              const varValue = this.ctx.state.env[subscriptExpr];
              index = varValue ? Number.parseInt(varValue, 10) : 0;
            }
            if (Number.isNaN(index)) index = 0;
          }

          // Handle negative indices - bash counts from max_index + 1
          if (index < 0) {
            const elements = getArrayElements(this.ctx, arrayName);
            if (elements.length === 0) {
              // Empty array with negative index - error
              const lineNum = this.ctx.state.currentLine;
              return result(
                "",
                `bash: line ${lineNum}: ${arrayName}[${subscriptExpr}]: bad array subscript\n`,
                1,
              );
            }
            // Find the maximum index
            const maxIndex = Math.max(
              ...elements.map(([idx]) => (typeof idx === "number" ? idx : 0)),
            );
            index = maxIndex + 1 + index;
            if (index < 0) {
              // Out-of-bounds negative index - return error result
              const lineNum = this.ctx.state.currentLine;
              return result(
                "",
                `bash: line ${lineNum}: ${arrayName}[${subscriptExpr}]: bad array subscript\n`,
                1,
              );
            }
          }

          envKey = `${arrayName}_${index}`;
        }

        // Handle append mode (+=)
        const finalValue = assignment.append
          ? (this.ctx.state.env[envKey] || "") + value
          : value;

        if (node.name) {
          tempAssignments[envKey] = this.ctx.state.env[envKey];
          this.ctx.state.env[envKey] = finalValue;
        } else {
          this.ctx.state.env[envKey] = finalValue;
        }
        continue;
      }

      // Resolve nameref: if name is a nameref, write to the target variable
      let targetName = name;
      if (isNameref(this.ctx, name)) {
        const resolved = resolveNameref(this.ctx, name);
        if (resolved === undefined) {
          // Circular nameref detected
          return result("", `bash: ${name}: circular name reference\n`, 1);
        }
        if (resolved !== name) {
          targetName = resolved;
        }
      }

      // Check if variable is readonly (for scalar assignment)
      const readonlyError = checkReadonlyError(this.ctx, targetName);
      if (readonlyError) return readonlyError;

      // Handle append mode (+=) and integer attribute
      let finalValue: string;
      if (isInteger(this.ctx, targetName)) {
        // For integer variables, evaluate as arithmetic
        try {
          const parser = new Parser();
          if (assignment.append) {
            // += for integers: add the values arithmetically
            const currentVal = this.ctx.state.env[targetName] || "0";
            const expr = `(${currentVal}) + (${value})`;
            const arithAst = parseArithmeticExpression(parser, expr);
            finalValue = String(
              evaluateArithmeticSync(this.ctx, arithAst.expression),
            );
          } else {
            const arithAst = parseArithmeticExpression(parser, value);
            finalValue = String(
              evaluateArithmeticSync(this.ctx, arithAst.expression),
            );
          }
        } catch {
          // If parsing fails, return 0 (bash behavior for invalid expressions)
          finalValue = "0";
        }
      } else {
        // Normal string handling
        finalValue = assignment.append
          ? (this.ctx.state.env[targetName] || "") + value
          : value;
      }

      if (node.name) {
        tempAssignments[targetName] = this.ctx.state.env[targetName];
        this.ctx.state.env[targetName] = finalValue;
      } else {
        this.ctx.state.env[targetName] = finalValue;
      }
    }

    if (!node.name) {
      // Assignment-only command: preserve the exit code from command substitution
      // e.g., x=$(false) should set $? to 1, not 0
      return result("", "", this.ctx.state.lastExitCode);
    }

    // Process FD variable redirections ({varname}>file syntax)
    // This allocates FDs and sets variables before command execution
    const fdVarError = await processFdVariableRedirections(
      this.ctx,
      node.redirections,
    );
    if (fdVarError) {
      for (const [name, value] of Object.entries(tempAssignments)) {
        if (value === undefined) delete this.ctx.state.env[name];
        else this.ctx.state.env[name] = value;
      }
      return fdVarError;
    }

    for (const redir of node.redirections) {
      if (
        (redir.operator === "<<" || redir.operator === "<<-") &&
        redir.target.type === "HereDoc"
      ) {
        const hereDoc = redir.target as HereDocNode;
        let content = await expandWord(this.ctx, hereDoc.content);
        // <<- strips leading tabs from each line
        if (hereDoc.stripTabs) {
          content = content
            .split("\n")
            .map((line) => line.replace(/^\t+/, ""))
            .join("\n");
        }
        // If this is a non-standard fd (not 0), store in fileDescriptors for -u option
        const fd = redir.fd ?? 0;
        if (fd !== 0) {
          if (!this.ctx.state.fileDescriptors) {
            this.ctx.state.fileDescriptors = new Map();
          }
          this.ctx.state.fileDescriptors.set(fd, content);
        } else {
          stdin = content;
        }
        continue;
      }

      if (redir.operator === "<<<" && redir.target.type === "Word") {
        stdin = `${await expandWord(this.ctx, redir.target as WordNode)}\n`;
        continue;
      }

      if (redir.operator === "<" && redir.target.type === "Word") {
        try {
          const target = await expandWord(this.ctx, redir.target as WordNode);
          const filePath = this.ctx.fs.resolvePath(this.ctx.state.cwd, target);
          stdin = await this.ctx.fs.readFile(filePath);
        } catch {
          const target = await expandWord(this.ctx, redir.target as WordNode);
          for (const [name, value] of Object.entries(tempAssignments)) {
            if (value === undefined) delete this.ctx.state.env[name];
            else this.ctx.state.env[name] = value;
          }
          return failure(`bash: ${target}: No such file or directory\n`);
        }
      }

      // Handle <& input redirection from file descriptor
      if (redir.operator === "<&" && redir.target.type === "Word") {
        const target = await expandWord(this.ctx, redir.target as WordNode);
        const sourceFd = Number.parseInt(target, 10);
        if (!Number.isNaN(sourceFd) && this.ctx.state.fileDescriptors) {
          const content = this.ctx.state.fileDescriptors.get(sourceFd);
          if (content !== undefined) {
            stdin = content;
          }
        }
      }
    }

    const commandName = await expandWord(this.ctx, node.name);

    const args: string[] = [];
    const quotedArgs: boolean[] = [];

    // Handle local/declare array assignments specially to preserve quote structure
    // For `local a=(1 "2 3")`, we need to process array elements from AST to keep quotes
    if (
      commandName === "local" ||
      commandName === "declare" ||
      commandName === "typeset"
    ) {
      for (const arg of node.args) {
        const arrayAssignResult = await this.expandLocalArrayAssignment(arg);
        if (arrayAssignResult) {
          args.push(arrayAssignResult);
          quotedArgs.push(true);
        } else {
          const expanded = await expandWordWithGlob(this.ctx, arg);
          for (const value of expanded.values) {
            args.push(value);
            quotedArgs.push(expanded.quoted);
          }
        }
      }
    } else {
      // Expand args even if command name is empty (they may have side effects)
      for (const arg of node.args) {
        const expanded = await expandWordWithGlob(this.ctx, arg);
        for (const value of expanded.values) {
          args.push(value);
          quotedArgs.push(expanded.quoted);
        }
      }
    }

    // Handle empty command name specially
    // If the command word contains ONLY command substitutions/expansions and expands
    // to empty, word-splitting removes the empty result. If there are args, the first
    // arg becomes the command name. This matches bash behavior:
    // - x=''; $x is a no-op (empty, no args)
    // - x=''; $x Y runs command Y (empty command name, Y becomes command)
    // - `true` X runs command X (since `true` outputs nothing)
    // However, a literal empty string (like '') is "command not found".
    if (!commandName) {
      const isOnlyExpansions = node.name.parts.every(
        (p) =>
          p.type === "CommandSubstitution" ||
          p.type === "ParameterExpansion" ||
          p.type === "ArithmeticExpansion",
      );
      if (isOnlyExpansions) {
        // Empty result from variable/command substitution - word split removes it
        // If there are args, the first arg becomes the command name
        if (args.length > 0) {
          const newCommandName = args.shift() as string;
          quotedArgs.shift();
          return await this.runCommand(newCommandName, args, quotedArgs, stdin);
        }
        // No args - treat as no-op (status 0)
        // Preserve lastExitCode for command subs like $(exit 42)
        return result("", "", this.ctx.state.lastExitCode);
      }
      // Literal empty command name - command not found
      return failure("bash: : command not found\n", 127);
    }

    let cmdResult = await this.runCommand(commandName, args, quotedArgs, stdin);
    cmdResult = await applyRedirections(this.ctx, cmdResult, node.redirections);

    // Update $_ to the last argument of this command (after expansion)
    // If no arguments, $_ is set to the command name
    this.ctx.state.lastArg =
      args.length > 0 ? args[args.length - 1] : commandName;

    // In POSIX mode, prefix assignments persist after special builtins
    // e.g., `foo=bar :` leaves foo=bar in the environment
    // Exception: `unset` and `eval` - bash doesn't apply POSIX temp binding persistence
    // for these builtins when they modify the same variable as the temp binding
    // In non-POSIX mode (bash default), temp assignments are always restored
    const isPosixSpecialWithPersistence =
      isPosixSpecialBuiltin(commandName) &&
      commandName !== "unset" &&
      commandName !== "eval";
    const shouldRestoreTempAssignments =
      !this.ctx.state.options.posix || !isPosixSpecialWithPersistence;

    if (shouldRestoreTempAssignments) {
      for (const [name, value] of Object.entries(tempAssignments)) {
        if (value === undefined) delete this.ctx.state.env[name];
        else this.ctx.state.env[name] = value;
      }
    }

    // Include any stderr from expansion errors
    if (this.ctx.state.expansionStderr) {
      cmdResult = {
        ...cmdResult,
        stderr: this.ctx.state.expansionStderr + cmdResult.stderr,
      };
      this.ctx.state.expansionStderr = "";
    }

    return cmdResult;
  }

  /**
   * Check if a Word represents an array assignment (name=(...)) and expand it
   * while preserving quote structure for elements.
   * Returns the expanded string like "name=(elem1 elem2 ...)" or null if not an array assignment.
   */
  private async expandLocalArrayAssignment(
    word: WordNode,
  ): Promise<string | null> {
    // First, join all parts to check if this looks like an array assignment
    const fullLiteral = word.parts
      .map((p) => (p.type === "Literal" ? p.value : "\x00"))
      .join("");
    const arrayMatch = fullLiteral.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=\(/);
    if (!arrayMatch || !fullLiteral.endsWith(")")) {
      return null;
    }

    const name = arrayMatch[1];
    const elements: string[] = [];
    let inArrayContent = false;
    let pendingLiteral = "";

    for (const part of word.parts) {
      if (part.type === "Literal") {
        let value = part.value;
        if (!inArrayContent) {
          // Look for =( to start array content
          const idx = value.indexOf("=(");
          if (idx !== -1) {
            inArrayContent = true;
            value = value.slice(idx + 2);
          }
        }

        if (inArrayContent) {
          // Check for closing )
          if (value.endsWith(")")) {
            value = value.slice(0, -1);
          }

          // Process literal content: split by whitespace
          // But handle the case where this literal is adjacent to a quoted part
          const tokens = value.split(/(\s+)/);
          for (const token of tokens) {
            if (/^\s+$/.test(token)) {
              // Whitespace - push pending element
              if (pendingLiteral) {
                elements.push(pendingLiteral);
                pendingLiteral = "";
              }
            } else if (token) {
              // Non-empty token - accumulate
              pendingLiteral += token;
            }
          }
        }
      } else if (inArrayContent) {
        // Quoted/expansion part - expand it and accumulate as single element
        const expanded = await expandWord(this.ctx, {
          type: "Word",
          parts: [part],
        });
        pendingLiteral += expanded;
      }
    }

    // Push final element
    if (pendingLiteral) {
      elements.push(pendingLiteral);
    }

    // Build result string with proper quoting
    const quotedElements = elements.map((elem) => {
      // Don't quote keyed elements like ['key']=value or [index]=value
      // These need to be parsed by the declare builtin as-is
      if (/^\[.+\]=/.test(elem)) {
        return elem;
      }
      // If element contains whitespace or special chars, quote it
      if (
        /[\s"'\\$`!*?[\]{}|&;<>()]/.test(elem) &&
        !elem.startsWith("'") &&
        !elem.startsWith('"')
      ) {
        // Use single quotes, escaping existing single quotes
        return `'${elem.replace(/'/g, "'\\''")}'`;
      }
      return elem;
    });

    return `${name}=(${quotedElements.join(" ")})`;
  }

  private async runCommand(
    commandName: string,
    args: string[],
    _quotedArgs: boolean[],
    stdin: string,
    skipFunctions = false,
    useDefaultPath = false,
  ): Promise<ExecResult> {
    // Built-in commands (special builtins that cannot be overridden by functions)
    if (commandName === "export") {
      return handleExport(this.ctx, args);
    }
    if (commandName === "unset") {
      return handleUnset(this.ctx, args);
    }
    if (commandName === "exit") {
      return handleExit(this.ctx, args);
    }
    if (commandName === "local") {
      return handleLocal(this.ctx, args);
    }
    if (commandName === "set") {
      return handleSet(this.ctx, args);
    }
    if (commandName === "break") {
      return handleBreak(this.ctx, args);
    }
    if (commandName === "continue") {
      return handleContinue(this.ctx, args);
    }
    if (commandName === "return") {
      return handleReturn(this.ctx, args);
    }
    if (commandName === "eval") {
      return handleEval(this.ctx, args);
    }
    if (commandName === "shift") {
      return handleShift(this.ctx, args);
    }
    if (commandName === "getopts") {
      return handleGetopts(this.ctx, args);
    }
    if (commandName === "pushd") {
      return await handlePushd(this.ctx, args);
    }
    if (commandName === "popd") {
      return handlePopd(this.ctx, args);
    }
    if (commandName === "dirs") {
      return handleDirs(this.ctx, args);
    }
    if (commandName === "source" || commandName === ".") {
      return handleSource(this.ctx, args);
    }
    if (commandName === "read") {
      return handleRead(this.ctx, args, stdin);
    }
    if (commandName === "mapfile" || commandName === "readarray") {
      return handleMapfile(this.ctx, args, stdin);
    }
    if (commandName === "declare" || commandName === "typeset") {
      return handleDeclare(this.ctx, args);
    }
    if (commandName === "readonly") {
      return handleReadonly(this.ctx, args);
    }
    // User-defined functions override most builtins (except special ones above)
    // This needs to happen before true/false/let which are regular builtins
    if (!skipFunctions) {
      const func = this.ctx.state.functions.get(commandName);
      if (func) {
        return callFunction(this.ctx, func, args, stdin);
      }
    }
    // Simple builtins (can be overridden by functions)
    if (commandName === "cd") {
      return await handleCd(this.ctx, args);
    }
    if (commandName === ":" || commandName === "true") {
      return OK;
    }
    if (commandName === "false") {
      return testResult(false);
    }
    if (commandName === "let") {
      return handleLet(this.ctx, args);
    }
    if (commandName === "command") {
      // command [-pVv] command [arg...] - run command, bypassing functions
      if (args.length === 0) {
        return OK;
      }
      // Parse options
      let useDefaultPath = false; // -p flag
      let verboseDescribe = false; // -V flag (like type)
      let showPath = false; // -v flag (show path/name)
      let cmdArgs = args;

      while (cmdArgs.length > 0 && cmdArgs[0].startsWith("-")) {
        const opt = cmdArgs[0];
        if (opt === "--") {
          cmdArgs = cmdArgs.slice(1);
          break;
        }
        // Handle combined options like -pv, -vV, etc.
        for (const char of opt.slice(1)) {
          if (char === "p") {
            useDefaultPath = true;
          } else if (char === "V") {
            verboseDescribe = true;
          } else if (char === "v") {
            showPath = true;
          }
        }
        cmdArgs = cmdArgs.slice(1);
      }

      if (cmdArgs.length === 0) {
        return OK;
      }

      // Handle -v and -V: describe commands without executing
      if (showPath || verboseDescribe) {
        return this.handleCommandV(cmdArgs, showPath, verboseDescribe);
      }

      // Run command without checking functions, but builtins are still available
      // Pass useDefaultPath to use /bin:/usr/bin instead of $PATH
      const [cmd, ...rest] = cmdArgs;
      return this.runCommand(cmd, rest, [], stdin, true, useDefaultPath);
    }
    if (commandName === "builtin") {
      // builtin command [arg...] - run builtin command
      if (args.length === 0) {
        return OK;
      }
      // Handle -- option terminator
      let cmdArgs = args;
      if (cmdArgs[0] === "--") {
        cmdArgs = cmdArgs.slice(1);
        if (cmdArgs.length === 0) {
          return OK;
        }
      }
      const cmd = cmdArgs[0];
      // Check if the command is a shell builtin
      const builtins = new Set([
        ":",
        "true",
        "false",
        "cd",
        "export",
        "unset",
        "exit",
        "local",
        "set",
        "break",
        "continue",
        "return",
        "eval",
        "shift",
        "getopts",
        "pushd",
        "popd",
        "dirs",
        "source",
        ".",
        "read",
        "mapfile",
        "readarray",
        "declare",
        "typeset",
        "readonly",
        "let",
        "command",
        "shopt",
        "exec",
        "test",
        "[",
        "echo",
        "printf",
        "pwd",
        "alias",
        "unalias",
        "type",
        "hash",
        "ulimit",
        "umask",
        "trap",
        "times",
        "wait",
        "kill",
        "jobs",
        "fg",
        "bg",
        "disown",
        "suspend",
        "fc",
        "history",
        "help",
        "enable",
        "builtin",
        "caller",
      ]);
      if (!builtins.has(cmd)) {
        // Not a builtin - return error
        return failure(`bash: builtin: ${cmd}: not a shell builtin\n`);
      }
      const [, ...rest] = cmdArgs;
      // Run as builtin (recursive call, skip function lookup)
      return this.runCommand(cmd, rest, [], stdin, true);
    }
    if (commandName === "shopt") {
      return handleShopt(this.ctx, args);
    }
    if (commandName === "exec") {
      // exec - replace shell with command (stub: just run the command)
      if (args.length === 0) {
        return OK;
      }
      const [cmd, ...rest] = args;
      return this.runCommand(cmd, rest, [], stdin);
    }
    if (commandName === "wait") {
      // wait - wait for background jobs (stub: no-op in this context)
      return OK;
    }
    if (commandName === "type") {
      // type - describe commands
      return await this.handleType(args);
    }
    if (commandName === "hash") {
      return handleHash(this.ctx, args);
    }
    // Test commands
    // Note: [[ is NOT handled here because it's a keyword, not a command.
    // When [[ appears as a simple command name (e.g., after prefix assignments
    // like "FOO=bar [[ ... ]]" or via variable expansion like "$x" where x='[['),
    // it should fail with "command not found" because bash doesn't recognize
    // [[ as a keyword in those contexts.
    if (commandName === "[" || commandName === "test") {
      let testArgs = args;
      if (commandName === "[") {
        if (args[args.length - 1] !== "]") {
          return failure("[: missing `]'\n", 2);
        }
        testArgs = args.slice(0, -1);
      }
      return evaluateTestArgs(this.ctx, testArgs);
    }

    // External commands - resolve via PATH
    // For command -p, use default PATH /bin:/usr/bin instead of $PATH
    const defaultPath = "/bin:/usr/bin";
    const resolved = await this.resolveCommand(
      commandName,
      useDefaultPath ? defaultPath : undefined,
    );
    if (!resolved) {
      // Check if this is a browser-excluded command for a more helpful error
      if (isBrowserExcludedCommand(commandName)) {
        return failure(
          `bash: ${commandName}: command not available in browser environments. ` +
            `Exclude '${commandName}' from your commands or use the Node.js bundle.\n`,
          127,
        );
      }
      return failure(`bash: ${commandName}: command not found\n`, 127);
    }
    const { cmd, path: cmdPath } = resolved;
    // cmdPath is available for future use (e.g., $0 in scripts)
    void cmdPath;

    // Use groupStdin as fallback if no stdin from redirections/pipeline
    // This is needed for commands inside groups/functions that receive stdin via heredoc
    const effectiveStdin = stdin || this.ctx.state.groupStdin || "";

    const cmdCtx: CommandContext = {
      fs: this.ctx.fs,
      cwd: this.ctx.state.cwd,
      env: this.ctx.state.env,
      stdin: effectiveStdin,
      limits: this.ctx.limits,
      exec: this.ctx.execFn,
      fetch: this.ctx.fetch,
      getRegisteredCommands: () => Array.from(this.ctx.commands.keys()),
      sleep: this.ctx.sleep,
      trace: this.ctx.trace,
      fileDescriptors: this.ctx.state.fileDescriptors,
    };

    try {
      return await cmd.execute(args, cmdCtx);
    } catch (error) {
      return failure(`${commandName}: ${getErrorMessage(error)}\n`);
    }
  }

  // ===========================================================================
  // PATH-BASED COMMAND RESOLUTION
  // ===========================================================================

  /**
   * Resolve a command name to its implementation via PATH lookup.
   * Returns the command and its resolved path, or null if not found.
   *
   * Resolution order:
   * 1. If command contains "/", resolve as a path
   * 2. Search PATH directories for the command file
   * 3. Fall back to registry lookup (for non-InMemoryFs filesystems like OverlayFs)
   */
  private async resolveCommand(
    commandName: string,
    pathOverride?: string,
  ): Promise<{ cmd: Command; path: string } | null> {
    // If command contains "/", it's a path - resolve directly
    if (commandName.includes("/")) {
      const resolvedPath = this.ctx.fs.resolvePath(
        this.ctx.state.cwd,
        commandName,
      );
      // Check if file exists
      if (!(await this.ctx.fs.exists(resolvedPath))) {
        return null;
      }
      // Extract command name from path
      const cmdName = resolvedPath.split("/").pop() || commandName;
      const cmd = this.ctx.commands.get(cmdName);
      if (!cmd) return null;
      return { cmd, path: resolvedPath };
    }

    // Search PATH directories (use override if provided, for command -p)
    const pathEnv = pathOverride ?? this.ctx.state.env.PATH ?? "/bin:/usr/bin";
    const pathDirs = pathEnv.split(":");

    for (const dir of pathDirs) {
      if (!dir) continue;
      const fullPath = `${dir}/${commandName}`;
      if (await this.ctx.fs.exists(fullPath)) {
        // File exists - look up command implementation
        const cmd = this.ctx.commands.get(commandName);
        if (cmd) {
          return { cmd, path: fullPath };
        }
      }
    }

    // Fallback: check registry directly only if /bin doesn't exist
    // This maintains backward compatibility for OverlayFs and other non-InMemoryFs
    // where command stubs aren't created, while still respecting PATH for InMemoryFs
    const binExists = await this.ctx.fs.exists("/bin");
    if (!binExists) {
      const cmd = this.ctx.commands.get(commandName);
      if (cmd) {
        return { cmd, path: `/bin/${commandName}` };
      }
    }

    return null;
  }

  /**
   * Find all paths for a command in PATH (for `which -a`).
   */
  async findCommandInPath(commandName: string): Promise<string[]> {
    const paths: string[] = [];
    const pathEnv = this.ctx.state.env.PATH || "/bin:/usr/bin";
    const pathDirs = pathEnv.split(":");

    for (const dir of pathDirs) {
      if (!dir) continue;
      const fullPath = `${dir}/${commandName}`;
      if (await this.ctx.fs.exists(fullPath)) {
        paths.push(fullPath);
      }
    }

    return paths;
  }

  // ===========================================================================
  // TYPE COMMAND
  // ===========================================================================

  private async handleType(args: string[]): Promise<ExecResult> {
    // Shell keywords
    const keywords = new Set([
      "if",
      "then",
      "else",
      "elif",
      "fi",
      "case",
      "esac",
      "for",
      "select",
      "while",
      "until",
      "do",
      "done",
      "in",
      "function",
      "{",
      "}",
      "time",
      "[[",
      "]]",
      "!",
    ]);

    // Shell builtins
    const builtins = new Set([
      "cd",
      "export",
      "unset",
      "exit",
      "local",
      "set",
      "break",
      "continue",
      "return",
      "eval",
      "shift",
      "source",
      ".",
      "read",
      "declare",
      "typeset",
      "readonly",
      ":",
      "true",
      "false",
      "let",
      "command",
      "builtin",
      "shopt",
      "exec",
      "wait",
      "type",
      "[",
      "test",
      "echo",
      "printf",
      "getopts",
      "hash",
      "ulimit",
      "umask",
      "alias",
      "unalias",
      "dirs",
      "pushd",
      "popd",
      "mapfile",
      "readarray",
    ]);

    // Parse options
    let typeOnly = false; // -t flag: print only the type word
    let pathOnly = false; // -p flag: print only paths to executables (respects aliases/functions/builtins)
    let forcePathSearch = false; // -P flag: force PATH search (ignores aliases/functions/builtins)
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
          }
          // Ignore -a, -f flags (not fully implemented)
        }
      } else {
        names.push(arg);
      }
    }

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let anyFound = false; // Track if any name was found (for -p/-P exit code)

    for (const name of names) {
      // -P flag: force PATH search, ignoring aliases/functions/builtins
      if (forcePathSearch) {
        const pathResult = await this.findFirstInPath(name);
        if (pathResult) {
          stdout += `${pathResult}\n`;
          anyFound = true;
        }
        // For -P, don't print anything if not found in PATH
        continue;
      }

      // Check aliases first (before other checks)
      // Aliases are stored in env with BASH_ALIAS_ prefix
      const alias = this.ctx.state.env[`BASH_ALIAS_${name}`];
      if (alias !== undefined) {
        // -p: print nothing for aliases (no path)
        if (pathOnly) {
          // Do nothing - aliases have no path
        } else if (typeOnly) {
          stdout += "alias\n";
        } else {
          stdout += `${name} is aliased to \`${alias}'\n`;
        }
        anyFound = true;
      } else if (keywords.has(name)) {
        // -p: print nothing for keywords (no path)
        if (pathOnly) {
          // Do nothing - keywords have no path
        } else if (typeOnly) {
          stdout += "keyword\n";
        } else {
          stdout += `${name} is a shell keyword\n`;
        }
        anyFound = true;
      } else if (builtins.has(name)) {
        // -p: print nothing for builtins (no path)
        if (pathOnly) {
          // Do nothing - builtins have no path
        } else if (typeOnly) {
          stdout += "builtin\n";
        } else {
          stdout += `${name} is a shell builtin\n`;
        }
        anyFound = true;
      } else if (this.ctx.state.functions.has(name)) {
        // -p: print nothing for functions (no path)
        if (pathOnly) {
          // Do nothing - functions have no path
        } else if (typeOnly) {
          stdout += "function\n";
        } else {
          stdout += `${name} is a function\n`;
        }
        anyFound = true;
      } else {
        // Check PATH for external command
        const pathResult = await this.findFirstInPath(name);
        if (pathResult) {
          if (pathOnly) {
            stdout += `${pathResult}\n`;
          } else if (typeOnly) {
            stdout += "file\n";
          } else {
            stdout += `${name} is ${pathResult}\n`;
          }
          anyFound = true;
        } else {
          if (!typeOnly && !pathOnly) {
            stderr += `bash: type: ${name}: not found\n`;
          }
        }
      }
    }

    // Set exit code based on whether anything was found
    // For -p and -P: exit code 1 if no files were found
    // For regular type: exit code 1 if any name wasn't found
    if (pathOnly || forcePathSearch) {
      exitCode = anyFound ? 0 : 1;
    } else {
      // Check if any names were not found (stderr will have errors for them)
      exitCode = stderr ? 1 : 0;
    }

    return result(stdout, stderr, exitCode);
  }

  /**
   * Find the first occurrence of a command in PATH.
   * Returns the full path if found, null otherwise.
   * Only returns executable files, not directories.
   */
  private async findFirstInPath(name: string): Promise<string | null> {
    // If name contains /, it's a path - check if it exists and is executable
    if (name.includes("/")) {
      const resolvedPath = this.ctx.fs.resolvePath(this.ctx.state.cwd, name);
      if (await this.ctx.fs.exists(resolvedPath)) {
        // Check if it's a directory
        try {
          const stat = await this.ctx.fs.stat(resolvedPath);
          if (stat.isDirectory()) {
            return null;
          }
        } catch {
          // If stat fails, assume it's not a valid path
          return null;
        }
        return resolvedPath;
      }
      return null;
    }

    // Search PATH directories
    const pathEnv = this.ctx.state.env.PATH ?? "/bin:/usr/bin";
    const pathDirs = pathEnv.split(":");

    for (const dir of pathDirs) {
      if (!dir) continue;
      const fullPath = `${dir}/${name}`;
      if (await this.ctx.fs.exists(fullPath)) {
        // Check if it's a directory
        try {
          const stat = await this.ctx.fs.stat(fullPath);
          if (stat.isDirectory()) {
            continue; // Skip directories
          }
        } catch {
          // If stat fails, skip this path
          continue;
        }
        return fullPath;
      }
    }

    // Fallback: check if command exists in registry (for OverlayFs compatibility)
    const binExists = await this.ctx.fs.exists("/bin");
    if (!binExists && this.ctx.commands.has(name)) {
      return `/bin/${name}`;
    }

    return null;
  }

  /**
   * Handle `command -v` and `command -V` flags
   * -v: print the name or path of the command (simple output)
   * -V: print a description like `type` does (verbose output)
   */
  private handleCommandV(
    names: string[],
    _showPath: boolean,
    verboseDescribe: boolean,
  ): ExecResult {
    // Shell keywords
    const keywords = new Set([
      "if",
      "then",
      "else",
      "elif",
      "fi",
      "case",
      "esac",
      "for",
      "select",
      "while",
      "until",
      "do",
      "done",
      "in",
      "function",
      "{",
      "}",
      "time",
      "[[",
      "]]",
      "!",
    ]);

    // Shell builtins
    const builtins = new Set([
      "cd",
      "export",
      "unset",
      "exit",
      "local",
      "set",
      "break",
      "continue",
      "return",
      "eval",
      "shift",
      "source",
      ".",
      "read",
      "declare",
      "typeset",
      "readonly",
      ":",
      "true",
      "false",
      "let",
      "command",
      "builtin",
      "shopt",
      "exec",
      "wait",
      "type",
      "[",
      "test",
      "echo",
      "printf",
      "getopts",
      "hash",
      "ulimit",
      "umask",
      "alias",
      "unalias",
      "dirs",
      "pushd",
      "popd",
      "mapfile",
      "readarray",
    ]);

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
      const alias = this.ctx.state.env[`BASH_ALIAS_${name}`];
      if (alias !== undefined) {
        if (verboseDescribe) {
          stdout += `${name} is aliased to \`${alias}'\n`;
        } else {
          stdout += `alias ${name}='${alias}'\n`;
        }
      } else if (keywords.has(name)) {
        if (verboseDescribe) {
          stdout += `${name} is a shell keyword\n`;
        } else {
          stdout += `${name}\n`;
        }
      } else if (builtins.has(name)) {
        if (verboseDescribe) {
          stdout += `${name} is a shell builtin\n`;
        } else {
          stdout += `${name}\n`;
        }
      } else if (this.ctx.state.functions.has(name)) {
        if (verboseDescribe) {
          stdout += `${name} is a function\n`;
        } else {
          stdout += `${name}\n`;
        }
      } else if (this.ctx.commands.has(name)) {
        if (verboseDescribe) {
          stdout += `${name} is /bin/${name}\n`;
        } else {
          stdout += `/bin/${name}\n`;
        }
      } else {
        // Not found - don't print anything for -v, print error to stderr for -V
        if (verboseDescribe) {
          stderr += `bash: ${name}: not found\n`;
        }
        exitCode = 1;
      }
    }

    return result(stdout, stderr, exitCode);
  }

  // ===========================================================================
  // SUBSHELL AND GROUP EXECUTION
  // ===========================================================================

  private async executeSubshell(
    node: SubshellNode,
    stdin = "",
  ): Promise<ExecResult> {
    // Pre-open output redirects to truncate files BEFORE executing body
    // This matches bash behavior where redirect files are opened before
    // any command substitutions in the subshell body are evaluated
    const preOpenError = await preOpenOutputRedirects(
      this.ctx,
      node.redirections,
    );
    if (preOpenError) {
      return preOpenError;
    }

    const savedEnv = { ...this.ctx.state.env };
    const savedCwd = this.ctx.state.cwd;
    // Save options so subshell changes (like set -e) don't affect parent
    const savedOptions = { ...this.ctx.state.options };
    // Reset loopDepth in subshell - break/continue should not affect parent loops
    const savedLoopDepth = this.ctx.state.loopDepth;
    // Track if parent has loop context - break/continue in subshell should exit subshell
    const savedParentHasLoopContext = this.ctx.state.parentHasLoopContext;
    this.ctx.state.parentHasLoopContext = savedLoopDepth > 0;
    this.ctx.state.loopDepth = 0;

    // Save any existing groupStdin and set new one from pipeline
    const savedGroupStdin = this.ctx.state.groupStdin;
    if (stdin) {
      this.ctx.state.groupStdin = stdin;
    }

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      for (const stmt of node.body) {
        const res = await this.executeStatement(stmt);
        stdout += res.stdout;
        stderr += res.stderr;
        exitCode = res.exitCode;
      }
    } catch (error) {
      this.ctx.state.env = savedEnv;
      this.ctx.state.cwd = savedCwd;
      this.ctx.state.options = savedOptions;
      this.ctx.state.loopDepth = savedLoopDepth;
      this.ctx.state.parentHasLoopContext = savedParentHasLoopContext;
      this.ctx.state.groupStdin = savedGroupStdin;
      // ExecutionLimitError must always propagate - these are safety limits
      if (error instanceof ExecutionLimitError) {
        throw error;
      }
      // SubshellExitError means break/continue was called when parent had loop context
      // This exits the subshell cleanly with exit code 0
      if (error instanceof SubshellExitError) {
        stdout += error.stdout;
        stderr += error.stderr;
        // Apply output redirections before returning
        const bodyResult = result(stdout, stderr, 0);
        return applyRedirections(this.ctx, bodyResult, node.redirections);
      }
      // BreakError/ContinueError should NOT propagate out of subshell
      // They only affect loops within the subshell
      if (error instanceof BreakError || error instanceof ContinueError) {
        stdout += error.stdout;
        stderr += error.stderr;
        // Apply output redirections before returning
        const bodyResult = result(stdout, stderr, 0);
        return applyRedirections(this.ctx, bodyResult, node.redirections);
      }
      // ExitError in subshell should NOT propagate - just return the exit code
      // (subshells are like separate processes)
      if (error instanceof ExitError) {
        stdout += error.stdout;
        stderr += error.stderr;
        // Apply output redirections before returning
        const bodyResult = result(stdout, stderr, error.exitCode);
        return applyRedirections(this.ctx, bodyResult, node.redirections);
      }
      // ReturnError in subshell (e.g., f() ( return 42; )) should also just exit
      // with the given code, since subshells are like separate processes
      if (error instanceof ReturnError) {
        stdout += error.stdout;
        stderr += error.stderr;
        // Apply output redirections before returning
        const bodyResult = result(stdout, stderr, error.exitCode);
        return applyRedirections(this.ctx, bodyResult, node.redirections);
      }
      if (error instanceof ErrexitError) {
        // Apply output redirections before propagating
        const bodyResult = result(
          stdout + error.stdout,
          stderr + error.stderr,
          error.exitCode,
        );
        return applyRedirections(this.ctx, bodyResult, node.redirections);
      }
      // Apply output redirections before returning
      const bodyResult = result(
        stdout,
        `${stderr}${getErrorMessage(error)}\n`,
        1,
      );
      return applyRedirections(this.ctx, bodyResult, node.redirections);
    }

    this.ctx.state.env = savedEnv;
    this.ctx.state.cwd = savedCwd;
    this.ctx.state.options = savedOptions;
    this.ctx.state.loopDepth = savedLoopDepth;
    this.ctx.state.parentHasLoopContext = savedParentHasLoopContext;
    this.ctx.state.groupStdin = savedGroupStdin;

    // Apply output redirections
    const bodyResult = result(stdout, stderr, exitCode);
    return applyRedirections(this.ctx, bodyResult, node.redirections);
  }

  private async executeGroup(node: GroupNode, stdin = ""): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    // Process FD variable redirections ({varname}>file syntax)
    const fdVarError = await processFdVariableRedirections(
      this.ctx,
      node.redirections,
    );
    if (fdVarError) {
      return fdVarError;
    }

    // Process heredoc and input redirections to get stdin content
    let effectiveStdin = stdin;
    for (const redir of node.redirections) {
      if (
        (redir.operator === "<<" || redir.operator === "<<-") &&
        redir.target.type === "HereDoc"
      ) {
        const hereDoc = redir.target as HereDocNode;
        let content = await expandWord(this.ctx, hereDoc.content);
        if (hereDoc.stripTabs) {
          content = content
            .split("\n")
            .map((line) => line.replace(/^\t+/, ""))
            .join("\n");
        }
        // If this is a non-standard fd (not 0), store in fileDescriptors for -u option
        const fd = redir.fd ?? 0;
        if (fd !== 0) {
          if (!this.ctx.state.fileDescriptors) {
            this.ctx.state.fileDescriptors = new Map();
          }
          this.ctx.state.fileDescriptors.set(fd, content);
        } else {
          effectiveStdin = content;
        }
      } else if (redir.operator === "<<<" && redir.target.type === "Word") {
        effectiveStdin = `${await expandWord(this.ctx, redir.target as WordNode)}\n`;
      } else if (redir.operator === "<" && redir.target.type === "Word") {
        try {
          const target = await expandWord(this.ctx, redir.target as WordNode);
          const filePath = this.ctx.fs.resolvePath(this.ctx.state.cwd, target);
          effectiveStdin = await this.ctx.fs.readFile(filePath);
        } catch {
          const target = await expandWord(this.ctx, redir.target as WordNode);
          return result("", `bash: ${target}: No such file or directory\n`, 1);
        }
      }
    }

    // Save any existing groupStdin and set new one from pipeline
    const savedGroupStdin = this.ctx.state.groupStdin;
    if (effectiveStdin) {
      this.ctx.state.groupStdin = effectiveStdin;
    }

    try {
      for (const stmt of node.body) {
        const result = await this.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }
    } catch (error) {
      // Restore groupStdin before handling error
      this.ctx.state.groupStdin = savedGroupStdin;
      // ExecutionLimitError must always propagate - these are safety limits
      if (error instanceof ExecutionLimitError) {
        throw error;
      }
      if (
        isScopeExitError(error) ||
        error instanceof ErrexitError ||
        error instanceof ExitError
      ) {
        error.prependOutput(stdout, stderr);
        throw error;
      }
      return result(stdout, `${stderr}${getErrorMessage(error)}\n`, 1);
    }

    // Restore groupStdin
    this.ctx.state.groupStdin = savedGroupStdin;

    // Apply output redirections
    const bodyResult = result(stdout, stderr, exitCode);
    return applyRedirections(this.ctx, bodyResult, node.redirections);
  }

  // ===========================================================================
  // COMPOUND COMMANDS
  // ===========================================================================

  private async executeArithmeticCommand(
    node: ArithmeticCommandNode,
  ): Promise<ExecResult> {
    try {
      const arithResult = await evaluateArithmetic(
        this.ctx,
        node.expression.expression,
      );
      return testResult(arithResult !== 0);
    } catch (error) {
      return failure(
        `bash: arithmetic expression: ${(error as Error).message}\n`,
      );
    }
  }

  private async executeConditionalCommand(
    node: ConditionalCommandNode,
  ): Promise<ExecResult> {
    // Update currentLine for error messages
    if (node.line !== undefined) {
      this.ctx.state.currentLine = node.line;
    }

    // Pre-open output redirects to truncate files BEFORE evaluating expression
    // This matches bash behavior where redirect files are opened before
    // any command substitutions in the conditional expression are evaluated
    const preOpenError = await preOpenOutputRedirects(
      this.ctx,
      node.redirections,
    );
    if (preOpenError) {
      return preOpenError;
    }

    try {
      const condResult = await evaluateConditional(this.ctx, node.expression);
      // Apply output redirections
      let bodyResult = testResult(condResult);
      // Include any stderr from expansion (e.g., bad array subscript warnings)
      if (this.ctx.state.expansionStderr) {
        bodyResult = {
          ...bodyResult,
          stderr: this.ctx.state.expansionStderr + bodyResult.stderr,
        };
        this.ctx.state.expansionStderr = "";
      }
      return applyRedirections(this.ctx, bodyResult, node.redirections);
    } catch (error) {
      // Apply output redirections before returning
      const bodyResult = failure(
        `bash: conditional expression: ${(error as Error).message}\n`,
        2,
      );
      return applyRedirections(this.ctx, bodyResult, node.redirections);
    }
  }
}
