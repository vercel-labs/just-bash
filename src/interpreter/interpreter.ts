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
import type {
  Command,
  CommandContext,
  CommandRegistry,
  ExecResult,
} from "../types.js";
import { evaluateArithmetic, evaluateArithmeticSync } from "./arithmetic.js";
import {
  handleBreak,
  handleCd,
  handleContinue,
  handleDeclare,
  handleEval,
  handleExit,
  handleExport,
  handleLet,
  handleLocal,
  handleRead,
  handleReadonly,
  handleReturn,
  handleSet,
  handleShift,
  handleSource,
  handleUnset,
} from "./builtins/index.js";
import { evaluateConditional, evaluateTestArgs } from "./conditionals.js";
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
  BreakError,
  ContinueError,
  ErrexitError,
  ExecutionLimitError,
  ExitError,
  isScopeExitError,
  NounsetError,
  ReturnError,
  SubshellExitError,
} from "./errors.js";
import {
  expandWord,
  expandWordWithGlob,
  getArrayElements,
} from "./expansion.js";
import { callFunction, executeFunctionDef } from "./functions.js";
import { getErrorMessage } from "./helpers/errors.js";
import { checkReadonlyError } from "./helpers/readonly.js";
import {
  failure,
  OK,
  result,
  testResult,
  throwExecutionLimit,
} from "./helpers/result.js";
import { applyRedirections } from "./redirections.js";
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

    // Check errexit (set -e): exit if command failed
    // Exceptions:
    // - Command was in a && or || list and wasn't the final command (short-circuit)
    // - Command was negated with !
    // - Command is part of a condition in if/while/until
    if (
      this.ctx.state.options.errexit &&
      exitCode !== 0 &&
      lastExecutedIndex === node.pipelines.length - 1 &&
      !lastPipelineNegated &&
      !this.ctx.state.inCondition
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
        // So exit/return only affect that segment, not the whole script
        // For single commands, let ExitError propagate to terminate the script
        else if (error instanceof ExitError && node.commands.length > 1) {
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
        const allElements: string[] = [];
        for (const element of assignment.array) {
          const expanded = await expandWordWithGlob(this.ctx, element);
          allElements.push(...expanded.values);
        }

        // For append mode (+=), find the max existing index and start after it
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
          // For regular assignment, clear existing array elements
          const prefix = `${name}_`;
          for (const key of Object.keys(this.ctx.state.env)) {
            if (key.startsWith(prefix) && !key.includes("__")) {
              delete this.ctx.state.env[key];
            }
          }
        }

        for (let i = 0; i < allElements.length; i++) {
          this.ctx.state.env[`${name}_${startIndex + i}`] = allElements[i];
        }
        // Update length only for non-append (length tracking is not reliable with sparse arrays)
        if (!assignment.append) {
          this.ctx.state.env[`${name}__length`] = String(allElements.length);
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
        const arrayName = subscriptMatch[1];
        const subscriptExpr = subscriptMatch[2];

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
              return result(
                "",
                `bash: ${arrayName}[${subscriptExpr}]: bad array subscript\n`,
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
              return result(
                "",
                `bash: ${arrayName}[${subscriptExpr}]: bad array subscript\n`,
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

      // Check if variable is readonly (for scalar assignment)
      const readonlyError = checkReadonlyError(this.ctx, name);
      if (readonlyError) return readonlyError;

      // Handle append mode (+=)
      const finalValue = assignment.append
        ? (this.ctx.state.env[name] || "") + value
        : value;

      if (node.name) {
        tempAssignments[name] = this.ctx.state.env[name];
        this.ctx.state.env[name] = finalValue;
      } else {
        this.ctx.state.env[name] = finalValue;
      }
    }

    if (!node.name) {
      // Assignment-only command: preserve the exit code from command substitution
      // e.g., x=$(false) should set $? to 1, not 0
      return result("", "", this.ctx.state.lastExitCode);
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
        stdin = content;
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
    }

    const commandName = await expandWord(this.ctx, node.name);

    const args: string[] = [];
    const quotedArgs: boolean[] = [];

    // Expand args even if command name is empty (they may have side effects)
    for (const arg of node.args) {
      const expanded = await expandWordWithGlob(this.ctx, arg);
      for (const value of expanded.values) {
        args.push(value);
        quotedArgs.push(expanded.quoted);
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

    for (const [name, value] of Object.entries(tempAssignments)) {
      if (value === undefined) delete this.ctx.state.env[name];
      else this.ctx.state.env[name] = value;
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

  private async runCommand(
    commandName: string,
    args: string[],
    _quotedArgs: boolean[],
    stdin: string,
    skipFunctions = false,
  ): Promise<ExecResult> {
    // Built-in commands
    if (commandName === "cd") {
      return await handleCd(this.ctx, args);
    }
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
    if (commandName === "source" || commandName === ".") {
      return handleSource(this.ctx, args);
    }
    if (commandName === "read") {
      return handleRead(this.ctx, args, stdin);
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
        return callFunction(this.ctx, func, args);
      }
    }
    // Simple builtins (can be overridden by functions)
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
      let cmdArgs = args;
      // Skip -v, -V, -p options for now (just run the command)
      while (cmdArgs.length > 0 && cmdArgs[0].startsWith("-")) {
        cmdArgs = cmdArgs.slice(1);
      }
      if (cmdArgs.length === 0) {
        return OK;
      }
      // Run command without checking functions, but builtins are still available
      const [cmd, ...rest] = cmdArgs;
      return this.runCommand(cmd, rest, [], stdin, true);
    }
    if (commandName === "builtin") {
      // builtin command [arg...] - run builtin command
      if (args.length === 0) {
        return OK;
      }
      const [cmd, ...rest] = args;
      // Run as builtin (recursive call, but skip function lookup)
      return this.runCommand(cmd, rest, [], stdin);
    }
    if (commandName === "shopt") {
      // shopt - shell options (stub implementation)
      // Accept -s (set) and -u (unset) but don't actually change behavior
      return OK;
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
      return this.handleType(args);
    }
    // Test commands
    if (commandName === "[[") {
      const endIdx = args.lastIndexOf("]]");
      if (endIdx !== -1) {
        const testArgs = args.slice(0, endIdx);
        return evaluateTestArgs(this.ctx, testArgs);
      }
      return failure("bash: [[: missing `]]'\n", 2);
    }
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
    const resolved = await this.resolveCommand(commandName);
    if (!resolved) {
      return failure(`bash: ${commandName}: command not found\n`, 127);
    }
    const { cmd, path: cmdPath } = resolved;
    // cmdPath is available for future use (e.g., $0 in scripts)
    void cmdPath;

    const cmdCtx: CommandContext = {
      fs: this.ctx.fs,
      cwd: this.ctx.state.cwd,
      env: this.ctx.state.env,
      stdin,
      limits: this.ctx.limits,
      exec: this.ctx.execFn,
      fetch: this.ctx.fetch,
      getRegisteredCommands: () => Array.from(this.ctx.commands.keys()),
      sleep: this.ctx.sleep,
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

    // Search PATH directories
    const pathEnv = this.ctx.state.env.PATH || "/bin:/usr/bin";
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

  private handleType(args: string[]): ExecResult {
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
    ]);

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    for (const name of args) {
      if (keywords.has(name)) {
        stdout += `${name} is a shell keyword\n`;
      } else if (builtins.has(name)) {
        stdout += `${name} is a shell builtin\n`;
      } else if (this.ctx.state.functions.has(name)) {
        stdout += `${name} is a function\n`;
      } else if (this.ctx.commands.has(name)) {
        stdout += `${name} is /bin/${name}\n`;
      } else {
        stderr += `bash: type: ${name}: not found\n`;
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
    const savedEnv = { ...this.ctx.state.env };
    const savedCwd = this.ctx.state.cwd;
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
        const result = await this.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }
    } catch (error) {
      this.ctx.state.env = savedEnv;
      this.ctx.state.cwd = savedCwd;
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
        return result(stdout, stderr, 0);
      }
      // BreakError/ContinueError should NOT propagate out of subshell
      // They only affect loops within the subshell
      if (error instanceof BreakError || error instanceof ContinueError) {
        stdout += error.stdout;
        stderr += error.stderr;
        return result(stdout, stderr, 0);
      }
      // ExitError in subshell should NOT propagate - just return the exit code
      // (subshells are like separate processes)
      if (error instanceof ExitError) {
        stdout += error.stdout;
        stderr += error.stderr;
        return result(stdout, stderr, error.exitCode);
      }
      // ReturnError in subshell (e.g., f() ( return 42; )) should also just exit
      // with the given code, since subshells are like separate processes
      if (error instanceof ReturnError) {
        stdout += error.stdout;
        stderr += error.stderr;
        return result(stdout, stderr, error.exitCode);
      }
      if (error instanceof ErrexitError) {
        error.stdout = stdout + error.stdout;
        error.stderr = stderr + error.stderr;
        throw error;
      }
      return result(stdout, `${stderr}${getErrorMessage(error)}\n`, 1);
    }

    this.ctx.state.env = savedEnv;
    this.ctx.state.cwd = savedCwd;
    this.ctx.state.loopDepth = savedLoopDepth;
    this.ctx.state.parentHasLoopContext = savedParentHasLoopContext;
    this.ctx.state.groupStdin = savedGroupStdin;

    return result(stdout, stderr, exitCode);
  }

  private async executeGroup(node: GroupNode, stdin = ""): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    // Save any existing groupStdin and set new one from pipeline
    const savedGroupStdin = this.ctx.state.groupStdin;
    if (stdin) {
      this.ctx.state.groupStdin = stdin;
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

    return result(stdout, stderr, exitCode);
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
    try {
      const condResult = await evaluateConditional(this.ctx, node.expression);
      return testResult(condResult);
    } catch (error) {
      return failure(
        `bash: conditional expression: ${(error as Error).message}\n`,
        2,
      );
    }
  }
}
