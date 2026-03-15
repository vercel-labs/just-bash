/**
 * Builtin Command Dispatch
 *
 * Handles dispatch of built-in shell commands like export, unset, cd, etc.
 * Separated from interpreter.ts for modularity.
 */

import { isBrowserExcludedCommand } from "../commands/browser-excluded.js";
import { sanitizeErrorMessage } from "../fs/sanitize-error.js";
import { awaitWithDefenseContext } from "../security/defense-context.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "../security/defense-in-depth-box.js";
import type {
  CommandContext,
  ExecResult,
  ProcessTableEntry,
} from "../types.js";
import {
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
} from "./builtins/index.js";
import { handleShopt } from "./builtins/shopt.js";
import {
  findCommandInPath as findCommandInPathHelper,
  resolveCommand as resolveCommandHelper,
} from "./command-resolution.js";
import { evaluateTestArgs } from "./conditionals.js";
import { createDefenseAwareCommandContext } from "./defense-aware-command-context.js";
import { ExecutionLimitError } from "./errors.js";
import { callFunction } from "./functions.js";
import { getErrorMessage } from "./helpers/errors.js";
import { failure, OK, testResult } from "./helpers/result.js";
import { SHELL_BUILTINS } from "./helpers/shell-constants.js";
import { BrokenPipeError } from "./pipe-channel.js";
import {
  findFirstInPath as findFirstInPathHelper,
  handleCommandV as handleCommandVHelper,
  handleType as handleTypeHelper,
} from "./type-command.js";
import type { InterpreterContext } from "./types.js";

/** Wrap a buffered stdin string as a single-chunk async iterable. */
function stdinToAsyncIterable(stdin: string): AsyncIterable<string> {
  if (!stdin) {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ value: undefined, done: true as const }),
      }),
    };
  }
  let consumed = false;
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        if (consumed) {
          return Promise.resolve({ value: undefined, done: true as const });
        }
        consumed = true;
        return Promise.resolve({ value: stdin, done: false as const });
      },
    }),
  };
}

/**
 * Type for the function that runs a command recursively
 */
export type RunCommandFn = (
  commandName: string,
  args: string[],
  quotedArgs: boolean[],
  stdin: string,
  skipFunctions?: boolean,
  useDefaultPath?: boolean,
  stdinSourceFd?: number,
) => Promise<ExecResult>;

/**
 * Type for the function that builds exported environment
 */
export type BuildExportedEnvFn = () => Record<string, string>;

/**
 * Type for the function that executes user scripts
 */
export type ExecuteUserScriptFn = (
  scriptPath: string,
  args: string[],
  stdin?: string,
) => Promise<ExecResult>;

/**
 * Dispatch context containing dependencies needed for builtin dispatch
 */
export interface BuiltinDispatchContext {
  ctx: InterpreterContext;
  runCommand: RunCommandFn;
  buildExportedEnv: BuildExportedEnvFn;
  executeUserScript: ExecuteUserScriptFn;
  /** Streaming context for the current pipeline stage (if any). */
  streamCtx?: {
    writeStdout: (chunk: string) => Promise<void>;
    writeStderr: (chunk: string) => Promise<void>;
    stdinStream?: AsyncIterable<string>;
    abortUpstream: () => void;
    collectedStdout?: string;
  };
}

/**
 * Dispatch a command to the appropriate builtin handler or external command.
 * Returns null if the command should be handled by external command resolution.
 */
