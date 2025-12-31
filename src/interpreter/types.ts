/**
 * Interpreter Types
 */

import type {
  CommandNode,
  FunctionDefNode,
  ScriptNode,
  StatementNode,
} from "../ast/types.js";
import type { IFileSystem } from "../fs/interface.js";
import type { ExecutionLimits } from "../limits.js";
import type { SecureFetch } from "../network/index.js";
import type { CommandRegistry, ExecResult } from "../types.js";

export interface ShellOptions {
  /** set -e: Exit immediately if a command exits with non-zero status */
  errexit: boolean;
  /** set -o pipefail: Return the exit status of the last (rightmost) command in a pipeline that fails */
  pipefail: boolean;
  /** set -u: Treat unset variables as an error when substituting */
  nounset: boolean;
  /** set -x: Print commands and their arguments as they are executed */
  xtrace: boolean;
  /** set -v: Print shell input lines as they are read (verbose) */
  verbose: boolean;
}

export interface InterpreterState {
  env: Record<string, string>;
  cwd: string;
  previousDir: string;
  functions: Map<string, FunctionDefNode>;
  localScopes: Map<string, string | undefined>[];
  callDepth: number;
  /** Current source script nesting depth (for return in sourced scripts) */
  sourceDepth: number;
  commandCount: number;
  lastExitCode: number;
  /** Last argument of previous command, for $_ expansion */
  lastArg: string;
  /** Time when shell started (for $SECONDS) */
  startTime: number;
  /** PID of last background job (for $!) */
  lastBackgroundPid: number;
  /** Current line number being executed (for $LINENO) */
  currentLine: number;
  /** Shell options (set -e, etc.) */
  options: ShellOptions;
  /** True when executing condition for if/while/until (errexit doesn't apply) */
  inCondition: boolean;
  /** Current loop nesting depth (for break/continue) */
  loopDepth: number;
  /** True if this subshell was spawned from within a loop context (for break/continue to exit subshell) */
  parentHasLoopContext?: boolean;
  /** Stdin available for commands in compound commands (groups, subshells, while loops with piped input) */
  groupStdin?: string;
  /** Set of variable names that are readonly */
  readonlyVars?: Set<string>;
  /** Exit code from expansion errors (arithmetic, etc.) - overrides command exit code */
  expansionExitCode?: number;
  /** Stderr from expansion errors */
  expansionStderr?: string;
  /** Set of variable names that are associative arrays */
  associativeArrays?: Set<string>;
}

export interface InterpreterContext {
  state: InterpreterState;
  fs: IFileSystem;
  commands: CommandRegistry;
  /** Execution limits configuration */
  limits: Required<ExecutionLimits>;
  execFn: (
    script: string,
    options?: { env?: Record<string, string>; cwd?: string },
  ) => Promise<ExecResult>;
  executeScript: (node: ScriptNode) => Promise<ExecResult>;
  executeStatement: (node: StatementNode) => Promise<ExecResult>;
  executeCommand: (node: CommandNode, stdin: string) => Promise<ExecResult>;
  /** Optional secure fetch function for network-enabled commands */
  fetch?: SecureFetch;
  /** Optional sleep function for testing with mock clocks */
  sleep?: (ms: number) => Promise<void>;
}
