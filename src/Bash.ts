/**
 * Bash - Bash Shell Environment
 *
 * A complete bash-like shell environment using a proper AST-based architecture:
 *   Input → Parser → AST → Interpreter → Output
 *
 * This class provides the shell environment (filesystem, commands, variables)
 * and delegates execution to the Interpreter.
 */

import type { FunctionDefNode } from "./ast/types.js";
import {
  type CommandName,
  createLazyCommands,
  createNetworkCommands,
} from "./commands/registry.js";
import {
  type CustomCommand,
  createLazyCustomCommand,
  isLazyCommand,
} from "./custom-commands.js";
import { InMemoryFs } from "./fs/in-memory-fs/in-memory-fs.js";
import { initFilesystem } from "./fs/init.js";
import type { IFileSystem, InitialFiles } from "./fs/interface.js";
import { mapToRecord, mapToRecordWithExtras } from "./helpers/env.js";
import {
  ArithmeticError,
  ExecutionLimitError,
  ExitError,
  PosixFatalError,
} from "./interpreter/errors.js";
import {
  buildBashopts,
  buildShellopts,
} from "./interpreter/helpers/shellopts.js";
import {
  Interpreter,
  type InterpreterOptions,
  type InterpreterState,
} from "./interpreter/index.js";
import { type ExecutionLimits, resolveLimits } from "./limits.js";
import {
  createSecureFetch,
  type NetworkConfig,
  type SecureFetch,
} from "./network/index.js";
import { LexerError } from "./parser/lexer.js";
import { type ParseException, parse } from "./parser/parser.js";
import type {
  BashExecResult,
  Command,
  CommandRegistry,
  TraceCallback,
} from "./types.js";

export type { ExecutionLimits } from "./limits.js";

/**
 * Logger interface for Bash execution logging.
 * Implement this interface to receive execution logs.
 */
export interface BashLogger {
  /** Log informational messages (exec commands, stderr, exit codes) */
  info(message: string, data?: Record<string, unknown>): void;
  /** Log debug messages (stdout output) */
  debug(message: string, data?: Record<string, unknown>): void;
}

export interface BashOptions {
  files?: InitialFiles;
  env?: Record<string, string>;
  cwd?: string;
  fs?: IFileSystem;
  /**
   * Execution limits to prevent runaway compute.
   * See ExecutionLimits interface for available options.
   */
  executionLimits?: ExecutionLimits;
  /**
   * @deprecated Use executionLimits.maxCallDepth instead
   */
  maxCallDepth?: number;
  /**
   * @deprecated Use executionLimits.maxCommandCount instead
   */
  maxCommandCount?: number;
  /**
   * @deprecated Use executionLimits.maxLoopIterations instead
   */
  maxLoopIterations?: number;
  /**
   * Network configuration for commands like curl.
   * Network access is disabled by default - you must explicitly configure allowed URLs.
   */
  network?: NetworkConfig;
  /**
   * Optional list of command names to register.
   * If not provided, all built-in commands are available.
   * Use this to restrict which commands can be executed.
   */
  commands?: CommandName[];
  /**
   * Optional sleep function for the sleep command.
   * If provided, used instead of real setTimeout.
   * Useful for testing with mock clocks.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Custom commands to register alongside built-in commands.
   * These take precedence over built-ins with the same name.
   *
   * @example
   * ```ts
   * import { defineCommand } from "just-bash";
   *
   * const hello = defineCommand("hello", async (args) => ({
   *   stdout: `Hello, ${args[0] || "world"}!\n`,
   *   stderr: "",
   *   exitCode: 0,
   * }));
   *
   * const bash = new Bash({ customCommands: [hello] });
   * ```
   */
  customCommands?: CustomCommand[];
  /**
   * Optional logger for execution tracing.
   * When provided, logs exec commands (info), stdout (debug), stderr (info), and exit codes (info).
   * Disabled by default.
   */
  logger?: BashLogger;
  /**
   * Optional trace callback for performance profiling.
   * When provided, commands emit timing events for analysis.
   * Useful for identifying performance bottlenecks.
   */
  trace?: TraceCallback;
}

export interface ExecOptions {
  /**
   * Environment variables to set for this execution only.
   * These are merged with the current environment and restored after execution.
   */
  env?: Record<string, string>;
  /**
   * Working directory for this execution only.
   * Restored to original after execution.
   */
  cwd?: string;
  /**
   * If true, skip normalizing the script (trimming leading whitespace from lines).
   * Useful when running scripts where leading whitespace is significant (e.g., here-docs).
   * Default: false
   */
  rawScript?: boolean;
}

