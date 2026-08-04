/**
 * Builtin Command Dispatch
 *
 * Handles dispatch of built-in shell commands like export, unset, cd, etc.
 * Separated from interpreter.ts for modularity.
 */

import { isBrowserExcludedCommand } from "../commands/browser-excluded.js";
import { latin1FromBytes, unsafeBytesFromLatin1 } from "../encoding.js";
import {
  createCommandExecutionBudget,
  type ExecutionScope,
} from "../execution-scope.js";
import { getFileSystemIdentity, isFileSystemIdentity } from "../fs/identity.js";
import { sanitizeErrorMessage } from "../fs/sanitize-error.js";
import { awaitWithDefenseContext } from "../security/defense-context.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "../security/defense-in-depth-box.js";
import { _Proxy } from "../security/trusted-globals.js";
import { _clearFiniteTimeout, _setTimeoutIfFinite } from "../timers.js";
import type { ExecResult, RuntimeCommandContext } from "../types.js";
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
import {
  ExecutionAbortedError,
  ExecutionLimitError,
  ExitError,
} from "./errors.js";
import { callFunction } from "./functions.js";
import { setArrayElement } from "./helpers/array.js";
import { getErrorMessage } from "./helpers/errors.js";
import { resolveNamerefForAssignment } from "./helpers/nameref.js";
import { isReadonly } from "./helpers/readonly.js";
import { failure, OK, testResult } from "./helpers/result.js";
import { SHELL_BUILTINS } from "./helpers/shell-constants.js";
import { computeIndexedArrayIndex } from "./simple-command-assignments.js";
import {
  findFirstInPath as findFirstInPathHelper,
  handleCommandV as handleCommandVHelper,
  handleType as handleTypeHelper,
} from "./type-command.js";
import type { InterpreterContext } from "./types.js";

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

interface RevocableCommandContext {
  context: RuntimeCommandContext;
  revoke(): void;
}

/**
 * Give host extensions capabilities that become unusable once their invocation
 * has ended. JavaScript promises cannot be forcibly terminated, but a late
 * continuation must not retain a working filesystem, environment, or shell
 * callback after its result has been abandoned.
 */
