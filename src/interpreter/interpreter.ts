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
import type { IFileSystem } from "../fs/interface.js";
import type { ExecutionLimits } from "../limits.js";
import type { SecureFetch } from "../network/index.js";
import { parseArithmeticExpression } from "../parser/arithmetic-parser.js";
import { Parser } from "../parser/parser.js";
import { ParseException } from "../parser/types.js";
import type { CommandRegistry, ExecResult, TraceCallback } from "../types.js";
import { expandAlias as expandAliasHelper } from "./alias-expansion.js";
import { evaluateArithmetic } from "./arithmetic.js";
import {
  expandLocalArrayAssignment as expandLocalArrayAssignmentHelper,
  expandScalarAssignmentArg as expandScalarAssignmentArgHelper,
} from "./assignment-expansion.js";
import {
  type BuiltinDispatchContext,
  dispatchBuiltin,
  executeExternalCommand,
} from "./builtin-dispatch.js";
import {
  applyCaseTransform,
  getLocalVarDepth,
  isInteger,
} from "./builtins/index.js";
import { findCommandInPath as findCommandInPathHelper } from "./command-resolution.js";
import { evaluateConditional } from "./conditionals.js";
import {
  executeCase,
  executeCStyleFor,
  executeFor,
  executeIf,
  executeUntil,
  executeWhile,
} from "./control-flow.js";
import {
  ArithmeticError,
  BadSubstitutionError,
  BraceExpansionError,
  BreakError,
  ContinueError,
  ErrexitError,
  ExecutionLimitError,
  ExitError,
  GlobError,
  NounsetError,
  PosixFatalError,
  ReturnError,
} from "./errors.js";
import {
  expandWord,
  expandWordWithGlob,
  getArrayElements,
  isArray,
} from "./expansion.js";
import { executeFunctionDef } from "./functions.js";
import {
  parseKeyedElementFromWord,
  wordToLiteralString,
} from "./helpers/array.js";
import {
  isWordLiteralMatch,
  parseRwFdContent,
} from "./helpers/interpreter-utils.js";
import {
  getNamerefTarget,
  isNameref,
  resolveNameref,
  resolveNamerefForAssignment,
} from "./helpers/nameref.js";
import { checkReadonlyError, isReadonly } from "./helpers/readonly.js";
import {
  failure,
  OK,
  result,
  testResult,
  throwExecutionLimit,
} from "./helpers/result.js";
import { isPosixSpecialBuiltin } from "./helpers/shell-constants.js";
import { expandTildesInValue } from "./helpers/tilde.js";
import { traceAssignment, traceSimpleCommand } from "./helpers/xtrace.js";
import { executePipeline as executePipelineHelper } from "./pipeline-execution.js";
import {
  applyRedirections,
  preOpenOutputRedirects,
  processFdVariableRedirections,
} from "./redirections.js";
import {
  executeGroup as executeGroupHelper,
  executeSubshell as executeSubshellHelper,
  executeUserScript as executeUserScriptHelper,
} from "./subshell-group.js";
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

  /**
   * Build environment record containing only exported variables.
   * In bash, only exported variables are passed to child processes.
   * This includes both permanently exported variables (via export/declare -x)
   * and temporarily exported variables (prefix assignments like FOO=bar cmd).
   */
  private buildExportedEnv(): Record<string, string> {
    const exportedVars = this.ctx.state.exportedVars;
    const tempExportedVars = this.ctx.state.tempExportedVars;

    // Combine both exported and temp exported vars
    const allExported = new Set<string>();
    if (exportedVars) {
      for (const name of exportedVars) {
        allExported.add(name);
      }
    }
    if (tempExportedVars) {
      for (const name of tempExportedVars) {
        allExported.add(name);
      }
    }

    if (allExported.size === 0) {
      // No exported vars - return empty env
      // This matches bash behavior where variables must be exported to be visible to children
      return {};
    }

    const env: Record<string, string> = {};
    for (const name of allExported) {
      const value = this.ctx.state.env[name];
      if (value !== undefined) {
        env[name] = value;
      }
    }
    return env;
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
        // PosixFatalError terminates the script in POSIX mode
        // POSIX 2.8.1: special builtins cause shell to exit on error
        if (error instanceof PosixFatalError) {
          stdout += error.stdout;
          stderr += error.stderr;
          exitCode = error.exitCode;
          this.ctx.state.lastExitCode = exitCode;
          this.ctx.state.env["?"] = String(exitCode);
          return { stdout, stderr, exitCode, env: { ...this.ctx.state.env } };
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
        // ArithmeticError in expansion (e.g., echo $((42x))) - the command fails
        // but the script continues execution. This matches bash behavior.
        if (error instanceof ArithmeticError) {
          stdout += error.stdout;
          stderr += error.stderr;
          exitCode = 1;
          this.ctx.state.lastExitCode = exitCode;
          this.ctx.state.env["?"] = String(exitCode);
          // Continue to next statement instead of terminating script
          continue;
        }
        // BraceExpansionError for invalid ranges (e.g., {z..A} mixed case) - the command fails
        // but the script continues execution. This matches bash behavior.
        if (error instanceof BraceExpansionError) {
          stdout += error.stdout;
          stderr += error.stderr;
          exitCode = 1;
          this.ctx.state.lastExitCode = exitCode;
          this.ctx.state.env["?"] = String(exitCode);
          // Continue to next statement instead of terminating script
          continue;
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

  /**
   * Execute a user script file found in PATH.
   */
  private async executeUserScript(
    scriptPath: string,
    args: string[],
    stdin = "",
  ): Promise<ExecResult> {
    return executeUserScriptHelper(this.ctx, scriptPath, args, stdin, (ast) =>
      this.executeScript(ast),
    );
  }

  private async executeStatement(node: StatementNode): Promise<ExecResult> {
    this.ctx.state.commandCount++;
    if (this.ctx.state.commandCount > this.ctx.limits.maxCommandCount) {
      throwExecutionLimit(
        `too many commands executed (>${this.ctx.limits.maxCommandCount}), increase executionLimits.maxCommandCount`,
        "commands",
      );
    }

    // Check for deferred syntax error. This is triggered when execution reaches
    // a statement that has a syntax error (like standalone `}`), but the error
    // was deferred to support bash's incremental parsing behavior.
    if (node.deferredError) {
      throw new ParseException(node.deferredError.message, node.line ?? 1, 1);
    }

    // noexec mode (set -n): parse commands but do not execute them
    // This is used for syntax checking scripts without actually running them
    if (this.ctx.state.options.noexec) {
      return OK;
    }

    // Reset errexitSafe at the start of each statement
    // It will be set by inner compound command executions if needed
    this.ctx.state.errexitSafe = false;

    let stdout = "";
    let stderr = "";

    // verbose mode (set -v): print unevaluated source before execution
    // Don't print verbose output inside command substitutions (suppressVerbose flag)
    if (
      this.ctx.state.options.verbose &&
      !this.ctx.state.suppressVerbose &&
      node.sourceText
    ) {
      stderr += `${node.sourceText}\n`;
    }
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
    return executePipelineHelper(this.ctx, node, (cmd, stdin) =>
      this.executeCommand(cmd, stdin),
    );
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
      if (error instanceof GlobError) {
        // GlobError from failglob should return exit code 1 with error message
        return failure(error.stderr);
      }
      // ArithmeticError in expansion (e.g., echo $((42x))) should terminate the script
      // Let the error propagate - it will be caught by the top-level error handler
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

    // Alias expansion: if expand_aliases is enabled and the command name is
    // a literal unquoted word that matches an alias, substitute it.
    // Keep expanding until no more alias expansion occurs (handles recursive aliases).
    // The aliasExpansionStack persists across iterations to prevent infinite loops.
    if (this.ctx.state.shoptOptions.expand_aliases && node.name) {
      let currentNode = node;
      let maxExpansions = 100; // Safety limit
      while (maxExpansions > 0) {
        const expandedNode = this.expandAlias(currentNode);
        if (expandedNode === currentNode) {
          break; // No expansion occurred
        }
        currentNode = expandedNode;
        maxExpansions--;
      }
      // Clear the alias expansion stack after all expansions are done
      this.aliasExpansionStack.clear();
      // Continue with the fully expanded node
      if (currentNode !== node) {
        node = currentNode;
      }
    }

    // Clear expansion stderr at the start
    this.ctx.state.expansionStderr = "";
    const tempAssignments: Record<string, string | undefined> = {};

    // Collect xtrace output for assignments
    let xtraceAssignmentOutput = "";

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

        // Check if name is a nameref - assigning an array to a nameref is complex
        if (isNameref(this.ctx, name)) {
          const target = getNamerefTarget(this.ctx, name);
          // If nameref has no target (unbound), array assignment is a hard error
          // This terminates the script with exit code 1
          if (target === undefined || target === "") {
            throw new ExitError(1, "", "");
          }
          const resolved = resolveNameref(this.ctx, name);
          if (resolved && /^[a-zA-Z_][a-zA-Z0-9_]*\[@\]$/.test(resolved)) {
            // Nameref points to array[@], can't assign list to it
            return result(
              "",
              `bash: ${name}: cannot assign list to array member\n`,
              1,
            );
          }
        }

        // Check if array variable is readonly
        // For prefix assignments (temp bindings) to readonly vars, bash warns but continues
        if (isReadonly(this.ctx, name)) {
          if (node.name) {
            // Temp binding to readonly var - warn but continue
            xtraceAssignmentOutput += `bash: ${name}: readonly variable\n`;
            continue; // Skip this assignment, process next one
          }
          const readonlyError = checkReadonlyError(this.ctx, name);
          if (readonlyError) return readonlyError;
        }

        // Check if this is an associative array
        const isAssoc = this.ctx.state.associativeArrays?.has(name);

        // Check if elements use [key]=value or [key]+=value syntax
        // This is detected by looking at the Word structure:
        // - First part is Glob with pattern like "[key]"
        // - Second part is Literal starting with "=" or "+="
        //
        // Special cases:
        // 1. Nested brackets like [a[0]]= are parsed as:
        //    - Glob with pattern "[a[0]" (ends with ] from inner bracket)
        //    - Literal with value "]=..." (the outer ] and the =)
        //
        // 2. Double-quoted keys like ["key"]= are parsed as:
        //    - Glob with pattern "[" (just the opening bracket)
        //    - DoubleQuoted with the key
        //    - Literal with value "]=" or "]+="
        const hasKeyedElements = assignment.array.some((element) => {
          if (element.parts.length >= 2) {
            const first = element.parts[0];
            const second = element.parts[1];
            if (first.type !== "Glob" || !first.pattern.startsWith("[")) {
              return false;
            }
            // Check for double/single-quoted key: ["key"]= or ['key']=
            if (
              first.pattern === "[" &&
              (second.type === "DoubleQuoted" || second.type === "SingleQuoted")
            ) {
              // Third part should be ]= or ]+=
              if (element.parts.length < 3) return false;
              const third = element.parts[2];
              if (third.type !== "Literal") return false;
              return (
                third.value.startsWith("]=") || third.value.startsWith("]+=")
              );
            }
            if (second.type !== "Literal") {
              return false;
            }
            // Check if this is a nested bracket case (second starts with ])
            // This happens when the glob pattern was truncated at an inner ]
            if (second.value.startsWith("]")) {
              // Nested bracket case: [a[0]]= where pattern ends at inner ]
              // The second part should be "]=..." or "]+=..."
              return (
                second.value.startsWith("]=") || second.value.startsWith("]+=")
              );
            }
            // Normal case: [key]= where pattern ends with ] and second starts with =
            if (first.pattern.endsWith("]")) {
              return (
                second.value.startsWith("=") || second.value.startsWith("+=")
              );
            }
            return false;
          }
          return false;
        });

        // Helper to clear existing array elements (called after expansion)
        // Also removes the scalar value since arrays can't be exported as scalars
        const clearExistingElements = () => {
          const prefix = `${name}_`;
          for (const key of Object.keys(this.ctx.state.env)) {
            if (key.startsWith(prefix) && !key.includes("__")) {
              delete this.ctx.state.env[key];
            }
          }
          // Remove scalar value - when a variable becomes an array,
          // its scalar value should be cleared (arrays can't be exported)
          delete this.ctx.state.env[name];
        };

        if (isAssoc && hasKeyedElements) {
          // Handle associative array with [key]=value or [key]+=value syntax
          // IMPORTANT: Expand all values FIRST (they may reference the current array),
          // then clear, then assign. e.g., foo=(["key"]="${foo["key"]} more")
          // should see the old foo["key"] value during expansion.
          interface PendingAssocElement {
            type: "keyed";
            key: string;
            value: string;
            append: boolean;
          }
          interface PendingAssocInvalid {
            type: "invalid";
            expandedValue: string;
          }
          const pendingAssocElements: (
            | PendingAssocElement
            | PendingAssocInvalid
          )[] = [];

          // First pass: Expand all values BEFORE clearing the array
          for (const element of assignment.array) {
            // Use parseKeyedElementFromWord to properly handle variable expansion
            const parsed = parseKeyedElementFromWord(element);
            if (parsed) {
              const { key, valueParts, append: elementAppend } = parsed;
              // Expand the value parts (this handles $v, ${v}, etc.)
              let value: string;
              if (valueParts.length > 0) {
                const valueWord: WordNode = { type: "Word", parts: valueParts };
                value = await expandWord(this.ctx, valueWord);
              } else {
                value = "";
              }
              // Apply tilde expansion if value starts with ~
              value = expandTildesInValue(this.ctx, value);
              pendingAssocElements.push({
                type: "keyed",
                key,
                value,
                append: elementAppend,
              });
            } else {
              // For associative arrays, elements without [key]=value syntax are invalid
              // Bash outputs a warning to stderr and continues (status 0)
              const expandedValue = await expandWord(this.ctx, element);
              pendingAssocElements.push({
                type: "invalid",
                expandedValue,
              });
            }
          }

          // Clear existing elements AFTER all expansion (for self-reference support)
          if (!assignment.append) {
            clearExistingElements();
          }

          // Second pass: Perform all assignments
          for (const pending of pendingAssocElements) {
            if (pending.type === "keyed") {
              if (pending.append) {
                // [key]+=value - append to existing value at this key
                const existing =
                  this.ctx.state.env[`${name}_${pending.key}`] ?? "";
                this.ctx.state.env[`${name}_${pending.key}`] =
                  existing + pending.value;
              } else {
                this.ctx.state.env[`${name}_${pending.key}`] = pending.value;
              }
            } else {
              // Format: bash: line N: arrayname: value: must use subscript when assigning associative array
              const lineNum = node.line ?? this.ctx.state.currentLine ?? 1;
              xtraceAssignmentOutput += `bash: line ${lineNum}: ${name}: ${pending.expandedValue}: must use subscript when assigning associative array\n`;
              // Continue processing other elements (don't throw error)
            }
          }
        } else if (hasKeyedElements) {
          // Handle indexed array with [index]=value or [index]+=value syntax (sparse array)
          // Bash evaluation order: First expand ALL RHS values, THEN evaluate ALL indices
          // This is important for cases like: a=([100+i++]=$((i++)) [200+i++]=$((i++)))
          // where i++ in RHS affects subsequent index evaluations

          // First pass: Expand all RHS values and collect them with their index expressions
          interface PendingElement {
            type: "keyed";
            indexExpr: string;
            value: string;
            append: boolean;
          }
          interface PendingNonKeyed {
            type: "non-keyed";
            values: string[];
          }
          const pendingElements: (PendingElement | PendingNonKeyed)[] = [];

          for (const element of assignment.array) {
            const parsed = parseKeyedElementFromWord(element);
            if (parsed) {
              const {
                key: indexExpr,
                valueParts,
                append: elementAppend,
              } = parsed;
              // Expand the value parts (this handles $v, ${v}, etc.)
              let value: string;
              if (valueParts.length > 0) {
                const valueWord: WordNode = { type: "Word", parts: valueParts };
                value = await expandWord(this.ctx, valueWord);
              } else {
                value = "";
              }
              // Apply tilde expansion if value starts with ~
              value = expandTildesInValue(this.ctx, value);
              pendingElements.push({
                type: "keyed",
                indexExpr,
                value,
                append: elementAppend,
              });
            } else {
              // Non-keyed element: expand now
              const expanded = await expandWordWithGlob(this.ctx, element);
              pendingElements.push({
                type: "non-keyed",
                values: expanded.values,
              });
            }
          }

          // Clear existing elements AFTER all RHS expansion (keyed elements don't reference the array)
          if (!assignment.append) {
            clearExistingElements();
          }

          // Second pass: Evaluate all indices and perform assignments
          // Track current index for implicit increment after [n]=value
          let currentIndex = 0;
          for (const pending of pendingElements) {
            if (pending.type === "keyed") {
              // Evaluate index as arithmetic expression
              let index: number;
              try {
                const parser = new Parser();
                const arithAst = parseArithmeticExpression(
                  parser,
                  pending.indexExpr,
                );
                // Use isExpansionContext=false for array subscripts
                index = await evaluateArithmetic(
                  this.ctx,
                  arithAst.expression,
                  false,
                );
              } catch {
                // If parsing fails, try simple fallbacks
                if (/^-?\d+$/.test(pending.indexExpr)) {
                  index = Number.parseInt(pending.indexExpr, 10);
                } else {
                  const varValue = this.ctx.state.env[pending.indexExpr];
                  index = varValue ? Number.parseInt(varValue, 10) : 0;
                  if (Number.isNaN(index)) index = 0;
                }
              }
              if (pending.append) {
                // [index]+=value - append to existing value at this index
                const existing = this.ctx.state.env[`${name}_${index}`] ?? "";
                this.ctx.state.env[`${name}_${index}`] =
                  existing + pending.value;
              } else {
                this.ctx.state.env[`${name}_${index}`] = pending.value;
              }
              // Update currentIndex to continue from this keyed index
              currentIndex = index + 1;
            } else {
              // Non-keyed element: use currentIndex and increment
              for (const val of pending.values) {
                this.ctx.state.env[`${name}_${currentIndex++}`] = val;
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
            } else if (this.ctx.state.env[name] !== undefined) {
              // Variable exists as a scalar string - convert to array element 0
              // e.g., s='abc'; s+=(d e f) -> s=('abc' 'd' 'e' 'f')
              const scalarValue = this.ctx.state.env[name];
              this.ctx.state.env[`${name}_0`] = scalarValue;
              delete this.ctx.state.env[name];
              startIndex = 1;
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

        // For prefix assignments with a command, bash stringifies the array syntax
        // and exports it as an environment variable. e.g., B=(b b) cmd exports B="(b b)"
        if (node.name) {
          // Save current scalar value for restoration
          tempAssignments[name] = this.ctx.state.env[name];

          // Stringify the array syntax as bash does
          const elements = assignment.array.map((el) =>
            wordToLiteralString(el),
          );
          const stringified = `(${elements.join(" ")})`;
          this.ctx.state.env[name] = stringified;
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
            // If the nameref points to an array element (e.g., array[0]), subscript access is invalid
            // because array[0] is not a valid identifier for further subscripting
            if (resolved.includes("[")) {
              return result(
                "",
                `bash: \`${resolved}': not a valid identifier\n`,
                1,
              );
            }
            arrayName = resolved;
          }
        }

        // Check if array variable is readonly
        // For prefix assignments (temp bindings) to readonly vars, bash silently ignores them
        if (isReadonly(this.ctx, arrayName)) {
          if (node.name) {
            // Temp binding to readonly var - silently skip (bash doesn't warn for subscript)
            continue;
          }
          const readonlyError = checkReadonlyError(this.ctx, arrayName);
          if (readonlyError) return readonlyError;
        }

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

          // Handle double-quoted subscripts - strip quotes and use content as arithmetic
          // Bash allows a["2"]=3 but NOT a['2']=3 (single quotes are a syntax error)
          let evalExpr = subscriptExpr;
          if (
            subscriptExpr.startsWith('"') &&
            subscriptExpr.endsWith('"') &&
            subscriptExpr.length >= 2
          ) {
            evalExpr = subscriptExpr.slice(1, -1);
          }

          if (/^-?\d+$/.test(evalExpr)) {
            // Simple numeric subscript
            index = Number.parseInt(evalExpr, 10);
          } else {
            // Parse and evaluate as arithmetic expression
            // Use isExpansionContext=false since array subscripts work like (()) context
            // where single quotes are allowed and evaluate to character values
            try {
              const parser = new Parser();
              const arithAst = parseArithmeticExpression(parser, evalExpr);
              index = await evaluateArithmetic(
                this.ctx,
                arithAst.expression,
                false,
              );
            } catch (e) {
              // ArithmeticError handling depends on whether the error is fatal
              if (e instanceof ArithmeticError) {
                const lineNum = this.ctx.state.currentLine;
                const errorMsg = `bash: line ${lineNum}: ${subscriptExpr}: ${e.message}\n`;
                // Fatal errors (like missing operand "0+") should abort the script
                if (e.fatal) {
                  throw new ExitError(1, "", errorMsg);
                }
                // Non-fatal errors (like single quotes) - just report error and continue
                return result("", errorMsg, 1);
              }
              // Fall back to variable lookup for backwards compatibility (other errors)
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
          // If base array is a local variable, save this key to local scope for cleanup
          const localDepth = getLocalVarDepth(this.ctx, arrayName);
          if (
            localDepth !== undefined &&
            localDepth === this.ctx.state.callDepth &&
            this.ctx.state.localScopes.length > 0
          ) {
            const currentScope =
              this.ctx.state.localScopes[this.ctx.state.localScopes.length - 1];
            if (!currentScope.has(envKey)) {
              currentScope.set(envKey, this.ctx.state.env[envKey]);
            }
          }
          this.ctx.state.env[envKey] = finalValue;
        }
        continue;
      }

      // Resolve nameref: if name is a nameref, write to the target variable
      let targetName = name;
      let namerefArrayRef: {
        arrayName: string;
        subscriptExpr: string;
      } | null = null;
      if (isNameref(this.ctx, name)) {
        const resolved = resolveNamerefForAssignment(this.ctx, name, value);
        if (resolved === undefined) {
          // Circular nameref detected
          return result("", `bash: ${name}: circular name reference\n`, 1);
        }
        if (resolved === null) {
          // Empty nameref and value is not an existing variable - skip assignment
          continue;
        }
        targetName = resolved;

        // Check if resolved nameref is an array element reference like A["K"] or A[$var]
        const arrayRefMatch = targetName.match(
          /^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/,
        );
        if (arrayRefMatch) {
          namerefArrayRef = {
            arrayName: arrayRefMatch[1],
            subscriptExpr: arrayRefMatch[2],
          };
          // For subsequent checks (readonly, integer attr), use the array name
          targetName = arrayRefMatch[1];
        }
      }

      // Check if variable is readonly (for scalar assignment)
      // For prefix assignments (temp bindings) to readonly vars, bash warns but continues
      if (isReadonly(this.ctx, targetName)) {
        if (node.name) {
          // Temp binding to readonly var - warn but continue
          // Add to xtrace output for the warning message
          xtraceAssignmentOutput += `bash: ${targetName}: readonly variable\n`;
          continue; // Skip this assignment, process next one
        }
        const readonlyError = checkReadonlyError(this.ctx, targetName);
        if (readonlyError) return readonlyError;
      }

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
              await evaluateArithmetic(this.ctx, arithAst.expression),
            );
          } else {
            const arithAst = parseArithmeticExpression(parser, value);
            finalValue = String(
              await evaluateArithmetic(this.ctx, arithAst.expression),
            );
          }
        } catch {
          // If parsing fails, return 0 (bash behavior for invalid expressions)
          finalValue = "0";
        }
      } else {
        // Normal string handling
        // For arrays, append mode (+=) appends to index 0
        const appendKey = isArray(this.ctx, targetName)
          ? `${targetName}_0`
          : targetName;
        finalValue = assignment.append
          ? (this.ctx.state.env[appendKey] || "") + value
          : value;
      }

      // Apply case transformation based on variable attributes (declare -l/-u)
      finalValue = applyCaseTransform(this.ctx, targetName, finalValue);

      // Generate xtrace output for this assignment BEFORE setting the value
      // This matches bash behavior where PS4 is expanded before the assignment takes effect
      xtraceAssignmentOutput += await traceAssignment(
        this.ctx,
        targetName,
        finalValue,
      );

      // In bash, assigning a scalar value to an array variable assigns to index 0
      // e.g., a=(1 2 3); a=99 => a=([0]="99" [1]="2" [2]="3")
      // For associative arrays, it assigns to key "0"
      let actualEnvKey = targetName;
      if (namerefArrayRef) {
        // Nameref resolved to an array element like A["K"] or A[$var]
        // Need to expand the subscript and compute the correct env key
        const { arrayName, subscriptExpr } = namerefArrayRef;
        const isAssoc = this.ctx.state.associativeArrays?.has(arrayName);

        if (isAssoc) {
          // For associative arrays, expand variables in subscript then use as key
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
          actualEnvKey = `${arrayName}_${key}`;
        } else {
          // For indexed arrays, evaluate subscript as arithmetic expression
          // Use isExpansionContext=false since array subscripts work like (()) context
          let index: number;
          if (/^-?\d+$/.test(subscriptExpr)) {
            index = Number.parseInt(subscriptExpr, 10);
          } else {
            try {
              const parser = new Parser();
              const arithAst = parseArithmeticExpression(parser, subscriptExpr);
              index = await evaluateArithmetic(
                this.ctx,
                arithAst.expression,
                false,
              );
            } catch {
              const varValue = this.ctx.state.env[subscriptExpr];
              index = varValue ? Number.parseInt(varValue, 10) : 0;
            }
            if (Number.isNaN(index)) index = 0;
          }
          // Handle negative indices
          if (index < 0) {
            const elements = getArrayElements(this.ctx, arrayName);
            if (elements.length > 0) {
              const maxIdx = Math.max(...elements.map((e) => e[0] as number));
              index = maxIdx + 1 + index;
            }
          }
          actualEnvKey = `${arrayName}_${index}`;
        }
      } else if (isArray(this.ctx, targetName)) {
        actualEnvKey = `${targetName}_0`;
      }

      if (node.name) {
        tempAssignments[actualEnvKey] = this.ctx.state.env[actualEnvKey];
        this.ctx.state.env[actualEnvKey] = finalValue;
      } else {
        this.ctx.state.env[actualEnvKey] = finalValue;
        // If allexport is enabled (set -a), auto-export the variable
        if (this.ctx.state.options.allexport) {
          this.ctx.state.exportedVars =
            this.ctx.state.exportedVars || new Set();
          this.ctx.state.exportedVars.add(targetName);
        }
        // Track if this is a mutation of a tempenv variable (for local-unset behavior)
        // A tempenv is mutated when we assign to a variable that has a tempenv binding
        if (this.ctx.state.tempEnvBindings?.some((b) => b.has(targetName))) {
          this.ctx.state.mutatedTempEnvVars =
            this.ctx.state.mutatedTempEnvVars || new Set();
          this.ctx.state.mutatedTempEnvVars.add(targetName);
        }
      }
    }

    if (!node.name) {
      // No command name - could be assignment-only or redirect-only (bare redirects)
      // e.g., "x=5" (assignment-only) or "> file" (bare redirect to create empty file)

      // Handle bare redirections (no command, just redirects like "> file")
      // In bash, this creates/truncates the file and returns success
      if (node.redirections.length > 0) {
        // Process the redirects - this creates/truncates files as needed
        const redirectError = await preOpenOutputRedirects(
          this.ctx,
          node.redirections,
        );
        if (redirectError) {
          return redirectError;
        }
        // Apply redirections to empty result (for append, read redirects, etc.)
        const baseResult = result("", xtraceAssignmentOutput, 0);
        return applyRedirections(this.ctx, baseResult, node.redirections);
      }

      // Assignment-only command: preserve the exit code from command substitution
      // e.g., x=$(false) should set $? to 1, not 0
      // Also clear $_ - bash clears it for bare assignments
      this.ctx.state.lastArg = "";
      // Include any stderr from command substitutions (e.g., FOO=$(echo foo 1>&2))
      const stderrOutput =
        (this.ctx.state.expansionStderr || "") + xtraceAssignmentOutput;
      this.ctx.state.expansionStderr = "";
      return result("", stderrOutput, this.ctx.state.lastExitCode);
    }

    // Mark prefix assignment variables as temporarily exported for this command
    // In bash, FOO=bar cmd makes FOO visible in cmd's environment
    // EXCEPTION: For assignment builtins (readonly, declare, local, export, typeset),
    // temp bindings should NOT be exported to command substitutions in the arguments.
    // e.g., `FOO=foo readonly v=$(printenv.py FOO)` - the $(printenv.py FOO) should NOT see FOO.
    // This is because assignment builtins don't actually run as external commands that receive
    // an exported environment - they process their arguments in the current shell context.
    const isLiteralAssignmentBuiltinForExport =
      node.name &&
      isWordLiteralMatch(node.name, [
        "local",
        "declare",
        "typeset",
        "export",
        "readonly",
      ]);
    const tempExportedVars = Object.keys(tempAssignments);
    if (tempExportedVars.length > 0 && !isLiteralAssignmentBuiltinForExport) {
      this.ctx.state.tempExportedVars =
        this.ctx.state.tempExportedVars || new Set();
      for (const name of tempExportedVars) {
        this.ctx.state.tempExportedVars.add(name);
      }
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

    // Track source FD for stdin from read-write file descriptors
    // This allows the read builtin to update the FD's position after reading
    let stdinSourceFd = -1;

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
          const fdContent = this.ctx.state.fileDescriptors.get(sourceFd);
          if (fdContent !== undefined) {
            // Handle different FD content formats
            if (fdContent.startsWith("__rw__:")) {
              // Read/write mode: format is __rw__:pathLength:path:position:content
              const parsed = parseRwFdContent(fdContent);
              if (parsed) {
                // Return content starting from current position
                stdin = parsed.content.slice(parsed.position);
                stdinSourceFd = sourceFd;
              }
            } else if (
              fdContent.startsWith("__file__:") ||
              fdContent.startsWith("__file_append__:")
            ) {
              // These are output-only, can't read from them
            } else {
              // Plain content (from exec N< file or here-docs)
              stdin = fdContent;
            }
          }
        }
      }
    }

    const commandName = await expandWord(this.ctx, node.name);

    const args: string[] = [];
    const quotedArgs: boolean[] = [];

    // Handle local/declare/export/readonly arguments specially:
    // - For array assignments like `local a=(1 "2 3")`, preserve quote structure
    // - For scalar assignments like `local foo=$bar`, DON'T glob expand the value
    // This matches bash behavior where assignment values aren't subject to word splitting/globbing
    //
    // IMPORTANT: This special handling only applies when the command is a LITERAL keyword,
    // not when it's determined via variable expansion. For example:
    // - `export var=$x` -> no word splitting (literal export keyword)
    // - `e=export; $e var=$x` -> word splitting DOES occur (export via variable)
    //
    // This is because bash determines at parse time whether the command is an assignment builtin.
    const isLiteralAssignmentBuiltin =
      isWordLiteralMatch(node.name, [
        "local",
        "declare",
        "typeset",
        "export",
        "readonly",
      ]) &&
      (commandName === "local" ||
        commandName === "declare" ||
        commandName === "typeset" ||
        commandName === "export" ||
        commandName === "readonly");

    if (isLiteralAssignmentBuiltin) {
      for (const arg of node.args) {
        const arrayAssignResult = await this.expandLocalArrayAssignment(arg);
        if (arrayAssignResult) {
          args.push(arrayAssignResult);
          quotedArgs.push(true);
        } else {
          // Check if this looks like a scalar assignment (name=value)
          // For assignments, we should NOT glob-expand the value part
          const scalarAssignResult = await this.expandScalarAssignmentArg(arg);
          if (scalarAssignResult !== null) {
            args.push(scalarAssignResult);
            quotedArgs.push(true);
          } else {
            // Not an assignment - use normal glob expansion
            const expanded = await expandWordWithGlob(this.ctx, arg);
            for (const value of expanded.values) {
              args.push(value);
              quotedArgs.push(expanded.quoted);
            }
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
          return await this.runCommand(
            newCommandName,
            args,
            quotedArgs,
            stdin,
            false,
            false,
            stdinSourceFd,
          );
        }
        // No args - treat as no-op (status 0)
        // Preserve lastExitCode for command subs like $(exit 42)
        return result("", "", this.ctx.state.lastExitCode);
      }
      // Literal empty command name - command not found
      return failure("bash: : command not found\n", 127);
    }

    // Special handling for 'exec' with only redirections (no command to run)
    // In this case, the redirections apply persistently to the shell
    if (commandName === "exec" && (args.length === 0 || args[0] === "--")) {
      // Process persistent FD redirections
      // Note: {var}>file redirections are already handled by processFdVariableRedirections
      // which sets up the FD mapping persistently. We only need to handle explicit fd redirections here.
      for (const redir of node.redirections) {
        if (redir.target.type === "HereDoc") continue;

        // Skip FD variable redirections - already handled by processFdVariableRedirections
        if (redir.fdVariable) continue;

        const target = await expandWord(this.ctx, redir.target as WordNode);
        const fd =
          redir.fd ??
          (redir.operator === "<" || redir.operator === "<>" ? 0 : 1);

        if (!this.ctx.state.fileDescriptors) {
          this.ctx.state.fileDescriptors = new Map();
        }

        switch (redir.operator) {
          case ">":
          case ">|": {
            // Open file for writing (truncate)
            const filePath = this.ctx.fs.resolvePath(
              this.ctx.state.cwd,
              target,
            );
            await this.ctx.fs.writeFile(filePath, "", "utf8"); // truncate
            this.ctx.state.fileDescriptors.set(fd, `__file__:${filePath}`);
            break;
          }
          case ">>": {
            // Open file for appending
            const filePath = this.ctx.fs.resolvePath(
              this.ctx.state.cwd,
              target,
            );
            this.ctx.state.fileDescriptors.set(
              fd,
              `__file_append__:${filePath}`,
            );
            break;
          }
          case "<": {
            // Open file for reading - store its content
            const filePath = this.ctx.fs.resolvePath(
              this.ctx.state.cwd,
              target,
            );
            try {
              const content = await this.ctx.fs.readFile(filePath);
              this.ctx.state.fileDescriptors.set(fd, content);
            } catch {
              return failure(`bash: ${target}: No such file or directory\n`);
            }
            break;
          }
          case "<>": {
            // Open file for read/write
            // Format: __rw__:pathLength:path:position:content
            // pathLength allows parsing paths with colons
            // position tracks current file offset for read/write
            const filePath = this.ctx.fs.resolvePath(
              this.ctx.state.cwd,
              target,
            );
            try {
              const content = await this.ctx.fs.readFile(filePath);
              this.ctx.state.fileDescriptors.set(
                fd,
                `__rw__:${filePath.length}:${filePath}:0:${content}`,
              );
            } catch {
              // File doesn't exist - create empty
              await this.ctx.fs.writeFile(filePath, "", "utf8");
              this.ctx.state.fileDescriptors.set(
                fd,
                `__rw__:${filePath.length}:${filePath}:0:`,
              );
            }
            break;
          }
          case ">&": {
            // Duplicate output FD: N>&M means N now writes to same place as M
            // Move FD: N>&M- means duplicate M to N, then close M
            if (target === "-") {
              // Close the FD
              this.ctx.state.fileDescriptors.delete(fd);
            } else if (target.endsWith("-")) {
              // Move operation: N>&M- duplicates M to N then closes M
              const sourceFdStr = target.slice(0, -1);
              const sourceFd = Number.parseInt(sourceFdStr, 10);
              if (!Number.isNaN(sourceFd)) {
                // First, duplicate: copy the FD content/info from source to target
                const sourceInfo = this.ctx.state.fileDescriptors.get(sourceFd);
                if (sourceInfo !== undefined) {
                  this.ctx.state.fileDescriptors.set(fd, sourceInfo);
                } else {
                  // Source FD might be 1 (stdout) or 2 (stderr) which aren't in fileDescriptors
                  // In that case, store as duplication marker
                  this.ctx.state.fileDescriptors.set(
                    fd,
                    `__dupout__:${sourceFd}`,
                  );
                }
                // Then close the source FD
                this.ctx.state.fileDescriptors.delete(sourceFd);
              }
            } else {
              const sourceFd = Number.parseInt(target, 10);
              if (!Number.isNaN(sourceFd)) {
                // Store FD duplication: fd N points to fd M
                this.ctx.state.fileDescriptors.set(
                  fd,
                  `__dupout__:${sourceFd}`,
                );
              }
            }
            break;
          }
          case "<&": {
            // Duplicate input FD: N<&M means N now reads from same place as M
            // Move FD: N<&M- means duplicate M to N, then close M
            if (target === "-") {
              // Close the FD
              this.ctx.state.fileDescriptors.delete(fd);
            } else if (target.endsWith("-")) {
              // Move operation: N<&M- duplicates M to N then closes M
              const sourceFdStr = target.slice(0, -1);
              const sourceFd = Number.parseInt(sourceFdStr, 10);
              if (!Number.isNaN(sourceFd)) {
                // First, duplicate: copy the FD content/info from source to target
                const sourceInfo = this.ctx.state.fileDescriptors.get(sourceFd);
                if (sourceInfo !== undefined) {
                  this.ctx.state.fileDescriptors.set(fd, sourceInfo);
                } else {
                  // Source FD might be 0 (stdin) which isn't in fileDescriptors
                  this.ctx.state.fileDescriptors.set(
                    fd,
                    `__dupin__:${sourceFd}`,
                  );
                }
                // Then close the source FD
                this.ctx.state.fileDescriptors.delete(sourceFd);
              }
            } else {
              const sourceFd = Number.parseInt(target, 10);
              if (!Number.isNaN(sourceFd)) {
                // Store FD duplication for input
                this.ctx.state.fileDescriptors.set(fd, `__dupin__:${sourceFd}`);
              }
            }
            break;
          }
        }
      }
      // In bash, "exec" with only redirections does NOT persist prefix assignments
      // This is the "special case of the special case" - unlike other special builtins
      // (like ":"), exec without a command restores temp assignments
      for (const [name, value] of Object.entries(tempAssignments)) {
        if (value === undefined) delete this.ctx.state.env[name];
        else this.ctx.state.env[name] = value;
      }
      // Clear temp exported vars
      if (this.ctx.state.tempExportedVars) {
        for (const name of Object.keys(tempAssignments)) {
          this.ctx.state.tempExportedVars.delete(name);
        }
      }
      return OK;
    }

    // Generate xtrace output before running the command
    const xtraceOutput = await traceSimpleCommand(this.ctx, commandName, args);

    // Push tempEnvBindings onto the stack so unset can see them
    // This allows `unset v` to reveal the underlying global value when
    // v was set by a prefix assignment like `v=tempenv cmd`
    if (Object.keys(tempAssignments).length > 0) {
      this.ctx.state.tempEnvBindings = this.ctx.state.tempEnvBindings || [];
      this.ctx.state.tempEnvBindings.push(
        new Map(Object.entries(tempAssignments)),
      );
    }

    let cmdResult: ExecResult;
    let controlFlowError: BreakError | ContinueError | null = null;

    try {
      cmdResult = await this.runCommand(
        commandName,
        args,
        quotedArgs,
        stdin,
        false,
        false,
        stdinSourceFd,
      );
    } catch (error) {
      // For break/continue, we still need to apply redirections before propagating
      // This handles cases like "break > file" where the file should be created
      if (error instanceof BreakError || error instanceof ContinueError) {
        controlFlowError = error;
        cmdResult = OK; // break/continue have exit status 0
      } else {
        throw error;
      }
    }

    // Prepend xtrace output and any assignment warnings to stderr
    const stderrPrefix = xtraceAssignmentOutput + xtraceOutput;
    if (stderrPrefix) {
      cmdResult = {
        ...cmdResult,
        stderr: stderrPrefix + cmdResult.stderr,
      };
    }

    cmdResult = await applyRedirections(this.ctx, cmdResult, node.redirections);

    // If we caught a break/continue error, re-throw it after applying redirections
    if (controlFlowError) {
      throw controlFlowError;
    }

    // Update $_ to the last argument of this command (after expansion)
    // If no arguments, $_ is set to the command name
    // Special case: for declare/local/typeset with array assignments like "a=(1 2)",
    // bash sets $_ to just the variable name "a", not the full "a=(1 2)"
    if (args.length > 0) {
      let lastArg = args[args.length - 1];
      if (
        (commandName === "declare" ||
          commandName === "local" ||
          commandName === "typeset") &&
        /^[a-zA-Z_][a-zA-Z0-9_]*=\(/.test(lastArg)
      ) {
        // Extract just the variable name from array assignment
        const match = lastArg.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=\(/);
        if (match) {
          lastArg = match[1];
        }
      }
      this.ctx.state.lastArg = lastArg;
    } else {
      this.ctx.state.lastArg = commandName;
    }

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
        // Skip restoration if this variable was a local that was fully unset
        // This implements bash's behavior where unsetting all local cells
        // prevents the tempenv from being restored
        if (this.ctx.state.fullyUnsetLocals?.has(name)) {
          continue;
        }
        if (value === undefined) delete this.ctx.state.env[name];
        else this.ctx.state.env[name] = value;
      }
    }

    // Clear temp exported vars after command execution
    if (this.ctx.state.tempExportedVars) {
      for (const name of Object.keys(tempAssignments)) {
        this.ctx.state.tempExportedVars.delete(name);
      }
    }

    // Pop tempEnvBindings from the stack
    if (
      Object.keys(tempAssignments).length > 0 &&
      this.ctx.state.tempEnvBindings
    ) {
      this.ctx.state.tempEnvBindings.pop();
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
   */
  private async expandLocalArrayAssignment(
    word: WordNode,
  ): Promise<string | null> {
    return expandLocalArrayAssignmentHelper(this.ctx, word);
  }

  /**
   * Check if a Word represents a scalar assignment and expand it WITHOUT glob expansion
   */
  private async expandScalarAssignmentArg(
    word: WordNode,
  ): Promise<string | null> {
    return expandScalarAssignmentArgHelper(this.ctx, word);
  }

  private async runCommand(
    commandName: string,
    args: string[],
    quotedArgs: boolean[],
    stdin: string,
    skipFunctions = false,
    useDefaultPath = false,
    stdinSourceFd = -1,
  ): Promise<ExecResult> {
    const dispatchCtx: BuiltinDispatchContext = {
      ctx: this.ctx,
      runCommand: (name, a, qa, s, sf, udp, ssf) =>
        this.runCommand(name, a, qa, s, sf, udp, ssf),
      buildExportedEnv: () => this.buildExportedEnv(),
      executeUserScript: (path, a, s) => this.executeUserScript(path, a, s),
    };

    // Try builtin dispatch first
    const builtinResult = await dispatchBuiltin(
      dispatchCtx,
      commandName,
      args,
      quotedArgs,
      stdin,
      skipFunctions,
      useDefaultPath,
      stdinSourceFd,
    );

    if (builtinResult !== null) {
      return builtinResult;
    }

    // Handle external command
    return executeExternalCommand(
      dispatchCtx,
      commandName,
      args,
      stdin,
      useDefaultPath,
    );
  }

  // Alias expansion state
  private aliasExpansionStack: Set<string> = new Set();

  private expandAlias(node: SimpleCommandNode): SimpleCommandNode {
    return expandAliasHelper(this.ctx.state, node, this.aliasExpansionStack);
  }

  async findCommandInPath(commandName: string): Promise<string[]> {
    return findCommandInPathHelper(this.ctx, commandName);
  }

  private async executeSubshell(
    node: SubshellNode,
    stdin = "",
  ): Promise<ExecResult> {
    return executeSubshellHelper(this.ctx, node, stdin, (stmt) =>
      this.executeStatement(stmt),
    );
  }

  private async executeGroup(node: GroupNode, stdin = ""): Promise<ExecResult> {
    return executeGroupHelper(this.ctx, node, stdin, (stmt) =>
      this.executeStatement(stmt),
    );
  }

  // ===========================================================================
  // COMPOUND COMMANDS
  // ===========================================================================

  private async executeArithmeticCommand(
    node: ArithmeticCommandNode,
  ): Promise<ExecResult> {
    // Update currentLine for $LINENO
    if (node.line !== undefined) {
      this.ctx.state.currentLine = node.line;
    }

    // Pre-open output redirects to truncate files BEFORE evaluating expression
    // This matches bash behavior where redirect files are opened before
    // any command substitutions in the arithmetic expression are evaluated
    const preOpenError = await preOpenOutputRedirects(
      this.ctx,
      node.redirections,
    );
    if (preOpenError) {
      return preOpenError;
    }

    try {
      const arithResult = await evaluateArithmetic(
        this.ctx,
        node.expression.expression,
      );
      // Apply output redirections
      let bodyResult = testResult(arithResult !== 0);
      // Include any stderr from expansion (e.g., command substitution stderr)
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
        `bash: arithmetic expression: ${(error as Error).message}\n`,
      );
      return applyRedirections(this.ctx, bodyResult, node.redirections);
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
      // ArithmeticError (e.g., division by zero) returns exit code 1
      // Other errors (e.g., invalid regex) return exit code 2
      const exitCode = error instanceof ArithmeticError ? 1 : 2;
      const bodyResult = failure(
        `bash: conditional expression: ${(error as Error).message}\n`,
        exitCode,
      );
      return applyRedirections(this.ctx, bodyResult, node.redirections);
    }
  }
}
