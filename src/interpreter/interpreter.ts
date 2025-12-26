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
import type { IFileSystem } from "../fs-interface.js";
import type { SecureFetch } from "../network/index.js";
import { parseArithmeticExpression } from "../parser/arithmetic-parser.js";
import { Parser } from "../parser/parser.js";
import type { CommandContext, CommandRegistry, ExecResult } from "../types.js";
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
  ExitError,
  isScopeExitError,
  NounsetError,
  ReturnError,
} from "./errors.js";
import {
  expandWord,
  expandWordWithGlob,
  getArrayElements,
} from "./expansion.js";
import { callFunction, executeFunctionDef } from "./functions.js";
import { unquoteKey } from "./helpers/array.js";
import { getErrorMessage } from "./helpers/errors.js";
import { checkReadonlyError } from "./helpers/readonly.js";
import { failure, OK, result, testResult } from "./helpers/result.js";
import { applyRedirections } from "./redirections.js";
import type { InterpreterContext, InterpreterState } from "./types.js";

// Re-export ErrexitError for backwards compatibility
export { ErrexitError } from "./errors.js";
export type { InterpreterContext, InterpreterState } from "./types.js";

export interface InterpreterOptions {
  fs: IFileSystem;
  commands: CommandRegistry;
  maxCallDepth: number;
  maxCommandCount: number;
  maxLoopIterations: number;
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
      maxCallDepth: options.maxCallDepth,
      maxCommandCount: options.maxCommandCount,
      maxLoopIterations: options.maxLoopIterations,
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
    if (this.ctx.state.commandCount > this.ctx.maxCommandCount) {
      const err = new Error(
        `bash: too many commands executed (>${this.ctx.maxCommandCount}), increase maxCommandCount`,
      );
      console.error(err.message);
      throw err;
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
    const tempAssignments: Record<string, string | undefined> = {};

    for (const assignment of node.assignments) {
      const name = assignment.name;

      // Handle array assignment: VAR=(a b c)
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
        for (let i = 0; i < allElements.length; i++) {
          this.ctx.state.env[`${name}_${i}`] = allElements[i];
        }
        this.ctx.state.env[`${name}__length`] = String(allElements.length);
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
          // For associative arrays, use subscript as string key (remove quotes if present)
          const key = unquoteKey(subscriptExpr);
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

          // Handle negative indices
          if (index < 0) {
            const elements = getArrayElements(this.ctx, arrayName);
            const len = elements.length;
            index = len + index;
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

        if (node.name) {
          tempAssignments[envKey] = this.ctx.state.env[envKey];
          this.ctx.state.env[envKey] = value;
        } else {
          this.ctx.state.env[envKey] = value;
        }
        continue;
      }

      // Check if variable is readonly (for scalar assignment)
      const readonlyError = checkReadonlyError(this.ctx, name);
      if (readonlyError) return readonlyError;

      if (node.name) {
        tempAssignments[name] = this.ctx.state.env[name];
        this.ctx.state.env[name] = value;
      } else {
        this.ctx.state.env[name] = value;
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

    for (const [name, value] of Object.entries(tempAssignments)) {
      if (value === undefined) delete this.ctx.state.env[name];
      else this.ctx.state.env[name] = value;
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
    // Simple builtins
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

    // User-defined functions (skip if called via 'command' builtin)
    if (!skipFunctions) {
      const func = this.ctx.state.functions.get(commandName);
      if (func) {
        return callFunction(this.ctx, func, args);
      }
    }

    // External commands
    let cmdName = commandName;
    if (commandName.includes("/")) {
      cmdName = commandName.split("/").pop() || commandName;
    }

    const cmd = this.ctx.commands.get(cmdName);
    if (!cmd) {
      return failure(`bash: ${commandName}: command not found\n`, 127);
    }

    const cmdCtx: CommandContext = {
      fs: this.ctx.fs,
      cwd: this.ctx.state.cwd,
      env: this.ctx.state.env,
      stdin,
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
      this.ctx.state.groupStdin = savedGroupStdin;
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
