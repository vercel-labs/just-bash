/**
 * BashEnv - Bash Shell Environment
 *
 * A complete bash-like shell environment using a proper AST-based architecture:
 *   Input → Parser → AST → Interpreter → Output
 *
 * This class provides the shell environment (filesystem, commands, variables)
 * and delegates execution to the Interpreter.
 */

import type { FunctionDefNode } from "./ast/types.js";
import { createLazyCommands } from "./commands/registry.js";
import { type IFileSystem, VirtualFs } from "./fs.js";
import type { InitialFiles } from "./fs-interface.js";
import {
  Interpreter,
  type InterpreterOptions,
  type InterpreterState,
} from "./interpreter/index.js";
import { type ParseException, parse } from "./parser/parser.js";
import type { Command, CommandRegistry, ExecResult } from "./types.js";

// Default protection limits
const DEFAULT_MAX_CALL_DEPTH = 100;
const DEFAULT_MAX_COMMAND_COUNT = 100000;
const DEFAULT_MAX_LOOP_ITERATIONS = 10000;

export interface BashEnvOptions {
  files?: InitialFiles;
  env?: Record<string, string>;
  cwd?: string;
  fs?: IFileSystem;
  maxCallDepth?: number;
  maxCommandCount?: number;
  maxLoopIterations?: number;
}

export class BashEnv {
  readonly fs: IFileSystem;
  private commands: CommandRegistry = new Map();
  private useDefaultLayout: boolean = false;
  private maxCallDepth: number;
  private maxCommandCount: number;
  private maxLoopIterations: number;

  // Interpreter state (shared with interpreter instances)
  private state: InterpreterState;

  constructor(options: BashEnvOptions = {}) {
    const fs = options.fs ?? new VirtualFs(options.files);
    this.fs = fs;

    this.useDefaultLayout = !options.cwd && !options.files;
    const cwd = options.cwd || (this.useDefaultLayout ? "/home/user" : "/");
    const env: Record<string, string> = {
      HOME: this.useDefaultLayout ? "/home/user" : "/",
      PATH: "/bin:/usr/bin",
      IFS: " \t\n",
      ...options.env,
    };

    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
    this.maxCommandCount = options.maxCommandCount ?? DEFAULT_MAX_COMMAND_COUNT;
    this.maxLoopIterations =
      options.maxLoopIterations ?? DEFAULT_MAX_LOOP_ITERATIONS;

    // Initialize interpreter state
    this.state = {
      env,
      cwd,
      previousDir: "/home/user",
      functions: new Map<string, FunctionDefNode>(),
      localScopes: [],
      callDepth: 0,
      commandCount: 0,
      lastExitCode: 0,
    };

    // Create essential directories for VirtualFs (only for default layout)
    if (fs instanceof VirtualFs && this.useDefaultLayout) {
      try {
        fs.mkdirSync("/home/user", { recursive: true });
        fs.mkdirSync("/bin", { recursive: true });
        fs.mkdirSync("/usr/bin", { recursive: true });
        fs.mkdirSync("/tmp", { recursive: true });
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

    for (const cmd of createLazyCommands()) {
      this.registerCommand(cmd);
    }
  }

  registerCommand(command: Command): void {
    this.commands.set(command.name, command);
    if (this.fs instanceof VirtualFs && this.useDefaultLayout) {
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

  async exec(commandLine: string): Promise<ExecResult> {
    if (this.state.callDepth === 0) {
      this.state.commandCount = 0;
    }

    this.state.commandCount++;
    if (this.state.commandCount > this.maxCommandCount) {
      return {
        stdout: "",
        stderr: `bash: maximum command count (${this.maxCommandCount}) exceeded (possible infinite loop). Increase with maxCommandCount option.\n`,
        exitCode: 1,
      };
    }

    if (!commandLine.trim()) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // Normalize indented multi-line scripts
    const normalizedLines = commandLine
      .split("\n")
      .map((line) => line.trimStart());
    const normalized = normalizedLines.join("\n");

    try {
      const ast = parse(normalized);

      // Create interpreter with current state
      const interpreterOptions: InterpreterOptions = {
        fs: this.fs,
        commands: this.commands,
        maxCallDepth: this.maxCallDepth,
        maxCommandCount: this.maxCommandCount,
        maxLoopIterations: this.maxLoopIterations,
        exec: this.exec.bind(this),
      };

      const interpreter = new Interpreter(interpreterOptions, this.state);
      return await interpreter.executeScript(ast);
    } catch (error) {
      if ((error as ParseException).name === "ParseException") {
        return {
          stdout: "",
          stderr: `bash: syntax error: ${(error as Error).message}\n`,
          exitCode: 2,
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
