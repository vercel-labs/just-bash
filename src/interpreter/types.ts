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
import type { CommandRegistry, ExecResult } from "../types.js";

export interface InterpreterState {
  env: Record<string, string>;
  cwd: string;
  previousDir: string;
  functions: Map<string, FunctionDefNode>;
  localScopes: Map<string, string | undefined>[];
  callDepth: number;
  commandCount: number;
  lastExitCode: number;
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
}
