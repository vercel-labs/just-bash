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
import type { CommandContext, CommandRegistry, ExecResult } from "../types.js";
import { evaluateArithmetic } from "./arithmetic.js";
import {
  handleBreak,
  handleCd,
  handleContinue,
  handleDeclare,
  handleEval,
  handleExit,
  handleExport,
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
  BreakError,
  ContinueError,
  ErrexitError,
  ExitError,
  isScopeExitError,
  NounsetError,
  ReturnError,
} from "./errors.js";
import { expandWord, expandWordWithGlob } from "./expansion.js";
import { callFunction, executeFunctionDef } from "./functions.js";
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
        if (error instanceof ExitError) {
          stdout += error.stdout;
          stderr += error.stderr;
          exitCode = error.exitCode;
          this.ctx.state.lastExitCode = exitCode;
          this.ctx.state.env["?"] = String(exitCode);
          return { stdout, stderr, exitCode, env: { ...this.ctx.state.env } };
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
        // Handle break/continue that escaped loops (level exceeded loop depth)
        // In bash, this silently exits all loops and continues with next statement
        if (error instanceof BreakError || error instanceof ContinueError) {
          stdout += error.stdout;
          stderr += error.stderr;
          // Continue with next statement
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
      throw new ErrexitError(exitCode);
    }

    return { stdout, stderr, exitCode };
  }

  private async executePipeline(node: PipelineNode): Promise<ExecResult> {
    let stdin = "";
    let lastResult: ExecResult = { stdout: "", stderr: "", exitCode: 0 };
    let pipefailExitCode = 0; // Track rightmost failing command

    for (let i = 0; i < node.commands.length; i++) {
      const command = node.commands[i];
      const isLast = i === node.commands.length - 1;

      let result: ExecResult;
      try {
        result = await this.executeCommand(command, stdin);
      } catch (error) {
        // In a MULTI-command pipeline, each command runs in a subshell context
        // So exit/return only affect that segment, not the whole script
        // For single commands, let ExitError propagate to terminate the script
        if (error instanceof ExitError && node.commands.length > 1) {
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
        return this.executeSubshell(node);
      case "Group":
        return this.executeGroup(node, stdin);
      case "FunctionDef":
        return executeFunctionDef(this.ctx, node);
      case "ArithmeticCommand":
        return this.executeArithmeticCommand(node);
      case "ConditionalCommand":
        return this.executeConditionalCommand(node);
      default:
        return { stdout: "", stderr: "", exitCode: 0 };
    }
  }

  // ===========================================================================
  // SIMPLE COMMAND EXECUTION
  // ===========================================================================

  private async executeSimpleCommand(
    node: SimpleCommandNode,
    stdin: string,
  ): Promise<ExecResult> {
    const tempAssignments: Record<string, string | undefined> = {};

    for (const assignment of node.assignments) {
      const name = assignment.name;

      // Handle array assignment: VAR=(a b c)
      if (assignment.array) {
        for (let i = 0; i < assignment.array.length; i++) {
          const elementValue = await expandWord(this.ctx, assignment.array[i]);
          this.ctx.state.env[`${name}_${i}`] = elementValue;
        }
        continue;
      }

      const value = assignment.value
        ? await expandWord(this.ctx, assignment.value)
        : "";

      if (node.name) {
        tempAssignments[name] = this.ctx.state.env[name];
        this.ctx.state.env[name] = value;
      } else {
        this.ctx.state.env[name] = value;
      }
    }

    if (!node.name) {
      return { stdout: "", stderr: "", exitCode: 0 };
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
          return {
            stdout: "",
            stderr: `bash: ${target}: No such file or directory\n`,
            exitCode: 1,
          };
        }
      }
    }

    const commandName = await expandWord(this.ctx, node.name);
    const args: string[] = [];
    const quotedArgs: boolean[] = [];

    for (const arg of node.args) {
      const expanded = await expandWordWithGlob(this.ctx, arg);
      for (const value of expanded.values) {
        args.push(value);
        quotedArgs.push(expanded.quoted);
      }
    }

    let result = await this.runCommand(commandName, args, quotedArgs, stdin);
    result = await applyRedirections(this.ctx, result, node.redirections);

    for (const [name, value] of Object.entries(tempAssignments)) {
      if (value === undefined) delete this.ctx.state.env[name];
      else this.ctx.state.env[name] = value;
    }

    return result;
  }

  private async runCommand(
    commandName: string,
    args: string[],
    _quotedArgs: boolean[],
    stdin: string,
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
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (commandName === "false") {
      return { stdout: "", stderr: "", exitCode: 1 };
    }
    if (commandName === "let") {
      // let expr... - evaluate arithmetic expressions
      // Returns 0 if last expression is non-zero, 1 if zero
      if (args.length === 0) {
        return {
          stdout: "",
          stderr: "bash: let: expression expected\n",
          exitCode: 1,
        };
      }
      let lastValue = 0;
      for (const arg of args) {
        try {
          // Parse and evaluate the arithmetic expression
          const result = await this.ctx.execFn(`echo $((${arg}))`);
          lastValue = parseInt(result.stdout.trim(), 10) || 0;
        } catch {
          return {
            stdout: "",
            stderr: `bash: let: ${arg}: syntax error\n`,
            exitCode: 1,
          };
        }
      }
      return { stdout: "", stderr: "", exitCode: lastValue === 0 ? 1 : 0 };
    }
    if (commandName === "command") {
      // command [-pVv] command [arg...] - run command, bypassing functions
      if (args.length === 0) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      let cmdArgs = args;
      // Skip -v, -V, -p options for now (just run the command)
      while (cmdArgs.length > 0 && cmdArgs[0].startsWith("-")) {
        cmdArgs = cmdArgs.slice(1);
      }
      if (cmdArgs.length === 0) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      // Run command without checking functions
      const [cmd, ...rest] = cmdArgs;
      return this.runExternalCommand(cmd, rest, stdin);
    }
    if (commandName === "builtin") {
      // builtin command [arg...] - run builtin command
      if (args.length === 0) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      const [cmd, ...rest] = args;
      // Run as builtin (recursive call, but skip function lookup)
      return this.runCommand(cmd, rest, [], stdin);
    }
    if (commandName === "shopt") {
      // shopt - shell options (stub implementation)
      // Accept -s (set) and -u (unset) but don't actually change behavior
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (commandName === "exec") {
      // exec - replace shell with command (stub: just run the command)
      if (args.length === 0) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      const [cmd, ...rest] = args;
      return this.runCommand(cmd, rest, [], stdin);
    }
    if (commandName === "wait") {
      // wait - wait for background jobs (stub: no-op in this context)
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    // Test commands
    if (commandName === "[[") {
      const endIdx = args.lastIndexOf("]]");
      if (endIdx !== -1) {
        const testArgs = args.slice(0, endIdx);
        return evaluateTestArgs(this.ctx, testArgs);
      }
      return { stdout: "", stderr: "bash: [[: missing `]]'\n", exitCode: 2 };
    }
    if (commandName === "[" || commandName === "test") {
      let testArgs = args;
      if (commandName === "[") {
        if (args[args.length - 1] !== "]") {
          return { stdout: "", stderr: "[: missing `]'\n", exitCode: 2 };
        }
        testArgs = args.slice(0, -1);
      }
      return evaluateTestArgs(this.ctx, testArgs);
    }

    // User-defined functions
    const func = this.ctx.state.functions.get(commandName);
    if (func) {
      return callFunction(this.ctx, func, args);
    }

    // External commands
    let cmdName = commandName;
    if (commandName.includes("/")) {
      cmdName = commandName.split("/").pop() || commandName;
    }

    const cmd = this.ctx.commands.get(cmdName);
    if (!cmd) {
      return {
        stdout: "",
        stderr: `bash: ${commandName}: command not found\n`,
        exitCode: 127,
      };
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
      const message = error instanceof Error ? error.message : String(error);
      return {
        stdout: "",
        stderr: `${commandName}: ${message}\n`,
        exitCode: 1,
      };
    }
  }

  // Run external command, bypassing function lookup (for 'command' builtin)
  private async runExternalCommand(
    commandName: string,
    args: string[],
    stdin: string,
  ): Promise<ExecResult> {
    let cmdName = commandName;
    if (commandName.includes("/")) {
      cmdName = commandName.split("/").pop() || commandName;
    }

    const cmd = this.ctx.commands.get(cmdName);
    if (!cmd) {
      return {
        stdout: "",
        stderr: `bash: ${commandName}: command not found\n`,
        exitCode: 127,
      };
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
      const message = error instanceof Error ? error.message : String(error);
      return {
        stdout: "",
        stderr: `${commandName}: ${message}\n`,
        exitCode: 1,
      };
    }
  }

  // ===========================================================================
  // SUBSHELL AND GROUP EXECUTION
  // ===========================================================================

  private async executeSubshell(node: SubshellNode): Promise<ExecResult> {
    const savedEnv = { ...this.ctx.state.env };
    const savedCwd = this.ctx.state.cwd;

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
      if (error instanceof BreakError || error instanceof ContinueError) {
        error.stdout = stdout + error.stdout;
        error.stderr = stderr + error.stderr;
        throw error;
      }
      if (error instanceof ErrexitError) {
        error.stdout = stdout + error.stdout;
        error.stderr = stderr + error.stderr;
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
    }

    this.ctx.state.env = savedEnv;
    this.ctx.state.cwd = savedCwd;

    return { stdout, stderr, exitCode };
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
      const message = error instanceof Error ? error.message : String(error);
      return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
    }

    // Restore groupStdin
    this.ctx.state.groupStdin = savedGroupStdin;

    return { stdout, stderr, exitCode };
  }

  // ===========================================================================
  // COMPOUND COMMANDS
  // ===========================================================================

  private async executeArithmeticCommand(
    node: ArithmeticCommandNode,
  ): Promise<ExecResult> {
    try {
      const result = await evaluateArithmetic(
        this.ctx,
        node.expression.expression,
      );
      return { stdout: "", stderr: "", exitCode: result === 0 ? 1 : 0 };
    } catch (error) {
      return {
        stdout: "",
        stderr: `bash: arithmetic expression: ${(error as Error).message}\n`,
        exitCode: 1,
      };
    }
  }

  private async executeConditionalCommand(
    node: ConditionalCommandNode,
  ): Promise<ExecResult> {
    try {
      const result = await evaluateConditional(this.ctx, node.expression);
      return { stdout: "", stderr: "", exitCode: result ? 0 : 1 };
    } catch (error) {
      return {
        stdout: "",
        stderr: `bash: conditional expression: ${(error as Error).message}\n`,
        exitCode: 2,
      };
    }
  }
}
