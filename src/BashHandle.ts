/**
 * BashHandle - Opaque handle for Bash class in workflow environments.
 *
 * This class mirrors the Bash class's instance properties but provides
 * stub/empty method implementations. It is designed for use in workflow
 * environments where the actual execution is not needed, but the type
 * structure must match for serialization/deserialization.
 *
 * IMPORTANT: This file must be completely self-contained with NO imports
 * from other internal modules (except @workflow/serde) to avoid pulling
 * in transitive dependencies during workflow discovery.
 */

import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";

// =============================================================================
// Inline Type Definitions
// =============================================================================
// These types are defined inline to avoid importing from other modules,
// which could pull in transitive dependencies during workflow discovery.

/**
 * Minimal filesystem interface for the opaque handle.
 */
interface IFileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  resolvePath(base: string, path: string): string;
  // Other methods exist but aren't needed for the handle
  [key: string]: unknown;
}

/**
 * Execution limits configuration.
 */
interface ExecutionLimits {
  maxCallDepth?: number;
  maxCommandCount?: number;
  maxLoopIterations?: number;
  maxAwkIterations?: number;
  maxSedIterations?: number;
  maxJqIterations?: number;
  maxSqliteTimeoutMs?: number;
  maxPythonTimeoutMs?: number;
}

/**
 * Network configuration for commands like curl.
 */
interface NetworkConfig {
  allowedUrlPrefixes?: string[];
  allowedMethods?: string[];
  dangerouslyAllowFullInternetAccess?: boolean;
  maxRedirects?: number;
  timeoutMs?: number;
}

/**
 * Secure fetch function type.
 */
type SecureFetch = (
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  url: string;
}>;

/**
 * Shell options (set -e, etc.)
 */
interface ShellOptions {
  errexit: boolean;
  pipefail: boolean;
  nounset: boolean;
  xtrace: boolean;
  verbose: boolean;
  posix: boolean;
  allexport: boolean;
  noclobber: boolean;
  noglob: boolean;
  noexec: boolean;
  vi: boolean;
  emacs: boolean;
}

/**
 * Shopt options (shopt -s, etc.)
 */
interface ShoptOptions {
  extglob: boolean;
  dotglob: boolean;
  nullglob: boolean;
  failglob: boolean;
  globstar: boolean;
  globskipdots: boolean;
  nocaseglob: boolean;
  nocasematch: boolean;
  expand_aliases: boolean;
  lastpipe: boolean;
  xpg_echo: boolean;
}

/**
 * Function definition AST node (minimal for handle).
 */
interface FunctionDefNode {
  type: "FunctionDef";
  name: string;
  body: unknown;
  [key: string]: unknown;
}

/**
 * Interpreter state - the core serializable state of a Bash instance.
 */
interface InterpreterState {
  env: Record<string, string>;
  cwd: string;
  previousDir: string;
  functions: Map<string, FunctionDefNode>;
  localScopes: Map<string, string | undefined>[];
  callDepth: number;
  sourceDepth: number;
  commandCount: number;
  lastExitCode: number;
  lastArg: string;
  startTime: number;
  lastBackgroundPid: number;
  bashPid: number;
  nextVirtualPid: number;
  currentLine: number;
  options: ShellOptions;
  shoptOptions: ShoptOptions;
  inCondition: boolean;
  loopDepth: number;
  exportedVars?: Set<string>;
  readonlyVars?: Set<string>;
  hashTable?: Map<string, string>;
  [key: string]: unknown;
}

/**
 * Command interface.
 */
