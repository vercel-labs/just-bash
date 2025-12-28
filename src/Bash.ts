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
import { type IFileSystem, VirtualFs } from "./fs.js";
import type { InitialFiles } from "./fs-interface.js";
import {
  ArithmeticError,
  ExecutionLimitError,
  ExitError,
} from "./interpreter/errors.js";
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
import { type ParseException, parse } from "./parser/parser.js";
import type { BashExecResult, Command, CommandRegistry } from "./types.js";

export type { ExecutionLimits } from "./limits.js";

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

  // Interpreter state (shared with interpreter instances)
  private state: InterpreterState;

  constructor(options: BashOptions = {}) {
    const fs = options.fs ?? new VirtualFs(options.files);
    this.fs = fs;

    this.useDefaultLayout = !options.cwd && !options.files;
    const cwd = options.cwd || (this.useDefaultLayout ? "/home/user" : "/");
    const env: Record<string, string> = {
      HOME: this.useDefaultLayout ? "/home/user" : "/",
      PATH: "/bin:/usr/bin",
      IFS: " \t\n",
      OSTYPE: "linux-gnu",
      MACHTYPE: "x86_64-pc-linux-gnu",
      HOSTTYPE: "x86_64",
      PWD: cwd,
      OLDPWD: cwd,
      ...options.env,
    };

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
      options: {
        errexit: false,
        pipefail: false,
        nounset: false,
        xtrace: false,
        verbose: false,
      },
      inCondition: false,
      loopDepth: 0,
    };

    // Create essential directories for VirtualFs
    if (fs instanceof VirtualFs) {
      try {
        // Always create /bin for PATH-based command resolution
        fs.mkdirSync("/bin", { recursive: true });
        fs.mkdirSync("/usr/bin", { recursive: true });
        // Create additional directories only for default layout
        if (this.useDefaultLayout) {
          fs.mkdirSync("/home/user", { recursive: true });
          fs.mkdirSync("/tmp", { recursive: true });
        }
      } catch {
        // Ignore errors - directories may already exist
      }
    }

    if (cwd !== "/" && fs instanceof VirtualFs) {
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
    // Always create command stubs in /bin for PATH-based resolution
    if (this.fs instanceof VirtualFs) {
      try {
        this.fs.writeFileSync(
          `/bin/${command.name}`,
          `#!/bin/bash\n# Built-in command: ${command.name}\n`,
        );
      } catch {
        // Ignore errors
      }
    }
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
        env: { ...this.state.env, ...options?.env },
      };
    }

    if (!commandLine.trim()) {
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        env: { ...this.state.env, ...options?.env },
      };
    }

    // Each exec call gets an isolated state copy - like starting a new shell
    // This ensures exec calls never interfere with each other
    const effectiveCwd = options?.cwd ?? this.state.cwd;
    const execState: InterpreterState = {
      ...this.state,
      env: {
        ...this.state.env,
        ...options?.env,
        // Update PWD when cwd option is provided
        ...(options?.cwd ? { PWD: options.cwd } : {}),
      },
      cwd: effectiveCwd,
      // Deep copy mutable objects to prevent interference
      functions: new Map(this.state.functions),
      localScopes: [...this.state.localScopes],
      options: { ...this.state.options },
    };

    // Normalize indented multi-line scripts (unless rawScript is true)
    let normalized = commandLine;
    if (!options?.rawScript) {
      const normalizedLines = commandLine
        .split("\n")
        .map((line) => line.trimStart());
      normalized = normalizedLines.join("\n");
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
      };

      const interpreter = new Interpreter(interpreterOptions, execState);
      const result = await interpreter.executeScript(ast);
      // Interpreter always sets env, assert it for type safety
      return result as BashExecResult;
    } catch (error) {
      // ExitError propagates from 'exit' builtin (including via eval/source)
      if (error instanceof ExitError) {
        return {
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: error.exitCode,
          env: { ...this.state.env, ...options?.env },
        };
      }
      if (error instanceof ArithmeticError) {
        return {
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: 1,
          env: { ...this.state.env, ...options?.env },
        };
      }
      // ExecutionLimitError is thrown when our conservative limits are exceeded
      // (command count, recursion depth, loop iterations)
      if (error instanceof ExecutionLimitError) {
        return {
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: ExecutionLimitError.EXIT_CODE,
          env: { ...this.state.env, ...options?.env },
        };
      }
      if ((error as ParseException).name === "ParseException") {
        return {
          stdout: "",
          stderr: `bash: syntax error: ${(error as Error).message}\n`,
          exitCode: 2,
          env: { ...this.state.env, ...options?.env },
        };
      }
      // RangeError occurs when JavaScript call stack is exceeded (deep recursion)
      if (error instanceof RangeError) {
        return {
          stdout: "",
          stderr: `bash: ${error.message}\n`,
          exitCode: 1,
          env: { ...this.state.env, ...options?.env },
        };
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
    return { ...this.state.env };
  }
}