function createRevocableCommandContext(
  context: RuntimeCommandContext,
  commandName: string,
): RevocableCommandContext {
  let active = true;
  const facadeAbort = context.signal ? new AbortController() : undefined;
  const wrappedValues = new WeakMap<object, object>();
  const assertActive = () => {
    if (!active) {
      throw new ExecutionAbortedError(
        "",
        `bash: ${commandName} used its context after cancellation\n`,
      );
    }
  };

  /**
   * Apply one revocation membrane to every capability that crosses from the
   * interpreter into an extension. In particular, wrapping only the methods
   * on RuntimeCommandContext is insufficient: methods such as registerCleanup() and
   * enterDepth() return new callable capabilities which would otherwise remain
   * usable after the invocation has been cancelled.
   */
  const wrapValue = (value: unknown): unknown => {
    if (
      value === null ||
      (typeof value !== "object" && typeof value !== "function")
    ) {
      return value;
    }

    const cached = wrappedValues.get(value);
    if (cached !== undefined) return cached;

    // Filesystem identities are frozen, inert WeakMap keys. Preserve the
    // stable token across invocations; copying it would split SQLite and other
    // per-filesystem coordination domains.
    if (typeof value === "object" && isFileSystemIdentity(value)) return value;

    // Binary buffers are inert command data, not ambient capabilities.
    // Proxying an ArrayBuffer view is observably invalid: typed-array accessors
    // require a real typed-array receiver, and structured clone rejects the
    // proxy. Return an invocation-owned copy so commands can inspect/pass file
    // bytes normally without retaining the filesystem's backing allocation.
    if (value instanceof Uint8Array) {
      const copy = new Uint8Array(value);
      wrappedValues.set(value, copy);
      return copy;
    }
    if (value instanceof ArrayBuffer) {
      const copy = value.slice(0);
      wrappedValues.set(value, copy);
      return copy;
    }

    if (value instanceof Promise) {
      const wrappedPromise = value.then((result) => {
        assertActive();
        return wrapValue(result);
      });
      wrappedValues.set(value, wrappedPromise);
      return wrappedPromise;
    }

    if (typeof value === "function") {
      const callable = function (this: unknown, ...args: unknown[]) {
        assertActive();
        return wrapValue(Reflect.apply(value, this, args));
      };
      wrappedValues.set(value, callable);
      return callable;
    }

    const prototype = Object.getPrototypeOf(value);
    if (
      Array.isArray(value) ||
      prototype === Object.prototype ||
      prototype === null
    ) {
      // Records and arrays are data, not ambient authority. Copy them so an
      // ordinary command result remains readable after this invocation is
      // revoked, while recursively membrane-wrapping any callable capability
      // stored inside (for example ResourceLease.release).
      const copy: object = Array.isArray(value) ? [] : Object.create(prototype);
      wrappedValues.set(value, copy);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const descriptor of Object.values(descriptors)) {
        if ("value" in descriptor) {
          const member = descriptor.value;
          descriptor.value =
            typeof member === "function"
              ? (...args: unknown[]) => {
                  assertActive();
                  return wrapValue(Reflect.apply(member, value, args));
                }
              : wrapValue(member);
        }
        if (descriptor.get) {
          const getter = descriptor.get;
          descriptor.get = () => {
            assertActive();
            return wrapValue(Reflect.apply(getter, value, []));
          };
        }
        if (descriptor.set) {
          const setter = descriptor.set;
          descriptor.set = (nextValue: unknown) => {
            assertActive();
            Reflect.apply(setter, value, [nextValue]);
          };
        }
      }
      Object.defineProperties(copy, descriptors);
      return copy;
    }

    const methods = new Map<PropertyKey, unknown>();
    const proxy = new _Proxy(value, {
      get(object, property) {
        assertActive();
        if (
          property === "constructor" ||
          property === "prototype" ||
          property === "__proto__"
        ) {
          throw new Error(`${commandName}: unsafe context property access`);
        }
        // @banned-pattern-ignore: prototype gadget keys are rejected above;
        // symbols and remaining names are ordinary properties of a fixed host capability.
        const result = Reflect.get(object, property, object);
        if (typeof result !== "function") return wrapValue(result);
        if (methods.has(property)) return methods.get(property);
        const wrapped = (...args: unknown[]) => {
          assertActive();
          return wrapValue(Reflect.apply(result, object, args));
        };
        methods.set(property, wrapped);
        return wrapped;
      },
      set(object, property, nextValue) {
        assertActive();
        if (
          property === "constructor" ||
          property === "prototype" ||
          property === "__proto__"
        ) {
          throw new Error(`${commandName}: unsafe context property access`);
        }
        // @banned-pattern-ignore: prototype gadget keys are rejected above on this fixed host capability
        return Reflect.set(object, property, nextValue, object);
      },
    });
    wrappedValues.set(value, proxy);
    return proxy;
  };

  const wrapCapability = <T extends object>(target: T): T => {
    return wrapValue(target) as T;
  };

  const wrapFunction = <T extends ((...args: never[]) => unknown) | undefined>(
    fn: T,
  ): T => {
    if (!fn) return fn;
    return ((...args: never[]) => {
      assertActive();
      return wrapValue(fn(...args));
    }) as T;
  };

  return {
    context: {
      ...context,
      fs: wrapCapability(context.fs),
      env: wrapCapability(context.env),
      limits: Object.freeze({ ...context.limits }),
      exportedEnv: context.exportedEnv
        ? Object.freeze({ ...context.exportedEnv })
        : undefined,
      executionScope: context.executionScope
        ? wrapCapability(context.executionScope)
        : undefined,
      fileDescriptors: context.fileDescriptors
        ? wrapCapability(context.fileDescriptors)
        : undefined,
      coverage: context.coverage ? wrapCapability(context.coverage) : undefined,
      assignShellVariable: wrapFunction(context.assignShellVariable),
      exec: wrapFunction(context.exec),
      execWithInheritedStdin: wrapFunction(context.execWithInheritedStdin),
      fetch: wrapFunction(context.fetch),
      getRegisteredCommands: wrapFunction(context.getRegisteredCommands),
      sleep: wrapFunction(context.sleep),
      trace: wrapFunction(context.trace),
      invokeTool: wrapFunction(context.invokeTool),
      signal: facadeAbort?.signal,
    },
    revoke() {
      active = false;
      if (!facadeAbort?.signal.aborted) {
        facadeAbort?.abort(
          new ExecutionAbortedError(
            "",
            `bash: ${commandName} context revoked\n`,
          ),
        );
      }
    },
  };
}

