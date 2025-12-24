/**
 * Interpreter Types
 */

import type {
  CommandNode,
  FunctionDefNode,
  ScriptNode,
  StatementNode,
} from "../ast/types.js";
import type { IFileSystem } from "../fs-interface.js";
import type { SecureFetch } from "../network/index.js";
import type { CommandRegistry, ExecResult } from "../types.js";

export interface ShellOptions {
  /** set -e: Exit immediately if a command exits with non-zero status */
  errexit: boolean;
  /** set -o pipefail: Return the exit status of the last (rightmost) command in a pipeline that fails */
  pipefail: boolean;
}

export interface InterpreterState {
  env: Record<string, string>;
  cwd: string;
  previousDir: string;
  functions: Map<string, FunctionDefNode>;
  localScopes: Map<string, string | undefined>[];
  callDepth: number;
  commandCount: number;
  lastExitCode: number;
  /** Shell options (set -e, etc.) */
  options: ShellOptions;
  /** True when executing condition for if/while/until (errexit doesn't apply) */
  inCondition: boolean;
  /** Current loop nesting depth (for break/continue) */
  loopDepth: number;
}

export interface InterpreterContext {
  state: InterpreterState;
  fs: IFileSystem;
  commands: CommandRegistry;
  maxCallDepth: number;
  maxCommandCount: number;
  maxLoopIterations: number;
  execFn: (script: string) => Promise<ExecResult>;
  executeScript: (node: ScriptNode) => Promise<ExecResult>;
  executeStatement: (node: StatementNode) => Promise<ExecResult>;
  executeCommand: (node: CommandNode, stdin: string) => Promise<ExecResult>;
  /** Optional secure fetch function for network-enabled commands */
  fetch?: SecureFetch;
}