export class Bash {
  readonly fs: IFileSystem;
  private commands: CommandRegistry = new Map();
  private useDefaultLayout: boolean = false;
  private limits: Required<ExecutionLimits>;
  private secureFetch?: SecureFetch;
  private sleepFn?: (ms: number) => Promise<void>;
  private traceFn?: TraceCallback;
  private logger?: BashLogger;

  // Interpreter state (shared with interpreter instances)
  private state: InterpreterState;

  constructor(options: BashOptions = {}) {
    const fs = options.fs ?? new InMemoryFs(options.files);
    this.fs = fs;

    this.useDefaultLayout = !options.cwd && !options.files;
    const cwd = options.cwd || (this.useDefaultLayout ? "/home/user" : "/");
    // Use Map for env to prevent prototype pollution attacks
    const env = new Map<string, string>([
      ["HOME", this.useDefaultLayout ? "/home/user" : "/"],
      ["PATH", "/usr/bin:/bin"],
      ["IFS", " \t\n"],
      ["OSTYPE", "linux-gnu"],
      ["MACHTYPE", "x86_64-pc-linux-gnu"],
      ["HOSTTYPE", "x86_64"],
      ["HOSTNAME", "localhost"], // Match hostname command in sandboxed environment
      ["PWD", cwd],
      ["OLDPWD", cwd],
      ["OPTIND", "1"], // getopts option index
      // Add user-provided env vars
      ...Object.entries(options.env ?? {}),
    ]);

    // Resolve limits: new executionLimits takes precedence, then deprecated individual options
    this.limits = resolveLimits({
      ...options.executionLimits,
      // Support deprecated individual options (they override executionLimits if set)
      ...(options.maxCallDepth !== undefined && {
        maxCallDepth: options.maxCallDepth,
      }),
      ...(options.maxCommandCount !== undefined && {
        maxCommandCount: options.maxCommandCount,
      }),
      ...(options.maxLoopIterations !== undefined && {
        maxLoopIterations: options.maxLoopIterations,
      }),
    });

    // Create secure fetch if network is configured
    if (options.network) {
      this.secureFetch = createSecureFetch(options.network);
    }

    // Store sleep function if provided (for mock clocks in testing)
    this.sleepFn = options.sleep;

    // Store trace callback if provided (for performance profiling)
    this.traceFn = options.trace;

    // Store logger if provided
    this.logger = options.logger;

    // Initialize interpreter state
    this.state = {
      env,
      cwd,
      previousDir: "/home/user",
      functions: new Map<string, FunctionDefNode>(),
      localScopes: [],
      callDepth: 0,
      sourceDepth: 0,
      commandCount: 0,
      lastExitCode: 0,
      lastArg: "", // $_ is initially empty (or could be shell name)
      startTime: Date.now(),
      lastBackgroundPid: 0,
      bashPid: process.pid, // BASHPID starts as the main process PID
      nextVirtualPid: process.pid + 1, // Counter for unique subshell PIDs
      currentLine: 1, // $LINENO starts at 1
      options: {
        errexit: false,
        pipefail: false,
        nounset: false,
        xtrace: false,
        verbose: false,
        posix: false,
        allexport: false,
        noclobber: false,
        noglob: false,
        noexec: false,
        vi: false,
        emacs: false,
      },
      shoptOptions: {
        extglob: false,
        dotglob: false,
        nullglob: false,
        failglob: false,
        globstar: false,
        globskipdots: true, // Default to true in bash >=5.2
        nocaseglob: false,
        nocasematch: false,
        expand_aliases: false,
        lastpipe: false,
        xpg_echo: false,
      },
      inCondition: false,
      loopDepth: 0,
      // Export standard shell variables by default (matches bash behavior)
      // These variables are typically inherited from the parent shell environment
      exportedVars: new Set([
        "HOME",
        "PATH",
        "PWD",
        "OLDPWD",
        // Also export any user-provided environment variables
        ...Object.keys(options.env || {}),
      ]),
      // SHELLOPTS and BASHOPTS are readonly
      readonlyVars: new Set(["SHELLOPTS", "BASHOPTS"]),
      // Hash table for PATH command lookup caching
      hashTable: new Map(),
    };

    // Initialize SHELLOPTS to reflect current shell options (initially empty string since all are false)
    this.state.env.set("SHELLOPTS", buildShellopts(this.state.options));
    // Initialize BASHOPTS to reflect current shopt options
    this.state.env.set("BASHOPTS", buildBashopts(this.state.shoptOptions));

    // Initialize filesystem with standard directories and device files
    // Only applies to InMemoryFs - other filesystems use real directories
    initFilesystem(fs, this.useDefaultLayout);

    if (cwd !== "/" && fs instanceof InMemoryFs) {
      try {
        fs.mkdirSync(cwd, { recursive: true });
      } catch {
        // Ignore errors
      }
    }

    for (const cmd of createLazyCommands(options.commands)) {
      this.registerCommand(cmd);
    }

    // Register network commands only when network is configured
    if (options.network) {
      for (const cmd of createNetworkCommands()) {
        this.registerCommand(cmd);
      }
    }

    // Register custom commands (after built-ins so they can override)
    if (options.customCommands) {
      for (const cmd of options.customCommands) {
        if (isLazyCommand(cmd)) {
          this.registerCommand(createLazyCustomCommand(cmd));
        } else {
          this.registerCommand(cmd);
        }
      }
    }
  }

