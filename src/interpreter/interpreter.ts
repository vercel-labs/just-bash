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
  FunctionDefNode,
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
import { ParseException } from "../parser/types.js";
import type {
  Command,
  CommandContext,
  CommandRegistry,
  ExecResult,
  TraceCallback,
} from "../types.js";
import { evaluateArithmetic, evaluateArithmeticSync } from "./arithmetic.js";
import {
  applyCaseTransform,
  getLocalVarDepth,
  handleBreak,
  handleCd,
  handleCompgen,
  handleComplete,
  handleCompopt,
  handleContinue,
  handleDeclare,
  handleDirs,
  handleEval,
  handleExit,
  handleExport,
  handleGetopts,
  handleHash,
  handleHelp,
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

/**
 * Shell keywords (for type, command -v, etc.)
 */
const SHELL_KEYWORDS = new Set([
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

/**
 * Shell builtins (for type, command -v, builtin, etc.)
 */
const SHELL_BUILTINS = new Set([
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
  "compgen",
  "complete",
  "compopt",
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

/**
 * Check if a WordNode is a literal match for any of the given strings.
 * Returns true only if the word is a single literal (no expansions, no quoting)
 * that matches one of the target strings.
 *
 * This is used to detect assignment builtins at "parse time" - bash determines
 * whether a command is export/declare/etc based on the literal token, not the
 * runtime value after expansion.
 */
function isWordLiteralMatch(word: WordNode, targets: string[]): boolean {
  // Must be a single part
  if (word.parts.length !== 1) {
    return false;
  }
  const part = word.parts[0];
  // Must be a simple literal (not quoted, not an expansion)
  if (part.type !== "Literal") {
    return false;
  }
  return targets.includes(part.value);
}

/**
 * Parse the content of a read-write file descriptor.
 * Format: __rw__:pathLength:path:position:content
 * @returns The parsed components, or null if format is invalid
 */
function parseRwFdContent(fdContent: string): {
  path: string;
  position: number;
  content: string;
} | null {
  if (!fdContent.startsWith("__rw__:")) {
    return null;
  }
  // Parse pathLength
  const afterPrefix = fdContent.slice(7); // After "__rw__:"
  const firstColonIdx = afterPrefix.indexOf(":");
  if (firstColonIdx === -1) {
    return null;
  }
  const pathLength = Number.parseInt(afterPrefix.slice(0, firstColonIdx), 10);
  if (Number.isNaN(pathLength) || pathLength < 0) {
    return null;
  }
  // Extract path using length
  const pathStart = firstColonIdx + 1;
  const path = afterPrefix.slice(pathStart, pathStart + pathLength);
  // Parse position (after path and colon)
  const positionStart = pathStart + pathLength + 1; // +1 for ":"
  const remaining = afterPrefix.slice(positionStart);
  const posColonIdx = remaining.indexOf(":");
  if (posColonIdx === -1) {
    return null;
  }
  const position = Number.parseInt(remaining.slice(0, posColonIdx), 10);
  if (Number.isNaN(position) || position < 0) {
    return null;
  }
  // Extract content (after position and colon)
  const content = remaining.slice(posColonIdx + 1);
  return { path, position, content };
}

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
  isArray,
} from "./expansion.js";
import { callFunction, executeFunctionDef } from "./functions.js";
import {
  parseKeyedElementFromWord,
  wordToLiteralString,
} from "./helpers/array.js";
import { getErrorMessage } from "./helpers/errors.js";
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
import { expandTildesInValue } from "./helpers/tilde.js";
import { traceAssignment, traceSimpleCommand } from "./helpers/xtrace.js";
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
   * This handles executable files that don't have registered command handlers.
   * The script runs in a subshell-like environment with its own positional parameters.
   */
  private async executeUserScript(
    scriptPath: string,
    args: string[],
    stdin = "",
  ): Promise<ExecResult> {
    // Read the script content
    let content: string;
    try {
      content = await this.ctx.fs.readFile(scriptPath);
    } catch {
      return failure(`bash: ${scriptPath}: No such file or directory\n`, 127);
    }

    // Check for shebang and skip it if present (we'll execute as bash script)
    // Note: we don't actually support different interpreters, just bash
    if (content.startsWith("#!")) {
      const firstNewline = content.indexOf("\n");
      if (firstNewline !== -1) {
        content = content.slice(firstNewline + 1);
      }
    }

    // Save current state for restoration after script execution
    const savedEnv = { ...this.ctx.state.env };
    const savedCwd = this.ctx.state.cwd;
    const savedOptions = { ...this.ctx.state.options };
    const savedLoopDepth = this.ctx.state.loopDepth;
    const savedParentHasLoopContext = this.ctx.state.parentHasLoopContext;
    const savedLastArg = this.ctx.state.lastArg;
    const savedBashPid = this.ctx.state.bashPid;
    const savedGroupStdin = this.ctx.state.groupStdin;
    const savedSource = this.ctx.state.currentSource;

    // Set up subshell-like environment
    this.ctx.state.parentHasLoopContext = savedLoopDepth > 0;
    this.ctx.state.loopDepth = 0;
    this.ctx.state.bashPid = this.ctx.state.nextVirtualPid++;
    if (stdin) {
      this.ctx.state.groupStdin = stdin;
    }
    this.ctx.state.currentSource = scriptPath;

    // Set positional parameters ($1, $2, etc.) from args
    // $0 should be the script path
    this.ctx.state.env["0"] = scriptPath;
    this.ctx.state.env["#"] = String(args.length);
    this.ctx.state.env["@"] = args.join(" ");
    this.ctx.state.env["*"] = args.join(" ");
    for (let i = 0; i < args.length && i < 9; i++) {
      this.ctx.state.env[String(i + 1)] = args[i];
    }
    // Clear any remaining positional parameters
    for (let i = args.length + 1; i <= 9; i++) {
      delete this.ctx.state.env[String(i)];
    }

    const cleanup = (): void => {
      this.ctx.state.env = savedEnv;
      this.ctx.state.cwd = savedCwd;
      this.ctx.state.options = savedOptions;
      this.ctx.state.loopDepth = savedLoopDepth;
      this.ctx.state.parentHasLoopContext = savedParentHasLoopContext;
      this.ctx.state.lastArg = savedLastArg;
      this.ctx.state.bashPid = savedBashPid;
      this.ctx.state.groupStdin = savedGroupStdin;
      this.ctx.state.currentSource = savedSource;
    };

    try {
      const parser = new Parser();
      const ast = parser.parse(content);
      const execResult = await this.executeScript(ast);
      cleanup();
      return execResult;
    } catch (error) {
      cleanup();

      // ExitError propagates up (but with output from this script)
      if (error instanceof ExitError) {
        throw error;
      }

      // ExecutionLimitError must always propagate
      if (error instanceof ExecutionLimitError) {
        throw error;
      }

      // Handle parse errors
      if ((error as ParseException).name === "ParseException") {
        return failure(`bash: ${scriptPath}: ${(error as Error).message}\n`);
      }

      throw error;
    }
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
    // Record start time for timed pipelines
    const startTime = node.timed ? performance.now() : 0;

    let stdin = "";
    let lastResult: ExecResult = OK;
    let pipefailExitCode = 0; // Track rightmost failing command
    const pipestatusExitCodes: number[] = []; // Track all exit codes for PIPESTATUS

    // For multi-command pipelines, save parent's $_ because pipeline commands
    // run in subshell-like contexts and should not affect parent's $_
    // (except the last command when lastpipe is enabled)
    const isMultiCommandPipeline = node.commands.length > 1;
    const savedLastArg = this.ctx.state.lastArg;

    for (let i = 0; i < node.commands.length; i++) {
      const command = node.commands[i];
      const isLast = i === node.commands.length - 1;

      // In a multi-command pipeline, each command runs in a subshell context
      // where $_ starts empty (subshells don't inherit $_ from parent in same way)
      if (isMultiCommandPipeline) {
        // Clear $_ for each pipeline command - they each get fresh subshell context
        this.ctx.state.lastArg = "";
      }

      // Determine if this command runs in a subshell context
      // In bash, all commands except the last run in subshells
      // With lastpipe enabled, the last command runs in the current shell
      const runsInSubshell =
        isMultiCommandPipeline &&
        (!isLast || !this.ctx.state.shoptOptions.lastpipe);

      // Save environment for commands running in subshell context
      // This prevents variable assignments (e.g., ${cmd=echo}) from leaking to parent
      const savedEnv = runsInSubshell ? { ...this.ctx.state.env } : null;

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
          // Restore environment before re-throwing
          if (savedEnv) {
            this.ctx.state.env = savedEnv;
          }
          throw error;
        }
      }

      // Restore environment for subshell commands to prevent variable assignment leakage
      if (savedEnv) {
        this.ctx.state.env = savedEnv;
      }

      // Track exit code for PIPESTATUS
      pipestatusExitCodes.push(result.exitCode);

      // Track the exit code of failing commands for pipefail
      if (result.exitCode !== 0) {
        pipefailExitCode = result.exitCode;
      }

      if (!isLast) {
        // Check if this pipe is |& (pipe stderr to next command's stdin too)
        const pipeStderrToNext = node.pipeStderr?.[i] ?? false;
        if (pipeStderrToNext) {
          // |& pipes both stdout and stderr to next command's stdin
          stdin = result.stderr + result.stdout;
          lastResult = {
            stdout: "",
            stderr: "",
            exitCode: result.exitCode,
          };
        } else {
          // Regular | only pipes stdout
          stdin = result.stdout;
          lastResult = {
            stdout: "",
            stderr: result.stderr,
            exitCode: result.exitCode,
          };
        }
      } else {
        lastResult = result;
      }
    }

    // Set PIPESTATUS array with exit codes from all pipeline commands
    // For single-command pipelines with compound commands, don't set PIPESTATUS here -
    // let inner statements set it (e.g., non-matching case statements should leave
    // PIPESTATUS unchanged, matching bash behavior).
    // For multi-command pipelines or simple commands, always set PIPESTATUS.
    const shouldSetPipestatus =
      node.commands.length > 1 ||
      (node.commands.length === 1 && node.commands[0].type === "SimpleCommand");

    if (shouldSetPipestatus) {
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
      this.ctx.state.env.PIPESTATUS__length = String(
        pipestatusExitCodes.length,
      );
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

    // Output timing info for timed pipelines
    if (node.timed) {
      const endTime = performance.now();
      const elapsedSeconds = (endTime - startTime) / 1000;
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = elapsedSeconds % 60;

      let timingOutput: string;
      if (node.timePosix) {
        // POSIX format (-p): decimal format without leading zeros
        timingOutput = `real ${elapsedSeconds.toFixed(2)}\nuser 0.00\nsys 0.00\n`;
      } else {
        // Default bash format: real/user/sys with XmY.YYYs
        const realStr = `${minutes}m${seconds.toFixed(3)}s`;
        timingOutput = `\nreal\t${realStr}\nuser\t0m0.000s\nsys\t0m0.000s\n`;
      }

      lastResult = {
        ...lastResult,
        stderr: lastResult.stderr + timingOutput,
      };
    }

    // Handle $_ for multi-command pipelines:
    // - With lastpipe enabled: $_ is set by the last command (already done above)
    // - Without lastpipe: $_ should be restored to the value before the pipeline
    //   (since all commands ran in subshells that don't affect parent's $_)
    if (isMultiCommandPipeline && !this.ctx.state.shoptOptions.lastpipe) {
      this.ctx.state.lastArg = savedLastArg;
    }
    // With lastpipe, the last command already updated $_ in the main shell context

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
                index = evaluateArithmeticSync(
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
              index = evaluateArithmeticSync(
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
              index = evaluateArithmeticSync(
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
    // Track whether we've seen a quoted part (SingleQuoted, DoubleQuoted) since
    // last element push. This ensures empty quoted strings like '' are preserved.
    let hasQuotedContent = false;

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
              // Whitespace - push pending element if we have content OR saw quoted part
              if (pendingLiteral || hasQuotedContent) {
                elements.push(pendingLiteral);
                pendingLiteral = "";
                hasQuotedContent = false;
              }
            } else if (token) {
              // Non-empty token - accumulate
              pendingLiteral += token;
            }
          }
        }
      } else if (inArrayContent) {
        // Handle BraceExpansion specially - it produces multiple values
        // BUT only if we're not inside a keyed element [key]=value
        if (part.type === "BraceExpansion") {
          // Check if pendingLiteral looks like a keyed element pattern: [key]=...
          // If so, brace expansion should NOT happen in the value part
          const isKeyedElement = /^\[.+\]=/.test(pendingLiteral);
          if (isKeyedElement) {
            // Inside a keyed element value - convert brace to literal, no expansion
            pendingLiteral += wordToLiteralString({
              type: "Word",
              parts: [part],
            });
          } else {
            // Plain element - expand braces normally
            // Push any pending literal first
            if (pendingLiteral || hasQuotedContent) {
              elements.push(pendingLiteral);
              pendingLiteral = "";
              hasQuotedContent = false;
            }
            // Use expandWordWithGlob to properly expand brace expressions
            const braceExpanded = await expandWordWithGlob(this.ctx, {
              type: "Word",
              parts: [part],
            });
            // Add each expanded value as a separate element
            elements.push(...braceExpanded.values);
          }
        } else {
          // Quoted/expansion part - expand it and accumulate as single element
          // Mark that we've seen quoted content (for empty string preservation)
          if (
            part.type === "SingleQuoted" ||
            part.type === "DoubleQuoted" ||
            part.type === "Escaped"
          ) {
            hasQuotedContent = true;
          }
          const expanded = await expandWord(this.ctx, {
            type: "Word",
            parts: [part],
          });
          pendingLiteral += expanded;
        }
      }
    }

    // Push final element if we have content OR saw quoted part
    if (pendingLiteral || hasQuotedContent) {
      elements.push(pendingLiteral);
    }

    // Build result string with proper quoting
    const quotedElements = elements.map((elem) => {
      // Don't quote keyed elements like ['key']=value or [index]=value
      // These need to be parsed by the declare builtin as-is
      if (/^\[.+\]=/.test(elem)) {
        return elem;
      }
      // Empty strings must be quoted to be preserved
      if (elem === "") {
        return "''";
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

  /**
   * Check if a Word represents a scalar assignment (name=value, name+=value, or name[index]=value)
   * and expand it WITHOUT glob expansion on the value part.
   * Returns the expanded string like "name=expanded_value" or null if not a scalar assignment.
   *
   * This is important for bash compatibility: `local var=$x` where x='a b' should
   * set var to "a b", not try to glob-expand it.
   */
  private async expandScalarAssignmentArg(
    word: WordNode,
  ): Promise<string | null> {
    // Look for = in the word parts to detect assignment pattern
    // We need to find where the assignment operator is and split there
    let eqPartIndex = -1;
    let eqCharIndex = -1;
    let isAppend = false;

    for (let i = 0; i < word.parts.length; i++) {
      const part = word.parts[i];
      if (part.type === "Literal") {
        // Check for += first
        const appendIdx = part.value.indexOf("+=");
        if (appendIdx !== -1) {
          // Verify it looks like an assignment: should have valid var name before +=
          const before = part.value.slice(0, appendIdx);
          if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(before)) {
            eqPartIndex = i;
            eqCharIndex = appendIdx;
            isAppend = true;
            break;
          }
          // Also check for array index append: name[index]+=
          if (/^[a-zA-Z_][a-zA-Z0-9_]*\[[^\]]+\]$/.test(before)) {
            eqPartIndex = i;
            eqCharIndex = appendIdx;
            isAppend = true;
            break;
          }
        }
        // Check for regular = (but not == or != or other operators)
        const eqIdx = part.value.indexOf("=");
        if (eqIdx !== -1 && (eqIdx === 0 || part.value[eqIdx - 1] !== "+")) {
          // Make sure it's not inside brackets like [0]= which we handle separately
          // and verify it looks like an assignment
          const before = part.value.slice(0, eqIdx);
          if (
            /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(before) ||
            /^[a-zA-Z_][a-zA-Z0-9_]*\[[^\]]+\]$/.test(before)
          ) {
            eqPartIndex = i;
            eqCharIndex = eqIdx;
            break;
          }
        }
      }
    }

    // No assignment operator found
    if (eqPartIndex === -1) {
      return null;
    }

    // Split the word into name part and value part
    const nameParts = word.parts.slice(0, eqPartIndex);
    const eqPart = word.parts[eqPartIndex];

    if (eqPart.type !== "Literal") {
      return null;
    }

    const operatorLen = isAppend ? 2 : 1;
    const nameFromEqPart = eqPart.value.slice(0, eqCharIndex);
    const valueFromEqPart = eqPart.value.slice(eqCharIndex + operatorLen);
    const valueParts = word.parts.slice(eqPartIndex + 1);

    // Construct the name by expanding the name parts (no glob needed for names)
    let name = "";
    for (const part of nameParts) {
      name += await expandWord(this.ctx, { type: "Word", parts: [part] });
    }
    name += nameFromEqPart;

    // Construct the value part Word for expansion WITHOUT glob
    const valueWord: WordNode = {
      type: "Word",
      parts:
        valueFromEqPart !== ""
          ? [{ type: "Literal", value: valueFromEqPart }, ...valueParts]
          : valueParts,
    };

    // Expand the value WITHOUT glob expansion
    const value =
      valueWord.parts.length > 0 ? await expandWord(this.ctx, valueWord) : "";

    const operator = isAppend ? "+=" : "=";
    return `${name}${operator}${value}`;
  }

  private async runCommand(
    commandName: string,
    args: string[],
    _quotedArgs: boolean[],
    stdin: string,
    skipFunctions = false,
    useDefaultPath = false,
    stdinSourceFd = -1,
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
    // In POSIX mode, eval is a special builtin that cannot be overridden by functions
    // In non-POSIX mode (bash default), functions can override eval
    if (commandName === "eval" && this.ctx.state.options.posix) {
      return handleEval(this.ctx, args, stdin);
    }
    if (commandName === "shift") {
      return handleShift(this.ctx, args);
    }
    if (commandName === "getopts") {
      return handleGetopts(this.ctx, args);
    }
    if (commandName === "compgen") {
      return handleCompgen(this.ctx, args);
    }
    if (commandName === "complete") {
      return handleComplete(this.ctx, args);
    }
    if (commandName === "compopt") {
      return handleCompopt(this.ctx, args);
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
      return handleRead(this.ctx, args, stdin, stdinSourceFd);
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
    // eval: In non-POSIX mode, functions can override eval (handled above for POSIX mode)
    if (commandName === "eval") {
      return handleEval(this.ctx, args, stdin);
    }
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
        return await this.handleCommandV(cmdArgs, showPath, verboseDescribe);
      }

      // Run command without checking functions, but builtins are still available
      // Pass useDefaultPath to use /usr/bin:/bin instead of $PATH
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
      if (!SHELL_BUILTINS.has(cmd)) {
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
    if (commandName === "help") {
      return handleHelp(this.ctx, args);
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
    // For command -p, use default PATH /usr/bin:/bin instead of $PATH
    const defaultPath = "/usr/bin:/bin";
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
    // Handle error cases from resolveCommand
    if ("error" in resolved) {
      if (resolved.error === "permission_denied") {
        return failure(`bash: ${commandName}: Permission denied\n`, 126);
      }
      // not_found error
      return failure(`bash: ${commandName}: No such file or directory\n`, 127);
    }
    // Handle user scripts (executable files without registered command handlers)
    if ("script" in resolved) {
      // Add to hash table for PATH caching (only for non-path commands)
      if (!commandName.includes("/")) {
        if (!this.ctx.state.hashTable) {
          this.ctx.state.hashTable = new Map();
        }
        this.ctx.state.hashTable.set(commandName, resolved.path);
      }
      return await this.executeUserScript(resolved.path, args, stdin);
    }
    const { cmd, path: cmdPath } = resolved;
    // Add to hash table for PATH caching (only for non-path commands)
    if (!commandName.includes("/")) {
      if (!this.ctx.state.hashTable) {
        this.ctx.state.hashTable = new Map();
      }
      this.ctx.state.hashTable.set(commandName, cmdPath);
    }

    // Use groupStdin as fallback if no stdin from redirections/pipeline
    // This is needed for commands inside groups/functions that receive stdin via heredoc
    const effectiveStdin = stdin || this.ctx.state.groupStdin || "";

    // Build exported environment for commands that need it (printenv, env, etc.)
    // Most builtins need access to the full env to modify state
    const exportedEnv = this.buildExportedEnv();

    const cmdCtx: CommandContext = {
      fs: this.ctx.fs,
      cwd: this.ctx.state.cwd,
      env: this.ctx.state.env,
      exportedEnv,
      stdin: effectiveStdin,
      limits: this.ctx.limits,
      exec: this.ctx.execFn,
      fetch: this.ctx.fetch,
      getRegisteredCommands: () => Array.from(this.ctx.commands.keys()),
      sleep: this.ctx.sleep,
      trace: this.ctx.trace,
      fileDescriptors: this.ctx.state.fileDescriptors,
      xpgEcho: this.ctx.state.shoptOptions.xpg_echo,
    };

    try {
      return await cmd.execute(args, cmdCtx);
    } catch (error) {
      return failure(`${commandName}: ${getErrorMessage(error)}\n`);
    }
  }

  // ===========================================================================
  // ALIAS EXPANSION
  // ===========================================================================

  /**
   * Alias prefix used in environment variables
   */
  private static readonly ALIAS_PREFIX = "BASH_ALIAS_";

  /**
   * Track aliases currently being expanded to prevent infinite recursion
   */
  private aliasExpansionStack: Set<string> = new Set();

  /**
   * Check if a word is a literal unquoted word (eligible for alias expansion).
   * Aliases only expand for literal words, not for quoted strings or expansions.
   */
  private isLiteralUnquotedWord(word: WordNode): boolean {
    // Must have exactly one part that is a literal
    if (word.parts.length !== 1) return false;
    const part = word.parts[0];
    // Must be a Literal part (not quoted, not an expansion)
    return part.type === "Literal";
  }

  /**
   * Get the literal value of a word if it's a simple literal
   */
  private getLiteralValue(word: WordNode): string | null {
    if (word.parts.length !== 1) return null;
    const part = word.parts[0];
    if (part.type === "Literal") {
      return part.value;
    }
    return null;
  }

  /**
   * Get the alias value for a name, if defined
   */
  private getAlias(name: string): string | undefined {
    return this.ctx.state.env[`${Interpreter.ALIAS_PREFIX}${name}`];
  }

  /**
   * Expand alias in a SimpleCommandNode if applicable.
   * Returns a new node with the alias expanded, or the original node if no expansion.
   *
   * Alias expansion rules:
   * 1. Only expands if command name is a literal unquoted word
   * 2. Alias value is substituted for the command name
   * 3. If alias value ends with a space, the next word is also checked for alias expansion
   * 4. Recursive expansion is allowed but limited to prevent infinite loops
   */
  private expandAlias(node: SimpleCommandNode): SimpleCommandNode {
    // Need a command name to expand
    if (!node.name) return node;

    // Check if the command name is a literal unquoted word
    if (!this.isLiteralUnquotedWord(node.name)) return node;

    const cmdName = this.getLiteralValue(node.name);
    if (!cmdName) return node;

    // Check for alias
    const aliasValue = this.getAlias(cmdName);
    if (!aliasValue) return node;

    // Prevent infinite recursion
    if (this.aliasExpansionStack.has(cmdName)) return node;

    try {
      this.aliasExpansionStack.add(cmdName);

      // Parse the alias value as a command
      const parser = new Parser();
      // Build the full command line: alias value + original args
      // We need to combine the alias value with any remaining arguments
      let fullCommand = aliasValue;

      // Check if alias value ends with a space (triggers expansion of next word)
      const expandNext = aliasValue.endsWith(" ");

      // If not expanding next, append args directly
      if (!expandNext) {
        // Convert args to strings for re-parsing
        for (const arg of node.args) {
          const argLiteral = this.wordNodeToString(arg);
          fullCommand += ` ${argLiteral}`;
        }
      }

      // Parse the expanded command
      let expandedAst: ScriptNode;
      try {
        expandedAst = parser.parse(fullCommand);
      } catch (e) {
        // If parsing fails, return original node (let normal execution handle the error)
        if (e instanceof ParseException) {
          // Re-throw parse errors to be handled by the caller
          throw e;
        }
        return node;
      }

      // We expect exactly one statement with one command in the pipeline
      if (
        expandedAst.statements.length !== 1 ||
        expandedAst.statements[0].pipelines.length !== 1 ||
        expandedAst.statements[0].pipelines[0].commands.length !== 1
      ) {
        // Complex alias - might have multiple commands, pipelines, etc.
        // For now, execute as a script and wrap result
        // This is a simplification - full support would require more complex handling
        return this.handleComplexAlias(node, aliasValue);
      }

      const expandedCmd = expandedAst.statements[0].pipelines[0].commands[0];
      if (expandedCmd.type !== "SimpleCommand") {
        // Alias expanded to a compound command - let it execute directly
        return this.handleComplexAlias(node, aliasValue);
      }

      // Merge the expanded command with original node's context
      let newNode: SimpleCommandNode = {
        ...expandedCmd,
        // Preserve original assignments (prefix assignments like FOO=bar alias_cmd)
        assignments: [...node.assignments, ...expandedCmd.assignments],
        // Preserve original redirections
        redirections: [...expandedCmd.redirections, ...node.redirections],
        // Preserve line number
        line: node.line,
      };

      // If alias ends with space, expand next word too (recursive alias on first arg)
      if (expandNext && node.args.length > 0) {
        // Add the original args to the expanded command's args
        newNode = {
          ...newNode,
          args: [...newNode.args, ...node.args],
        };

        // Now recursively expand the first arg if it's an alias
        if (newNode.args.length > 0) {
          const firstArg = newNode.args[0];
          if (this.isLiteralUnquotedWord(firstArg)) {
            const firstArgName = this.getLiteralValue(firstArg);
            if (firstArgName && this.getAlias(firstArgName)) {
              // Create a temporary node with the first arg as command
              const tempNode: SimpleCommandNode = {
                type: "SimpleCommand",
                name: firstArg,
                args: newNode.args.slice(1),
                assignments: [],
                redirections: [],
              };
              const expandedFirst = this.expandAlias(tempNode);
              if (expandedFirst !== tempNode) {
                // Merge back
                newNode = {
                  ...newNode,
                  name: expandedFirst.name,
                  args: [...expandedFirst.args],
                };
              }
            }
          }
        }
      }

      // NOTE: We don't recursively call expandAlias here anymore - the caller
      // handles iterative expansion to avoid issues with stack management.
      // The aliasExpansionStack is cleared by the caller after all expansions complete.

      return newNode;
    } catch (e) {
      // On error, clean up our entry from the stack
      this.aliasExpansionStack.delete(cmdName);
      throw e;
    }
    // NOTE: No finally block - we intentionally leave cmdName in the stack
    // to prevent re-expansion of the same alias. The caller clears the stack.
  }

  /**
   * Handle complex alias that expands to multiple commands or pipelines.
   * For now, we create a wrapper that will execute the alias as a script.
   */
  private handleComplexAlias(
    node: SimpleCommandNode,
    aliasValue: string,
  ): SimpleCommandNode {
    // Build complete command string
    let fullCommand = aliasValue;
    for (const arg of node.args) {
      const argLiteral = this.wordNodeToString(arg);
      fullCommand += ` ${argLiteral}`;
    }

    // Create an eval-like command that will execute the alias
    // This is a workaround - we create a new SimpleCommand that calls eval
    const parser = new Parser();
    const evalWord = parser.parseWordFromString("eval", false, false);
    const cmdWord = parser.parseWordFromString(
      `'${fullCommand.replace(/'/g, "'\\''")}'`,
      false,
      false,
    );

    return {
      type: "SimpleCommand",
      name: evalWord,
      args: [cmdWord],
      assignments: node.assignments,
      redirections: node.redirections,
      line: node.line,
    };
  }

  /**
   * Convert a WordNode back to a string representation for re-parsing.
   * This is a simplified conversion that handles common cases.
   */
  private wordNodeToString(word: WordNode): string {
    let result = "";
    for (const part of word.parts) {
      switch (part.type) {
        case "Literal":
          // Escape special characters
          result += part.value.replace(/([\s"'$`\\*?[\]{}()<>|&;#!])/g, "\\$1");
          break;
        case "SingleQuoted":
          result += `'${part.value}'`;
          break;
        case "DoubleQuoted":
          // Handle double-quoted content
          result += `"${part.parts.map((p) => (p.type === "Literal" ? p.value : `$${p.type}`)).join("")}"`;
          break;
        case "ParameterExpansion":
          // Use braced form to be safe
          result += `\${${part.parameter}}`;
          break;
        case "CommandSubstitution":
          // CommandSubstitutionPart has body (ScriptNode), not command string
          // We need to reconstruct - for simplicity, wrap in $(...)
          result += `$(...)`;
          break;
        case "ArithmeticExpansion":
          result += `$((${part.expression}))`;
          break;
        case "Glob":
          result += part.pattern;
          break;
        default:
          // For other types, try to preserve as-is
          break;
      }
    }
    return result;
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
  ): Promise<
    | { cmd: Command; path: string }
    | { script: true; path: string }
    | { error: "not_found" | "permission_denied"; path?: string }
    | null
  > {
    // If command contains "/", it's a path - resolve directly
    if (commandName.includes("/")) {
      const resolvedPath = this.ctx.fs.resolvePath(
        this.ctx.state.cwd,
        commandName,
      );
      // Check if file exists
      if (!(await this.ctx.fs.exists(resolvedPath))) {
        return { error: "not_found", path: resolvedPath };
      }
      // Extract command name from path
      const cmdName = resolvedPath.split("/").pop() || commandName;
      const cmd = this.ctx.commands.get(cmdName);

      // Check file properties
      try {
        const stat = await this.ctx.fs.stat(resolvedPath);
        if (stat.isDirectory) {
          // Trying to execute a directory
          return { error: "permission_denied", path: resolvedPath };
        }
        // For registered commands (like /bin/echo), skip execute check
        // since they're our internal implementations
        if (cmd) {
          return { cmd, path: resolvedPath };
        }
        // For non-registered commands, check if the file is executable
        const isExecutable = (stat.mode & 0o111) !== 0;
        if (!isExecutable) {
          // File exists but is not executable - permission denied
          return { error: "permission_denied", path: resolvedPath };
        }
        // File exists and is executable - treat as user script
        return { script: true, path: resolvedPath };
      } catch {
        // If stat fails, treat as not found
        return { error: "not_found", path: resolvedPath };
      }
    }

    // Check hash table first (unless pathOverride is set, which bypasses cache)
    if (!pathOverride && this.ctx.state.hashTable) {
      const cachedPath = this.ctx.state.hashTable.get(commandName);
      if (cachedPath) {
        // Verify the cached path still exists
        if (await this.ctx.fs.exists(cachedPath)) {
          const cmd = this.ctx.commands.get(commandName);
          if (cmd) {
            return { cmd, path: cachedPath };
          }
          // Also check if it's an executable script (not just registered commands)
          try {
            const stat = await this.ctx.fs.stat(cachedPath);
            if (!stat.isDirectory && (stat.mode & 0o111) !== 0) {
              return { script: true, path: cachedPath };
            }
          } catch {
            // If stat fails, fall through to PATH search
          }
        } else {
          // Remove stale entry from hash table
          this.ctx.state.hashTable.delete(commandName);
        }
      }
    }

    // Search PATH directories (use override if provided, for command -p)
    const pathEnv = pathOverride ?? this.ctx.state.env.PATH ?? "/usr/bin:/bin";
    const pathDirs = pathEnv.split(":");

    for (const dir of pathDirs) {
      if (!dir) continue;
      // Resolve relative PATH directories against cwd
      const resolvedDir = dir.startsWith("/")
        ? dir
        : this.ctx.fs.resolvePath(this.ctx.state.cwd, dir);
      const fullPath = `${resolvedDir}/${commandName}`;
      if (await this.ctx.fs.exists(fullPath)) {
        // File exists - check if it's a directory
        try {
          const stat = await this.ctx.fs.stat(fullPath);
          if (stat.isDirectory) {
            continue; // Skip directories
          }
          const isExecutable = (stat.mode & 0o111) !== 0;
          // Check for registered command handler
          const cmd = this.ctx.commands.get(commandName);

          // Determine if this is a system directory where command stubs live
          const isSystemDir = dir === "/bin" || dir === "/usr/bin";

          if (cmd && isSystemDir) {
            // Registered commands in system directories work without execute bits
            // (they're our internal implementations with stub files)
            return { cmd, path: fullPath };
          }

          // For non-system directories (or non-registered commands), require executable
          if (isExecutable) {
            if (cmd && !isSystemDir) {
              // User script shadows a registered command - treat as script
              return { script: true, path: fullPath };
            }
            if (!cmd) {
              // No registered handler - treat as user script
              return { script: true, path: fullPath };
            }
          }
        } catch {}
      }
    }

    // Fallback: check registry directly only if /usr/bin doesn't exist
    // This maintains backward compatibility for OverlayFs and other non-InMemoryFs
    // where command stubs aren't created, while still respecting PATH for InMemoryFs
    const usrBinExists = await this.ctx.fs.exists("/usr/bin");
    if (!usrBinExists) {
      const cmd = this.ctx.commands.get(commandName);
      if (cmd) {
        return { cmd, path: `/usr/bin/${commandName}` };
      }
    }

    return null;
  }

  /**
   * Find all paths for a command in PATH (for `which -a`).
   */
  async findCommandInPath(commandName: string): Promise<string[]> {
    const paths: string[] = [];

    // If command contains /, it's a path - check if it exists and is executable
    if (commandName.includes("/")) {
      const resolvedPath = this.ctx.fs.resolvePath(
        this.ctx.state.cwd,
        commandName,
      );
      if (await this.ctx.fs.exists(resolvedPath)) {
        try {
          const stat = await this.ctx.fs.stat(resolvedPath);
          if (!stat.isDirectory) {
            // Check if file is executable (owner, group, or other execute bit set)
            const isExecutable = (stat.mode & 0o111) !== 0;
            if (isExecutable) {
              // Return the original path format (not resolved) to match bash behavior
              paths.push(commandName);
            }
          }
        } catch {
          // If stat fails, skip
        }
      }
      return paths;
    }

    const pathEnv = this.ctx.state.env.PATH || "/usr/bin:/bin";
    const pathDirs = pathEnv.split(":");

    for (const dir of pathDirs) {
      if (!dir) continue;
      // Resolve relative PATH entries relative to cwd
      const resolvedDir = dir.startsWith("/")
        ? dir
        : this.ctx.fs.resolvePath(this.ctx.state.cwd, dir);
      const fullPath = `${resolvedDir}/${commandName}`;
      if (await this.ctx.fs.exists(fullPath)) {
        // Check if it's a directory - skip directories
        try {
          const stat = await this.ctx.fs.stat(fullPath);
          if (stat.isDirectory) {
            continue;
          }
        } catch {
          continue;
        }
        // Return the original path format (relative if relative was given)
        paths.push(dir.startsWith("/") ? fullPath : `${dir}/${commandName}`);
      }
    }

    return paths;
  }

  // ===========================================================================
  // TYPE COMMAND
  // ===========================================================================

  private async handleType(args: string[]): Promise<ExecResult> {
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
          const allPaths = await this.findCommandInPath(name);
          if (allPaths.length > 0) {
            for (const p of allPaths) {
              stdout += `${p}\n`;
            }
            anyFileFound = true;
            foundAny = true;
          }
        } else {
          const pathResult = await this.findFirstInPath(name);
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
      const hasFunction =
        !suppressFunctions && this.ctx.state.functions.has(name);
      if (showAll && hasFunction) {
        // -p: print nothing for functions (no path)
        if (pathOnly) {
          // Do nothing - functions have no path
        } else if (typeOnly) {
          stdout += "function\n";
        } else {
          // Get the function body for display
          const funcDef = this.ctx.state.functions.get(name);
          const funcSource = funcDef
            ? this.formatFunctionSource(name, funcDef)
            : `${name} is a function\n`;
          stdout += funcSource;
        }
        foundAny = true;
      }

      // Check aliases
      // Aliases are stored in env with BASH_ALIAS_ prefix
      const alias = this.ctx.state.env[`BASH_ALIAS_${name}`];
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
          const funcDef = this.ctx.state.functions.get(name);
          const funcSource = funcDef
            ? this.formatFunctionSource(name, funcDef)
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
        const allPaths = await this.findCommandInPath(name);
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
        const pathResult = await this.findFirstInPath(name);
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
            const resolvedPath = this.ctx.fs.resolvePath(
              this.ctx.state.cwd,
              name,
            );
            if (await this.ctx.fs.exists(resolvedPath)) {
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
  private formatFunctionSource(name: string, funcDef: FunctionDefNode): string {
    // For function bodies that are Group nodes, unwrap them since we add { } ourselves
    let bodyStr: string;
    if (funcDef.body.type === "Group") {
      const group = funcDef.body as GroupNode;
      bodyStr = group.body
        .map((s) => this.serializeCompoundCommand(s))
        .join("; ");
    } else {
      bodyStr = this.serializeCompoundCommand(funcDef.body);
    }
    return `${name} is a function\n${name} () \n{ \n    ${bodyStr}\n}\n`;
  }

  /**
   * Serialize a compound command to its source representation.
   * This is a simplified serializer for function body display.
   */
  private serializeCompoundCommand(
    node: CommandNode | StatementNode | StatementNode[],
  ): string {
    if (Array.isArray(node)) {
      return node.map((s) => this.serializeCompoundCommand(s)).join("; ");
    }

    if (node.type === "Statement") {
      const parts: string[] = [];
      for (let i = 0; i < node.pipelines.length; i++) {
        const pipeline = node.pipelines[i];
        parts.push(this.serializePipeline(pipeline));
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
        parts.push(this.serializeWord(cmd.name));
      }
      for (const arg of cmd.args) {
        parts.push(this.serializeWord(arg));
      }
      return parts.join(" ");
    }

    if (node.type === "Group") {
      const group = node as GroupNode;
      const body = group.body
        .map((s) => this.serializeCompoundCommand(s))
        .join("; ");
      return `{ ${body}; }`;
    }

    // For other compound commands, return a placeholder
    return "...";
  }

  private serializePipeline(pipeline: PipelineNode): string {
    const parts = pipeline.commands.map((cmd) =>
      this.serializeCompoundCommand(cmd),
    );
    return (pipeline.negated ? "! " : "") + parts.join(" | ");
  }

  private serializeWord(word: WordNode): string {
    // Simple serialization - just concatenate parts
    let result = "";
    for (const part of word.parts) {
      if (part.type === "Literal") {
        result += part.value;
      } else if (part.type === "DoubleQuoted") {
        result += `"${part.parts.map((p) => this.serializeWordPart(p)).join("")}"`;
      } else if (part.type === "SingleQuoted") {
        result += `'${part.value}'`;
      } else {
        result += this.serializeWordPart(part);
      }
    }
    return result;
  }

  private serializeWordPart(part: unknown): string {
    const p = part as { type: string; value?: string; name?: string };
    if (p.type === "Literal") {
      return p.value ?? "";
    }
    if (p.type === "Variable") {
      return `$${p.name}`;
    }
    // For other part types, return empty or placeholder
    return "";
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
        // Check if it's a directory or not executable
        try {
          const stat = await this.ctx.fs.stat(resolvedPath);
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

    // Search PATH directories
    const pathEnv = this.ctx.state.env.PATH ?? "/usr/bin:/bin";
    const pathDirs = pathEnv.split(":");

    for (const dir of pathDirs) {
      if (!dir) continue;
      // Resolve relative PATH entries relative to cwd
      const resolvedDir = dir.startsWith("/")
        ? dir
        : this.ctx.fs.resolvePath(this.ctx.state.cwd, dir);
      const fullPath = `${resolvedDir}/${name}`;
      if (await this.ctx.fs.exists(fullPath)) {
        // Check if it's a directory
        try {
          const stat = await this.ctx.fs.stat(fullPath);
          if (stat.isDirectory) {
            continue; // Skip directories
          }
        } catch {
          // If stat fails, skip this path
          continue;
        }
        // Return the path as specified in PATH (not resolved) to match bash behavior
        return `${dir}/${name}`;
      }
    }

    // Fallback: check if command exists in registry
    // This handles virtual filesystems where commands are registered but
    // not necessarily present as individual files in /usr/bin
    if (this.ctx.commands.has(name)) {
      // Return path in the first PATH directory that contains /usr/bin or /bin, or default to /usr/bin
      for (const dir of pathDirs) {
        if (dir === "/usr/bin" || dir === "/bin") {
          return `${dir}/${name}`;
        }
      }
      return `/usr/bin/${name}`;
    }

    return null;
  }

  /**
   * Handle `command -v` and `command -V` flags
   * -v: print the name or path of the command (simple output)
   * -V: print a description like `type` does (verbose output)
   */
  private async handleCommandV(
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
      const alias = this.ctx.state.env[`BASH_ALIAS_${name}`];
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
      } else if (this.ctx.state.functions.has(name)) {
        if (verboseDescribe) {
          stdout += `${name} is a function\n`;
        } else {
          stdout += `${name}\n`;
        }
      } else if (name.includes("/")) {
        // Path containing / - check if file exists and is executable
        const resolvedPath = this.ctx.fs.resolvePath(this.ctx.state.cwd, name);
        let found = false;
        if (await this.ctx.fs.exists(resolvedPath)) {
          try {
            const stat = await this.ctx.fs.stat(resolvedPath);
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
      } else if (this.ctx.commands.has(name)) {
        // Search PATH for the command file (registered commands exist in both /usr/bin and /bin)
        const pathEnv = this.ctx.state.env.PATH ?? "/usr/bin:/bin";
        const pathDirs = pathEnv.split(":");
        let foundPath: string | null = null;
        for (const dir of pathDirs) {
          if (!dir) continue;
          const cmdPath = `${dir}/${name}`;
          try {
            const stat = await this.ctx.fs.stat(cmdPath);
            if (!stat.isDirectory && (stat.mode & 0o111) !== 0) {
              foundPath = cmdPath;
              break;
            }
          } catch {
            // File doesn't exist in this directory, continue searching
          }
        }
        // Fall back to /usr/bin if not found in PATH (shouldn't happen for registered commands)
        if (!foundPath) {
          foundPath = `/usr/bin/${name}`;
        }
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

    // Save local variable scoping state for subshell isolation
    // Subshell gets a copy of these, but changes don't affect parent
    const savedLocalScopes = this.ctx.state.localScopes;
    const savedLocalVarStack = this.ctx.state.localVarStack;
    const savedLocalVarDepth = this.ctx.state.localVarDepth;
    const savedFullyUnsetLocals = this.ctx.state.fullyUnsetLocals;

    // Deep copy the local scoping structures for the subshell
    this.ctx.state.localScopes = savedLocalScopes.map(
      (scope) => new Map(scope),
    );
    if (savedLocalVarStack) {
      this.ctx.state.localVarStack = new Map();
      for (const [name, stack] of savedLocalVarStack.entries()) {
        this.ctx.state.localVarStack.set(
          name,
          stack.map((entry) => ({ ...entry })),
        );
      }
    }
    if (savedLocalVarDepth) {
      this.ctx.state.localVarDepth = new Map(savedLocalVarDepth);
    }
    if (savedFullyUnsetLocals) {
      this.ctx.state.fullyUnsetLocals = new Map(savedFullyUnsetLocals);
    }

    // Reset loopDepth in subshell - break/continue should not affect parent loops
    const savedLoopDepth = this.ctx.state.loopDepth;
    // Track if parent has loop context - break/continue in subshell should exit subshell
    const savedParentHasLoopContext = this.ctx.state.parentHasLoopContext;
    this.ctx.state.parentHasLoopContext = savedLoopDepth > 0;
    this.ctx.state.loopDepth = 0;

    // Save $_ (last argument) - subshell execution should not affect parent's $_
    const savedLastArg = this.ctx.state.lastArg;

    // Subshells get a new BASHPID (unlike $$ which stays the same)
    const savedBashPid = this.ctx.state.bashPid;
    this.ctx.state.bashPid = this.ctx.state.nextVirtualPid++;

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
      this.ctx.state.localScopes = savedLocalScopes;
      this.ctx.state.localVarStack = savedLocalVarStack;
      this.ctx.state.localVarDepth = savedLocalVarDepth;
      this.ctx.state.fullyUnsetLocals = savedFullyUnsetLocals;
      this.ctx.state.loopDepth = savedLoopDepth;
      this.ctx.state.parentHasLoopContext = savedParentHasLoopContext;
      this.ctx.state.groupStdin = savedGroupStdin;
      this.ctx.state.bashPid = savedBashPid;
      this.ctx.state.lastArg = savedLastArg;
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
    this.ctx.state.localScopes = savedLocalScopes;
    this.ctx.state.localVarStack = savedLocalVarStack;
    this.ctx.state.localVarDepth = savedLocalVarDepth;
    this.ctx.state.fullyUnsetLocals = savedFullyUnsetLocals;
    this.ctx.state.loopDepth = savedLoopDepth;
    this.ctx.state.parentHasLoopContext = savedParentHasLoopContext;
    this.ctx.state.groupStdin = savedGroupStdin;
    this.ctx.state.bashPid = savedBashPid;
    this.ctx.state.lastArg = savedLastArg;

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
