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
import type { CommandContext, CommandRegistry, ExecResult } from "../types.js";
import { evaluateArithmetic } from "./arithmetic.js";
import {
  handleCd,
  handleExit,
  handleExport,
  handleLocal,
  handleUnset,
} from "./builtins.js";
import { evaluateConditional, evaluateTestArgs } from "./conditionals.js";
import {
  executeCase,
  executeCStyleFor,
  executeFor,
  executeIf,
  executeUntil,
  executeWhile,
} from "./control-flow.js";
import { expandWord, expandWordWithGlob } from "./expansion.js";
import { callFunction, executeFunctionDef } from "./functions.js";
import { applyRedirections } from "./redirections.js";
import type { InterpreterContext, InterpreterState } from "./types.js";

export type { InterpreterContext, InterpreterState } from "./types.js";

export interface InterpreterOptions {
  fs: IFileSystem;
  commands: CommandRegistry;
  maxCallDepth: number;
  maxCommandCount: number;
  maxLoopIterations: number;
  exec: (script: string) => Promise<ExecResult>;
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
      const result = await this.executeStatement(statement);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
      this.ctx.state.lastExitCode = exitCode;
      this.ctx.state.env["?"] = String(exitCode);
    }

    return { stdout, stderr, exitCode };
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

    for (let i = 0; i < node.pipelines.length; i++) {
      const pipeline = node.pipelines[i];
      const operator = i > 0 ? node.operators[i - 1] : null;

      if (operator === "&&" && exitCode !== 0) continue;
      if (operator === "||" && exitCode === 0) continue;

      const result = await this.executePipeline(pipeline);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
    }

    return { stdout, stderr, exitCode };
  }

  private async executePipeline(node: PipelineNode): Promise<ExecResult> {
    let stdin = "";
    let lastResult: ExecResult = { stdout: "", stderr: "", exitCode: 0 };

    for (let i = 0; i < node.commands.length; i++) {
      const command = node.commands[i];
      const isLast = i === node.commands.length - 1;

      const result = await this.executeCommand(command, stdin);

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
        return executeWhile(this.ctx, node);
      case "Until":
        return executeUntil(this.ctx, node);
      case "Case":
        return executeCase(this.ctx, node);
      case "Subshell":
        return this.executeSubshell(node);
      case "Group":
        return this.executeGroup(node);
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
        stdin = await expandWord(this.ctx, hereDoc.content);
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
      if (commandName === "[" && args[args.length - 1] === "]") {
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

    for (const stmt of node.body) {
      const result = await this.executeStatement(stmt);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
    }

    this.ctx.state.env = savedEnv;
    this.ctx.state.cwd = savedCwd;

    return { stdout, stderr, exitCode };
  }

  private async executeGroup(node: GroupNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    for (const stmt of node.body) {
      const result = await this.executeStatement(stmt);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
    }

    return { stdout, stderr, exitCode };
  }

  // ===========================================================================
  // COMPOUND COMMANDS
  // ===========================================================================

  private executeArithmeticCommand(node: ArithmeticCommandNode): ExecResult {
    try {
      const result = evaluateArithmetic(this.ctx, node.expression.expression);
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