  registerCommand(command: Command): void {
    this.commands.set(command.name, command);
    // Create command stubs in /bin and /usr/bin for PATH-based resolution
    // Works for both InMemoryFs and OverlayFs (both have writeFileSync)
    // Commands are registered to both locations like real Linux systems
    // (where /bin is often a symlink to /usr/bin on modern systems)
    const fs = this.fs as {
      writeFileSync?: (path: string, content: string) => void;
    };
    if (typeof fs.writeFileSync === "function") {
      const stub = `#!/bin/bash\n# Built-in command: ${command.name}\n`;
      try {
        fs.writeFileSync(`/bin/${command.name}`, stub);
      } catch {
        // Ignore errors
      }
      try {
        fs.writeFileSync(`/usr/bin/${command.name}`, stub);
      } catch {
        // Ignore errors
      }
    }
  }

  private logResult(result: BashExecResult): BashExecResult {
    if (this.logger) {
      if (result.stdout) {
        this.logger.debug("stdout", { output: result.stdout });
      }
      if (result.stderr) {
        this.logger.info("stderr", { output: result.stderr });
      }
      this.logger.info("exit", { exitCode: result.exitCode });
    }
    return result;
  }

  async exec(
    commandLine: string,
    options?: ExecOptions,
  ): Promise<BashExecResult> {
    if (this.state.callDepth === 0) {
      this.state.commandCount = 0;
    }

    this.state.commandCount++;
    if (this.state.commandCount > this.limits.maxCommandCount) {
      return {
        stdout: "",
        stderr: `bash: maximum command count (${this.limits.maxCommandCount}) exceeded (possible infinite loop). Increase with executionLimits.maxCommandCount option.\n`,
        exitCode: 1,
        env: mapToRecordWithExtras(this.state.env, options?.env),
      };
    }

    if (!commandLine.trim()) {
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        env: mapToRecordWithExtras(this.state.env, options?.env),
      };
    }

    // Log command execution
    this.logger?.info("exec", { command: commandLine });

    // Each exec call gets an isolated state copy - like starting a new shell
    // This ensures exec calls never interfere with each other
    const effectiveCwd = options?.cwd ?? this.state.cwd;

    // Determine PWD and cwd for the new shell context
    // If PWD is in the provided env, use it (inherited from parent)
    // If PWD is NOT in the provided env (was unset), use realpath to get physical path
    // This matches bash behavior: when PWD is unset and a new shell starts,
    // it initializes PWD (and cwd) using realpath (resolving symlinks)
    let newPwd: string | undefined;
    let newCwd = effectiveCwd;
    if (options?.cwd) {
      if (options.env && "PWD" in options.env) {
        // PWD explicitly provided - use it
        newPwd = options.env.PWD;
      } else if (options?.env && !("PWD" in options.env)) {
        // PWD not in provided env - use realpath to resolve symlinks
        // This also updates cwd since the shell determines its position from scratch
        try {
          newPwd = await this.fs.realpath(effectiveCwd);
          newCwd = newPwd; // Both PWD and cwd should be the physical path
        } catch {
          // Fallback to logical path if realpath fails
          newPwd = effectiveCwd;
        }
      } else {
        // No env provided - use logical cwd
        newPwd = effectiveCwd;
      }
    }