async function runWithExecutionDeadline(
  run: () => Promise<ExecResult>,
  context: RuntimeCommandContext,
  revoke: () => void,
  commandName: string,
  rawScope: ExecutionScope,
  rawSignal: AbortSignal | undefined,
): Promise<ExecResult> {
  const remainingMs =
    rawScope.remainingTimeMs() ?? context.limits.maxExecutionTimeMs;
  const graceMs = context.limits.maxExtensionCleanupTimeMs;
  let deadlineTimer: ReturnType<typeof _setTimeoutIfFinite>;
  let abortListener: (() => void) | undefined;
  let graceTimer: ReturnType<typeof _setTimeoutIfFinite>;

  const commandPromise = Promise.resolve().then(run);
  const settled = commandPromise.then(
    (result) => ({ kind: "result" as const, result }),
    (error: unknown) => ({ kind: "error" as const, error }),
  );
  const aborted = new Promise<{ kind: "abort" } | { kind: "deadline" }>(
    (resolve) => {
      const finishAbort = () => {
        revoke();
        resolve({ kind: "abort" });
      };
      abortListener = finishAbort;
      rawSignal?.addEventListener("abort", finishAbort, { once: true });
      if (rawSignal?.aborted) finishAbort();
      deadlineTimer = _setTimeoutIfFinite(() => {
        revoke();
        resolve({ kind: "deadline" });
      }, remainingMs);
    },
  );

  try {
    const outcome = await Promise.race([settled, aborted]);
    if (outcome.kind === "result") return outcome.result;
    if (outcome.kind === "error") throw outcome.error;

    // Revoke shell-visible capabilities as soon as cancellation wins. The
    // grace period is only for the extension promise to settle; it must not
    // be an extra window for filesystem, descriptor, or budget mutation.
    revoke();
    const acknowledged = await Promise.race([
      settled.then(() => true),
      new Promise<false>((resolve) => {
        graceTimer = _setTimeoutIfFinite(() => resolve(false), graceMs);
      }),
    ]);
    const error =
      outcome.kind === "deadline"
        ? new ExecutionAbortedError(
            "",
            `bash: ${commandName} exceeded its execution deadline\n`,
          )
        : new ExecutionAbortedError("", "bash: execution aborted\n");
    if (!acknowledged) rawScope.poisonAfterAbort(error);
    throw error;
  } finally {
    revoke();
    _clearFiniteTimeout(deadlineTimer);
    _clearFiniteTimeout(graceTimer);
    if (abortListener) {
      rawSignal?.removeEventListener("abort", abortListener);
    }
  }
}

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
  // Internal transform primitive, reached through `builtin` so a user-defined
  // function with this name remains ordinary shell state. Arguments have
  // already expanded from one PIPESTATUS snapshot before dispatch.
  if (commandName === "__just_bash_tee_restore") {
    if (args.length === 0 || args.length > ctx.limits.maxArrayElements)
      return failure("bash: invalid internal pipeline status restore\n", 2);
    const statuses: number[] = [];
    for (const arg of args) {
      if (!/^(?:0|[1-9][0-9]{0,2})$/.test(arg))
        return failure("bash: invalid internal pipeline status restore\n", 2);
      const status = Number(arg);
      if (!Number.isSafeInteger(status) || status > 255)
        return failure("bash: invalid internal pipeline status restore\n", 2);
      statuses.push(status);
    }
    const last = statuses[statuses.length - 1] ?? 0;
    const rightmostFailure = [...statuses].reverse().find((code) => code !== 0);
    return {
      stdout: "",
      stderr: "",
      exitCode:
        ctx.state.options.pipefail && rightmostFailure !== undefined
          ? rightmostFailure
          : last,
      internalPipeStatusOverride: statuses,
    };
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
    // wait - wait for background jobs (stub: no-op in this context)
    return OK;
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
  if (cmd !== "__just_bash_tee_restore" && !SHELL_BUILTINS.has(cmd)) {
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

  // Use groupStdin as fallback if no stdin from redirections/pipeline —
  // needed for commands inside groups/functions that receive stdin via
  // heredoc. The pipeline glue (pipeline-execution.ts) and the
  // stdin-source sites (heredoc, here-string, `< file`, options.stdin)
  // are responsible for handing us a latin1-shaped byte buffer; we just
  // brand it. Commands that decode their input internally (sed, jq,
  // ...) return text via `textOutput()`, and the pipe / redirect layer
  // converts to bytes on their behalf.
  const effectiveStdin = unsafeBytesFromLatin1(
    stdin || ctx.state.groupStdin || "",
  );

  // Build exported environment for commands that need it (printenv, env, etc.)
  // Most builtins need access to the full env to modify state
  const exportedEnv = buildExportedEnv();

  // Give extensions one stable, revocable descriptor capability even when
  // this invocation has not created any extra descriptors yet.
  ctx.state.fileDescriptors ??= new Map();
  const cmdCtx: RuntimeCommandContext = {
    fs: ctx.fs,
    fsIdentity: getFileSystemIdentity(ctx.fs),
    cwd: ctx.state.cwd,
    env: ctx.state.env,
    assignShellVariable: async (name, value, subscript) => {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(`${name}: not a valid identifier`);
      }
      const requestedTarget =
        subscript === undefined ? name : `${name}[${subscript}]`;
      const resolvedTarget = resolveNamerefForAssignment(ctx, name, value);
      if (resolvedTarget === undefined) {
        throw new Error(`${name}: circular name reference`);
      }
      if (resolvedTarget === null) return;

      const resolvedMatch = resolvedTarget.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\[(.*)\])?$/,
      );
      if (!resolvedMatch) {
        throw new Error(`${requestedTarget}: not a valid identifier`);
      }
      const targetName = resolvedMatch[1];
      const targetSubscript = resolvedMatch[2] ?? subscript;
      if (isReadonly(ctx, name) || isReadonly(ctx, targetName)) {
        throw new Error(`${targetName}: readonly variable`);
      }
      if (targetSubscript === undefined) {
        ctx.state.env.set(targetName, value);
      } else {
        const kind = ctx.state.associativeArrays?.has(targetName)
          ? "associative"
          : "indexed";
        if (kind === "associative") {
          setArrayElement(ctx, targetName, targetSubscript, value, kind);
          return;
        }
        const computed = await computeIndexedArrayIndex(
          ctx,
          targetName,
          targetSubscript,
        );
        if (computed.error) {
          throw new ExitError(
            computed.error.exitCode,
            computed.error.stdout,
            computed.error.stderr,
          );
        }
        setArrayElement(ctx, targetName, computed.index, value, kind);
      }
    },
    exportedEnv,
    stdin: effectiveStdin,
    limits: ctx.limits,
    executionScope: cmd.internalIsExtension
      ? createCommandExecutionBudget(ctx.executionScope)
      : ctx.executionScope,
    exec: (script, options) => ctx.execFn(script, options, false),
    execWithInheritedStdin: (script, options) =>
      ctx.execFn(
        script,
        {
          ...options,
          stdin: latin1FromBytes(effectiveStdin),
          stdinKind: "bytes",
        },
        true,
      ),
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
    invokeTool: ctx.invokeTool,
  };
  const revocable = createRevocableCommandContext(cmdCtx, commandName);
  const guardedCmdCtx = createDefenseAwareCommandContext(
    revocable.context,
    commandName,
  );

  try {
    const runCommand = (): Promise<ExecResult> =>
      awaitWithDefenseContext(
        ctx.requireDefenseContext,
        "command",
        `${commandName} execution`,
        () => cmd.execute(args, guardedCmdCtx),
      );

    const runBoundedCommand = () =>
      runWithExecutionDeadline(
        runCommand,
        guardedCmdCtx,
        revocable.revoke,
        commandName,
        ctx.executionScope,
        ctx.state.signal,
      );

    if (cmd.trusted) {
      // Trusted host-extension commands may opt in to unrestricted globals.
      return await DefenseInDepthBox.runTrustedAsync(runBoundedCommand);
    }
    return await runBoundedCommand();
  } catch (error) {
    // ExecutionLimitError must propagate - these are safety limits
    if (error instanceof ExecutionLimitError) {
      throw error;
    }
    if (error instanceof ExecutionAbortedError) {
      throw error;
    }
    // Security violations must propagate to top-level error handling
    if (error instanceof SecurityViolationError) {
      throw error;
    }
    return failure(
      `${commandName}: ${sanitizeErrorMessage(getErrorMessage(error))}\n`,
    );
  }
}