export async function dispatchBuiltin(
  dispatchCtx: BuiltinDispatchContext,
  commandName: string,
  args: string[],
  _quotedArgs: boolean[],
  stdin: string,
  skipFunctions: boolean,
  _useDefaultPath: boolean,
  stdinSourceFd: number,
): Promise<ExecResult | null> {
  const { ctx, runCommand } = dispatchCtx;

  // Coverage tracking for builtins (lightweight: only fires when coverage is enabled)
  if (ctx.coverage && SHELL_BUILTINS.has(commandName)) {
    ctx.coverage.hit(`bash:builtin:${commandName}`);
  }

  // Built-in commands (special builtins that cannot be overridden by functions)
  if (commandName === "export") {
    return handleExport(ctx, args);
  }
  if (commandName === "unset") {
    return handleUnset(ctx, args);
  }
  if (commandName === "exit") {
    return handleExit(ctx, args);
  }
  if (commandName === "local") {
    return handleLocal(ctx, args);
  }
  if (commandName === "set") {
    return handleSet(ctx, args);
  }
  if (commandName === "break") {
    return handleBreak(ctx, args);
  }
  if (commandName === "continue") {
    return handleContinue(ctx, args);
  }
  if (commandName === "return") {
    return handleReturn(ctx, args);
  }
  // In POSIX mode, eval is a special builtin that cannot be overridden by functions
  // In non-POSIX mode (bash default), functions can override eval
  if (commandName === "eval" && ctx.state.options.posix) {
    return handleEval(ctx, args, stdin);
  }
  if (commandName === "shift") {
    return handleShift(ctx, args);
  }
  if (commandName === "getopts") {
    return handleGetopts(ctx, args);
  }
  if (commandName === "compgen") {
    return handleCompgen(ctx, args);
  }
  if (commandName === "complete") {
    return handleComplete(ctx, args);
  }
  if (commandName === "compopt") {
    return handleCompopt(ctx, args);
  }
  if (commandName === "pushd") {
    return await handlePushd(ctx, args);
  }
  if (commandName === "popd") {
    return handlePopd(ctx, args);
  }
  if (commandName === "dirs") {
    return handleDirs(ctx, args);
  }
  if (commandName === "source" || commandName === ".") {
    return handleSource(ctx, args);
  }
  if (commandName === "read") {
    return handleRead(ctx, args, stdin, stdinSourceFd);
  }
  if (commandName === "mapfile" || commandName === "readarray") {
    return handleMapfile(ctx, args, stdin);
  }
  if (commandName === "declare" || commandName === "typeset") {
    return handleDeclare(ctx, args);
  }
  if (commandName === "readonly") {
    return handleReadonly(ctx, args);
  }
  // User-defined functions override most builtins (except special ones above)
  // This needs to happen before true/false/let which are regular builtins
  if (!skipFunctions) {
    const func = ctx.state.functions.get(commandName);
    if (func) {
      return callFunction(ctx, func, args, stdin);
    }
  }
  // Simple builtins (can be overridden by functions)
  // eval: In non-POSIX mode, functions can override eval (handled above for POSIX mode)
  if (commandName === "eval") {
    return handleEval(ctx, args, stdin);
  }
  if (commandName === "cd") {
    return await handleCd(ctx, args);
  }
  if (commandName === ":" || commandName === "true") {
    return OK;
  }
  if (commandName === "false") {
    return testResult(false);
  }
  if (commandName === "let") {
    return handleLet(ctx, args);
  }
  if (commandName === "command") {
    return handleCommandBuiltin(dispatchCtx, args, stdin);
  }
  if (commandName === "builtin") {
    return handleBuiltinBuiltin(dispatchCtx, args, stdin);
  }
  if (commandName === "shopt") {
    return handleShopt(ctx, args);
  }
  if (commandName === "exec") {
    // exec - replace shell with command (stub: just run the command)
    if (args.length === 0) {
      return OK;
    }
    const [cmd, ...rest] = args;
    return runCommand(cmd, rest, [], stdin, false, false, -1);
  }
  if (commandName === "wait") {
    const { handleWait } = await import("./builtins/wait.js");
    return handleWait(ctx, args);
  }
  if (commandName === "jobs") {
    const { handleJobs } = await import("./builtins/jobs.js");
    return handleJobs(ctx, args);
  }
  if (commandName === "kill") {
    const { handleKill } = await import("./builtins/kill.js");
    return handleKill(ctx, args);
  }
  if (commandName === "disown") {
    const { handleDisown } = await import("./builtins/disown.js");
    return handleDisown(ctx, args);
  }
  if (commandName === "fg") {
    const { handleFg } = await import("./builtins/disown.js");
    return handleFg();
  }
  if (commandName === "bg") {
    const { handleBg } = await import("./builtins/disown.js");
    return handleBg();
  }
  if (commandName === "type") {
    return await handleTypeHelper(
      ctx,
      args,
      (name) => findFirstInPathHelper(ctx, name),
      (name) => findCommandInPathHelper(ctx, name),
    );
  }
  if (commandName === "hash") {
    return handleHash(ctx, args);
  }
  if (commandName === "help") {
    return handleHelp(ctx, args);
  }
  // Test commands
  // Note: [[ is NOT handled here because it's a keyword, not a command.
  if (commandName === "[" || commandName === "test") {
    let testArgs = args;
    if (commandName === "[") {
      if (args[args.length - 1] !== "]") {
        return failure("[: missing `]'\n", 2);
      }
      testArgs = args.slice(0, -1);
    }
    return evaluateTestArgs(ctx, testArgs);
  }

  // Return null to indicate command should be handled by external resolution
  return null;
}