    // Create a copy of env Map for this execution
    const execEnv = new Map(this.state.env);
    // Merge in options.env
    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        execEnv.set(key, value);
      }
    }
    // Update PWD when cwd option is provided
    if (newPwd !== undefined) {
      execEnv.set("PWD", newPwd);
    }

    const execState: InterpreterState = {
      ...this.state,
      env: execEnv,
      cwd: newCwd,
      // Deep copy mutable objects to prevent interference
      functions: new Map(this.state.functions),
      localScopes: [...this.state.localScopes],
      options: { ...this.state.options },
      // Share hashTable reference - it should persist across exec calls
      hashTable: this.state.hashTable,
    };

    // Normalize indented multi-line scripts (unless rawScript is true)
    // This allows writing indented bash scripts in template literals
    // BUT we must preserve whitespace inside heredoc content
    let normalized = commandLine;
    if (!options?.rawScript) {
      normalized = normalizeScript(commandLine);
    }

    try {
      const ast = parse(normalized);

      // Create interpreter with appropriate state
      const interpreterOptions: InterpreterOptions = {
        fs: this.fs,
        commands: this.commands,
        limits: this.limits,
        exec: this.exec.bind(this),
        fetch: this.secureFetch,
        sleep: this.sleepFn,
        trace: this.traceFn,
      };

      const interpreter = new Interpreter(interpreterOptions, execState);
      const result = await interpreter.executeScript(ast);
      // Interpreter always sets env, assert it for type safety
      return this.logResult(result as BashExecResult);
    } catch (error) {
      // ExitError propagates from 'exit' builtin (including via eval/source)
      if (error instanceof ExitError) {
        return this.logResult({
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: error.exitCode,
          env: mapToRecordWithExtras(this.state.env, options?.env),
        });
      }
      // PosixFatalError propagates from special builtins in POSIX mode
      if (error instanceof PosixFatalError) {
        return this.logResult({
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: error.exitCode,
          env: mapToRecordWithExtras(this.state.env, options?.env),
        });
      }
      if (error instanceof ArithmeticError) {
        return this.logResult({
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: 1,
          env: mapToRecordWithExtras(this.state.env, options?.env),
        });
      }
      // ExecutionLimitError is thrown when our conservative limits are exceeded
      // (command count, recursion depth, loop iterations)
      if (error instanceof ExecutionLimitError) {
        return this.logResult({
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: ExecutionLimitError.EXIT_CODE,
          env: mapToRecordWithExtras(this.state.env, options?.env),
        });
      }
      if ((error as ParseException).name === "ParseException") {
        return this.logResult({
          stdout: "",
          stderr: `bash: syntax error: ${(error as Error).message}\n`,
          exitCode: 2,
          env: mapToRecordWithExtras(this.state.env, options?.env),
        });
      }
      // LexerError is thrown for lexer-level issues like unterminated quotes
      if (error instanceof LexerError) {
        return this.logResult({
          stdout: "",
          stderr: `bash: ${error.message}\n`,
          exitCode: 2,
          env: mapToRecordWithExtras(this.state.env, options?.env),
        });
      }
      // RangeError occurs when JavaScript call stack is exceeded (deep recursion)
      if (error instanceof RangeError) {
        return this.logResult({
          stdout: "",
          stderr: `bash: ${error.message}\n`,
          exitCode: 1,
          env: mapToRecordWithExtras(this.state.env, options?.env),
        });
      }
      throw error;
    }
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  async readFile(path: string): Promise<string> {
    return this.fs.readFile(this.fs.resolvePath(this.state.cwd, path));
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.fs.writeFile(
      this.fs.resolvePath(this.state.cwd, path),
      content,
    );
  }

  getCwd(): string {
    return this.state.cwd;
  }

  getEnv(): Record<string, string> {
    return mapToRecord(this.state.env);
  }
}

/**
 * Normalize a script by stripping leading whitespace from lines,
 * while preserving whitespace inside heredoc content.
 *
 * This allows writing indented bash scripts in template literals:
 * ```
 * await bash.exec(`
 *   if [ -f foo ]; then
 *     echo "yes"
 *   fi
 * `);
 * ```
 *
 * Heredocs are detected by looking for << or <<- operators and their delimiters.
 */
function normalizeScript(script: string): string {
  const lines = script.split("\n");
  const result: string[] = [];

  // Stack of pending heredoc delimiters (for nested heredocs)
  const pendingDelimiters: { delimiter: string; stripTabs: boolean }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // If we're inside a heredoc, check if this line ends it
    if (pendingDelimiters.length > 0) {
      const current = pendingDelimiters[pendingDelimiters.length - 1];
      // For <<-, strip leading tabs when checking delimiter
      // For <<, require exact match (no leading whitespace allowed)
      const lineToCheck = current.stripTabs ? line.replace(/^\t+/, "") : line;
      if (lineToCheck === current.delimiter) {
        // End of heredoc - this line can be normalized
        result.push(line.trimStart());
        pendingDelimiters.pop();
        continue;
      }
      // Inside heredoc - preserve the line exactly as-is
      result.push(line);
      continue;
    }

    // Not inside a heredoc - normalize the line and check for heredoc starts
    const normalizedLine = line.trimStart();
    result.push(normalizedLine);

    // Check for heredoc operators in this line
    // Match: <<DELIM, <<-DELIM, << 'DELIM', <<- "DELIM", etc.
    // Multiple heredocs on one line are possible: cmd <<EOF1 <<EOF2
    const heredocPattern = /<<(-?)\s*(['"]?)([\w-]+)\2/g;
    for (const match of normalizedLine.matchAll(heredocPattern)) {
      const stripTabs = match[1] === "-";
      const delimiter = match[3];
      pendingDelimiters.push({ delimiter, stripTabs });
    }
  }

  return result.join("\n");
}