interface Command {
  name: string;
  execute(
    args: string[],
    ctx: unknown,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/**
 * Command registry type.
 */
type CommandRegistry = Map<string, Command>;

/**
 * Trace event for performance profiling.
 */
interface TraceEvent {
  category: string;
  name: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

/**
 * Trace callback function.
 */
type TraceCallback = (event: TraceEvent) => void;

/**
 * Result from exec calls.
 */
interface BashExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  env: Record<string, string>;
}

// =============================================================================
// Exported Types
// =============================================================================

/**
 * Logger interface for Bash execution logging.
 */
export interface BashLogger {
  info(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * Options for creating a Bash instance.
 */
export interface BashOptions {
  fs?: IFileSystem;
  env?: Record<string, string>;
  cwd?: string;
  executionLimits?: ExecutionLimits;
  network?: NetworkConfig;
  sleep?: (ms: number) => Promise<void>;
  trace?: TraceCallback;
  logger?: BashLogger;
}

/**
 * Options for exec calls.
 */
export interface ExecOptions {
  env?: Record<string, string>;
  cwd?: string;
  rawScript?: boolean;
}

// =============================================================================
// Bash Opaque Handle Class
// =============================================================================

/**
 * Bash - Opaque handle class for workflow environments.
 *
 * This class has the same instance properties as the real Bash class,
 * but all methods are stubs that throw errors or return empty results.
 * Use this in workflow code where you need type compatibility without
 * Node.js dependencies.
 */
export class Bash {
  readonly fs!: IFileSystem;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used via Object.create() pattern in from()
  private commands!: CommandRegistry;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used via Object.create() pattern in from()
  private useDefaultLayout!: boolean;
  private limits!: Required<ExecutionLimits>;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Required for type compatibility with real Bash class
  private secureFetch?: SecureFetch;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Required for type compatibility with real Bash class
  private sleepFn?: (ms: number) => Promise<void>;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Required for type compatibility with real Bash class
  private traceFn?: TraceCallback;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Required for type compatibility with real Bash class
  private logger?: BashLogger;
  private state!: InterpreterState;

  /**
   * Constructor is a stub - throws an error if called directly.
   * Use Bash.from() to create instances from serialized state.
   */
  constructor(_options?: BashOptions) {
    throw new Error(
      "Bash constructor cannot be used in workflow environments. Use Bash.from() to rehydrate from serialized state.",
    );
  }

  /**
   * Serialize Bash instance for Workflow DevKit.
   */
  static [WORKFLOW_SERIALIZE](instance: Bash) {
    return {
      fs: instance.fs,
      state: instance.state,
      limits: instance.limits,
    };
  }

  /**
   * Rehydrate a Bash instance from serialized state.
   * Creates an opaque handle that can be passed back to the real Bash class.
   */
  static from(
    serialized: {
      fs: IFileSystem;
      state: InterpreterState;
      limits: Required<ExecutionLimits>;
    },
    _options?: {
      network?: NetworkConfig;
      sleep?: (ms: number) => Promise<void>;
      trace?: TraceCallback;
      logger?: BashLogger;
    },
  ): Bash {
    // Create instance without calling constructor
    const bash = Object.create(Bash.prototype) as Bash;

    // Restore serialized state
    (bash as { fs: IFileSystem }).fs = serialized.fs;
    bash.state = serialized.state;
    bash.limits = serialized.limits;

    // Initialize non-serialized properties with defaults
    bash.commands = new Map();
    bash.useDefaultLayout = false;

    return bash;
  }

  /**
   * Deserialize Bash instance for Workflow DevKit.
   */
  static [WORKFLOW_DESERIALIZE](serialized: {
    fs: IFileSystem;
    state: InterpreterState;
    limits: Required<ExecutionLimits>;
  }) {
    return Bash.from(serialized);
  }

  /**
   * Stub - Register a command. Does nothing in workflow handle.
   */
  registerCommand(_command: Command): void {
    // Stub - no-op
  }

  /**
   * Stub - Execute a command. Throws error in workflow handle.
   */
  async exec(
    _commandLine: string,
    _options?: ExecOptions,
  ): Promise<BashExecResult> {
    throw new Error(
      "exec() cannot be called on workflow Bash handle. The handle is for serialization only.",
    );
  }

  /**
   * Stub - Read a file. Throws error in workflow handle.
   */
  async readFile(_path: string): Promise<string> {
    throw new Error(
      "readFile() cannot be called on workflow Bash handle. The handle is for serialization only.",
    );
  }

  /**
   * Stub - Write a file. Throws error in workflow handle.
   */
  async writeFile(_path: string, _content: string): Promise<void> {
    throw new Error(
      "writeFile() cannot be called on workflow Bash handle. The handle is for serialization only.",
    );
  }

  /**
   * Get the current working directory.
   */
  getCwd(): string {
    return this.state?.cwd ?? "/";
  }

  /**
   * Get a copy of the environment variables.
   */
  getEnv(): Record<string, string> {
    return { ...(this.state?.env ?? {}) };
  }
}

/**
 * Helper to create initial InterpreterState for use with Bash.from().
 * This is useful when you need to create a Bash handle from scratch
 * in a workflow environment without Node.js APIs.
 */
export function createInitialState(options?: {
  env?: Record<string, string>;
  cwd?: string;
}): InterpreterState {
  const cwd = options?.cwd ?? "/";
  const env: Record<string, string> = {
    HOME: "/",
    PATH: "/usr/bin:/bin",
    IFS: " \t\n",
    OSTYPE: "linux-gnu",
    MACHTYPE: "x86_64-pc-linux-gnu",
    HOSTTYPE: "x86_64",
    HOSTNAME: "localhost",
    PWD: cwd,
    OLDPWD: cwd,
    OPTIND: "1",
    SHELLOPTS: "",
    BASHOPTS: "",
    ...options?.env,
  };

  return {
    env,
    cwd,
    previousDir: cwd,
    functions: new Map<string, FunctionDefNode>(),
    localScopes: [],
    callDepth: 0,
    sourceDepth: 0,
    commandCount: 0,
    lastExitCode: 0,
    lastArg: "",
    startTime: Date.now(),
    lastBackgroundPid: 0,
    bashPid: 1,
    nextVirtualPid: 2,
    currentLine: 1,
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
      globskipdots: true,
      nocaseglob: false,
      nocasematch: false,
      expand_aliases: false,
      lastpipe: false,
      xpg_echo: false,
    },
    inCondition: false,
    loopDepth: 0,
    exportedVars: new Set(["HOME", "PATH", "PWD", "OLDPWD"]),
    readonlyVars: new Set(["SHELLOPTS", "BASHOPTS"]),
    hashTable: new Map(),
  };
}