/**
 * Handle the 'command' builtin
 */
async function handleCommandBuiltin(
  dispatchCtx: BuiltinDispatchContext,
  args: string[],
  stdin: string,
): Promise<ExecResult> {
  const { ctx, runCommand } = dispatchCtx;

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
    return await handleCommandVHelper(ctx, cmdArgs, showPath, verboseDescribe);
  }

  // Run command without checking functions, but builtins are still available
  // Pass useDefaultPath to use /usr/bin:/bin instead of $PATH
  const [cmd, ...rest] = cmdArgs;
  return runCommand(cmd, rest, [], stdin, true, useDefaultPath, -1);
}

/**
 * Handle the 'builtin' builtin
 */
async function handleBuiltinBuiltin(
  dispatchCtx: BuiltinDispatchContext,
  args: string[],
  stdin: string,
): Promise<ExecResult> {
  const { runCommand } = dispatchCtx;

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
  return runCommand(cmd, rest, [], stdin, true, false, -1);
}

/**
 * Handle external command resolution and execution.
 * Called when dispatchBuiltin returns null.
 */
export async function executeExternalCommand(
  dispatchCtx: BuiltinDispatchContext,
  commandName: string,
  args: string[],
  stdin: string,
  useDefaultPath: boolean,
): Promise<ExecResult> {
  const { ctx, buildExportedEnv, executeUserScript } = dispatchCtx;

  // External commands - resolve via PATH
  // For command -p, use default PATH /usr/bin:/bin instead of $PATH
  const defaultPath = "/usr/bin:/bin";
  const resolved = await resolveCommandHelper(
    ctx,
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
      if (!ctx.state.hashTable) {
        ctx.state.hashTable = new Map();
      }
      ctx.state.hashTable.set(commandName, resolved.path);
    }
    return await executeUserScript(resolved.path, args, stdin);
  }
  const { cmd, path: cmdPath } = resolved;
  // Add to hash table for PATH caching (only for non-path commands)
  if (!commandName.includes("/")) {
    if (!ctx.state.hashTable) {
      ctx.state.hashTable = new Map();
    }
    ctx.state.hashTable.set(commandName, cmdPath);
  }

  // Use groupStdin as fallback if no stdin from redirections/pipeline
  // This is needed for commands inside groups/functions that receive stdin via heredoc
  const effectiveStdin = stdin || ctx.state.groupStdin || "";

  // Build exported environment for commands that need it (printenv, env, etc.)
  // Most builtins need access to the full env to modify state
  const exportedEnv = buildExportedEnv();

  // Build process table from job table for `ps` command
  let processTable: ProcessTableEntry[] | undefined;
  if (ctx.state.jobTable && ctx.state.jobTable.size > 0) {
    processTable = [];
    for (const [, job] of ctx.state.jobTable) {
      processTable.push({
        pid: job.pid,
        command: job.command,
        status: job.status,
      });
    }
  }

  const cmdCtx: CommandContext = {
    fs: ctx.fs,
    cwd: ctx.state.cwd,
    env: ctx.state.env,
    exportedEnv,
    stdin: effectiveStdin,
    limits: ctx.limits,
    exec: ctx.execFn,
    fetch: ctx.fetch,
    getRegisteredCommands: () => Array.from(ctx.commands.keys()),
    sleep: ctx.sleep,
    trace: ctx.trace,
    fileDescriptors: ctx.state.fileDescriptors,
    xpgEcho: ctx.state.shoptOptions.xpg_echo,
    coverage: ctx.coverage,
    signal: ctx.state.signal,
    requireDefenseContext: ctx.requireDefenseContext,
    jsBootstrapCode: ctx.jsBootstrapCode,
    processTable,
    // writeStdout/writeStderr are always real. In a pipeline, they come
    // from StreamContext. Outside a pipeline, they collect into
    // standaloneCollector. Commands may use writeStdout OR return stdout,
    // not both (enforced by assertion after execute).
    writeStdout:
      dispatchCtx.streamCtx?.writeStdout ??
      (async (chunk: string): Promise<void> => {
        standaloneCollector.stdout += chunk;
      }),
    writeStderr:
      dispatchCtx.streamCtx?.writeStderr ??
      (async (chunk: string): Promise<void> => {
        standaloneCollector.stderr += chunk;
      }),
    stdinStream:
      dispatchCtx.streamCtx?.stdinStream ??
      stdinToAsyncIterable(effectiveStdin),
    abortUpstream: dispatchCtx.streamCtx?.abortUpstream,
  };
  // Collectors for standalone commands (no pipeline context).
  const standaloneCollector = { stdout: "", stderr: "" };

  const guardedCmdCtx = createDefenseAwareCommandContext(cmdCtx, commandName);

  try {
    const runCommand = () =>
      awaitWithDefenseContext(
        ctx.requireDefenseContext,
        "command",
        `${commandName} execution`,
        () => cmd.execute(args, guardedCmdCtx),
      );

    const raw = cmd.trusted
      ? await DefenseInDepthBox.runTrustedAsync(() => runCommand())
      : await runCommand();

    const rawStdout = raw.stdout ?? "";
    const rawStderr = raw.stderr ?? "";

    // Mutual exclusivity: a command must write via writeStdout OR return
    // stdout in its result, never both. Doing both is a bug.
    if (standaloneCollector.stdout && rawStdout) {
      throw new Error(
        `${commandName}: bug: command wrote to writeStdout AND returned non-empty stdout — use one or the other`,
      );
    }

    // Normalize CommandResult → ExecResult.
    // If writeStdout was used (standalone), collector has the output.
    // If not, raw.stdout has it. In pipeline context, standaloneCollector
    // is always empty — output went to the pipeline's StreamContext.
    const result: ExecResult = {
      stdout: standaloneCollector.stdout || rawStdout,
      stderr: standaloneCollector.stderr
        ? standaloneCollector.stderr + rawStderr
        : rawStderr,
      exitCode: raw.exitCode,
      // @banned-pattern-ignore: spread from command result, only stdoutEncoding
      ...(raw.stdoutEncoding ? { stdoutEncoding: raw.stdoutEncoding } : {}),
    };

    return result;
  } catch (error) {
    // ExecutionLimitError must propagate - these are safety limits
    if (error instanceof ExecutionLimitError) {
      throw error;
    }
    // Security violations must propagate to top-level error handling
    if (error instanceof SecurityViolationError) {
      throw error;
    }
    // BrokenPipeError = downstream aborted (SIGPIPE). Exit 141 (128+13).
    // Commands don't need to catch this — the framework handles it.
    if (error instanceof BrokenPipeError) {
      return { stdout: "", stderr: "", exitCode: error.exitCode };
    }
    return failure(
      `${commandName}: ${sanitizeErrorMessage(getErrorMessage(error))}\n`,
    );
  }
}
