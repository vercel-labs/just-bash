/**
 * BashEnv - Bash Shell Environment
 *
 * A complete bash-like shell environment using a proper AST-based architecture:
 *   Input → Parser → AST → Executor → Output
 *
 * This implementation uses:
 * - Recursive descent parser producing typed AST nodes
 * - Tree-walking executor with visitor pattern
 * - Proper word expansion (brace, tilde, parameter, command, arithmetic)
 */

import type {
  ArithExpr,
  ArithmeticCommandNode,
  CaseNode,
  CommandNode,
  ConditionalCommandNode,
  ConditionalExpressionNode,
  CStyleForNode,
  ForNode,
  FunctionDefNode,
  GroupNode,
  HereDocNode,
  IfNode,
  PipelineNode,
  RedirectionNode,
  ScriptNode,
  SimpleCommandNode,
  StatementNode,
  SubshellNode,
  UntilNode,
  WhileNode,
  WordNode,
  WordPart,
} from "./ast/types.js";
import { createLazyCommands } from "./commands/registry.js";
import { type IFileSystem, VirtualFs } from "./fs.js";
import type { InitialFiles } from "./fs-interface.js";
import { type ParseException, parse } from "./parser/parser.js";
import { GlobExpander } from "./shell/glob.js";
import type {
  Command,
  CommandContext,
  CommandRegistry,
  ExecResult,
} from "./types.js";

// Default protection limits
const DEFAULT_MAX_CALL_DEPTH = 100;
const DEFAULT_MAX_COMMAND_COUNT = 100000; // Higher than loop iterations to let loop limit trigger first
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
  private cwd: string;
  private env: Record<string, string>;
  private commands: CommandRegistry = new Map();
  private functions: Map<string, FunctionDefNode> = new Map();
  private previousDir: string = "/home/user";
  private useDefaultLayout: boolean = false;
  private localScopes: Map<string, string | undefined>[] = [];
  private callDepth: number = 0;
  private commandCount: number = 0;
  private maxCallDepth: number;
  private maxCommandCount: number;
  private maxLoopIterations: number;
  private lastExitCode: number = 0;

  constructor(options: BashEnvOptions = {}) {
    const fs = options.fs ?? new VirtualFs(options.files);
    this.fs = fs;

    this.useDefaultLayout = !options.cwd && !options.files;
    this.cwd = options.cwd || (this.useDefaultLayout ? "/home/user" : "/");
    this.env = {
      HOME: this.useDefaultLayout ? "/home/user" : "/",
      PATH: "/bin:/usr/bin",
      IFS: " \t\n",
      ...options.env,
    };

    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
    this.maxCommandCount = options.maxCommandCount ?? DEFAULT_MAX_COMMAND_COUNT;
    this.maxLoopIterations =
      options.maxLoopIterations ?? DEFAULT_MAX_LOOP_ITERATIONS;

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

    if (this.cwd !== "/" && fs instanceof VirtualFs) {
      try {
        fs.mkdirSync(this.cwd, { recursive: true });
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
    if (this.callDepth === 0) {
      this.commandCount = 0;
    }

    this.commandCount++;
    if (this.commandCount > this.maxCommandCount) {
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
      return await this.executeScript(ast);
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
  // AST EXECUTION
  // ===========================================================================

  private async executeScript(node: ScriptNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    for (const statement of node.statements) {
      const result = await this.executeStatement(statement);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
      this.lastExitCode = exitCode;
      this.env["?"] = String(exitCode);
    }

    return { stdout, stderr, exitCode };
  }

  private async executeStatement(node: StatementNode): Promise<ExecResult> {
    // Check command count limit to prevent infinite loops - hard crash
    this.commandCount++;
    if (this.commandCount > this.maxCommandCount) {
      const err = new Error(
        `bash: too many commands executed (>${this.maxCommandCount}), increase maxCommandCount`,
      );
      console.error(err.message);
      throw err;
    }

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    for (let i = 0; i < node.pipelines.length; i++) {
      const pipeline = node.pipelines[i];
      const operator = i > 0 ? node.operators[i - 1] : null;

      // Short-circuit evaluation
      if (operator === "&&" && exitCode !== 0) continue;
      if (operator === "||" && exitCode === 0) continue;

      const result = await this.executePipeline(pipeline);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
    }

    // Handle background execution (simplified - just execute normally)
    if (node.background) {
      // In a real shell, this would fork to background
    }

    return { stdout, stderr, exitCode };
  }

  private async executePipeline(node: PipelineNode): Promise<ExecResult> {
    let stdin = "";
    let lastResult: ExecResult = { stdout: "", stderr: "", exitCode: 0 };

    for (let i = 0; i < node.commands.length; i++) {
      const command = node.commands[i];
      const isLast = i === node.commands.length - 1;

      const result = await this.executeCommand(command, stdin);

      if (!isLast) {
        // Pipe stdout to next command's stdin
        stdin = result.stdout;
        lastResult = {
          stdout: "",
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      } else {
        lastResult = result;
      }
    }

    // Apply negation
    if (node.negated) {
      lastResult = {
        ...lastResult,
        exitCode: lastResult.exitCode === 0 ? 1 : 0,
      };
    }

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
        return this.executeIf(node);
      case "For":
        return this.executeFor(node);
      case "CStyleFor":
        return this.executeCStyleFor(node);
      case "While":
        return this.executeWhile(node);
      case "Until":
        return this.executeUntil(node);
      case "Case":
        return this.executeCase(node);
      case "Subshell":
        return this.executeSubshell(node);
      case "Group":
        return this.executeGroup(node);
      case "FunctionDef":
        return this.executeFunctionDef(node);
      case "ArithmeticCommand":
        return this.executeArithmeticCommand(node);
      case "ConditionalCommand":
        return this.executeConditionalCommand(node);
      default:
        return { stdout: "", stderr: "", exitCode: 0 };
    }
  }

  // ===========================================================================
  // SIMPLE COMMAND EXECUTION
  // ===========================================================================

  private async executeSimpleCommand(
    node: SimpleCommandNode,
    stdin: string,
  ): Promise<ExecResult> {
    // Handle prefix assignments
    const tempAssignments: Record<string, string | undefined> = {};

    for (const assignment of node.assignments) {
      const name = assignment.name;
      const value = assignment.value
        ? await this.expandWord(assignment.value)
        : "";

      if (node.name) {
        // Temporary assignment for command
        tempAssignments[name] = this.env[name];
        this.env[name] = value;
      } else {
        // Permanent assignment (no command)
        this.env[name] = value;
      }
    }

    // If no command, just assignments
    if (!node.name) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // Handle stdin redirection first
    for (const redir of node.redirections) {
      // Handle here-documents
      if (
        (redir.operator === "<<" || redir.operator === "<<-") &&
        redir.target.type === "HereDoc"
      ) {
        const hereDoc = redir.target as HereDocNode;
        if (hereDoc.quoted) {
          // No expansion - use content literally
          stdin = await this.expandWord(hereDoc.content);
        } else {
          // Expand variables in here-doc content
          stdin = await this.expandWord(hereDoc.content);
        }
        continue;
      }

      // Handle here-strings
      if (redir.operator === "<<<" && redir.target.type === "Word") {
        stdin = `${await this.expandWord(redir.target as WordNode)}\n`;
        continue;
      }

      // Handle input redirection from file
      if (redir.operator === "<" && redir.target.type === "Word") {
        try {
          const target = await this.expandWord(redir.target as WordNode);
          const filePath = this.resolvePath(target);
          stdin = await this.fs.readFile(filePath);
        } catch {
          const target = await this.expandWord(redir.target as WordNode);
          // Restore temp assignments
          for (const [name, value] of Object.entries(tempAssignments)) {
            if (value === undefined) delete this.env[name];
            else this.env[name] = value;
          }
          return {
            stdout: "",
            stderr: `bash: ${target}: No such file or directory\n`,
            exitCode: 1,
          };
        }
      }
    }

    // Expand command name and args
    const commandName = await this.expandWord(node.name);
    const args: string[] = [];
    const quotedArgs: boolean[] = [];

    for (const arg of node.args) {
      const expanded = await this.expandWordWithGlob(arg);
      for (const value of expanded.values) {
        args.push(value);
        quotedArgs.push(expanded.quoted);
      }
    }

    // Execute the command
    let result = await this.runCommand(commandName, args, quotedArgs, stdin);

    // Apply output redirections
    result = await this.applyRedirections(result, node.redirections);

    // Restore temp assignments
    for (const [name, value] of Object.entries(tempAssignments)) {
      if (value === undefined) delete this.env[name];
      else this.env[name] = value;
    }

    return result;
  }

  private async runCommand(
    commandName: string,
    args: string[],
    _quotedArgs: boolean[],
    stdin: string,
  ): Promise<ExecResult> {
    // Handle built-in commands that modify shell state
    if (commandName === "cd") {
      return await this.handleCd(args);
    }
    if (commandName === "export") {
      return this.handleExport(args);
    }
    if (commandName === "unset") {
      return this.handleUnset(args);
    }
    if (commandName === "exit") {
      return this.handleExit(args);
    }
    if (commandName === "local") {
      return this.handleLocal(args);
    }
    if (commandName === "[[") {
      // Test expression - find matching ]]
      const endIdx = args.lastIndexOf("]]");
      if (endIdx !== -1) {
        const testArgs = args.slice(0, endIdx);
        return this.evaluateTestArgs(testArgs);
      }
      return { stdout: "", stderr: "bash: [[: missing `]]'\n", exitCode: 2 };
    }
    if (commandName === "[" || commandName === "test") {
      // POSIX test
      let testArgs = args;
      if (commandName === "[" && args[args.length - 1] === "]") {
        testArgs = args.slice(0, -1);
      }
      return this.evaluateTestArgs(testArgs);
    }

    // Check for user-defined functions
    const func = this.functions.get(commandName);
    if (func) {
      return this.callFunction(func, args);
    }

    // Look up command
    let cmdName = commandName;
    if (commandName.includes("/")) {
      cmdName = commandName.split("/").pop() || commandName;
    }

    const cmd = this.commands.get(cmdName);
    if (!cmd) {
      return {
        stdout: "",
        stderr: `bash: ${commandName}: command not found\n`,
        exitCode: 127,
      };
    }

    // Execute external command
    const ctx: CommandContext = {
      fs: this.fs,
      cwd: this.cwd,
      env: this.env,
      stdin,
      exec: this.exec.bind(this),
    };

    try {
      return await cmd.execute(args, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        stdout: "",
        stderr: `${commandName}: ${message}\n`,
        exitCode: 1,
      };
    }
  }

  // ===========================================================================
  // CONTROL FLOW
  // ===========================================================================

  private async executeIf(node: IfNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    for (const clause of node.clauses) {
      // Execute condition
      let conditionExitCode = 0;
      for (const stmt of clause.condition) {
        const result = await this.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        conditionExitCode = result.exitCode;
      }

      if (conditionExitCode === 0) {
        // Condition true - execute body
        for (const stmt of clause.body) {
          const result = await this.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        }
        return { stdout, stderr, exitCode };
      }
    }

    // No condition matched, try else
    if (node.elseBody) {
      for (const stmt of node.elseBody) {
        const result = await this.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }
    }

    return { stdout, stderr, exitCode };
  }

  private async executeFor(node: ForNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let iterations = 0;

    // Get words to iterate over
    let words: string[] = [];
    if (node.words === null) {
      // for VAR; do ... (iterate over $@)
      words = (this.env["@"] || "").split(" ").filter(Boolean);
    } else if (node.words.length === 0) {
      // Empty list - don't iterate
      words = [];
    } else {
      for (const word of node.words) {
        const expanded = await this.expandWordWithGlob(word);
        words.push(...expanded.values);
      }
    }

    for (const value of words) {
      iterations++;
      if (iterations > this.maxLoopIterations) {
        return {
          stdout,
          stderr:
            stderr +
            `bash: for loop: too many iterations (${this.maxLoopIterations}), increase maxLoopIterations\n`,
          exitCode: 1,
        };
      }

      this.env[node.variable] = value;

      for (const stmt of node.body) {
        try {
          const result = await this.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        } catch (error) {
          // Convert command count error to proper error result
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            stdout,
            stderr: `${stderr + message}\n`,
            exitCode: 1,
          };
        }
      }
    }

    // Clean up loop variable after loop completes
    delete this.env[node.variable];

    return { stdout, stderr, exitCode };
  }

  private async executeCStyleFor(node: CStyleForNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let iterations = 0;

    // Execute init
    if (node.init) {
      this.evaluateArithmetic(node.init.expression);
    }

    while (true) {
      iterations++;
      if (iterations > this.maxLoopIterations) {
        return {
          stdout,
          stderr:
            stderr +
            `bash: for loop: too many iterations (${this.maxLoopIterations}), increase maxLoopIterations\n`,
          exitCode: 1,
        };
      }

      // Check condition
      if (node.condition) {
        const condResult = this.evaluateArithmetic(node.condition.expression);
        if (condResult === 0) break;
      }

      // Execute body
      for (const stmt of node.body) {
        try {
          const result = await this.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
        }
      }

      // Execute update
      if (node.update) {
        this.evaluateArithmetic(node.update.expression);
      }
    }

    return { stdout, stderr, exitCode };
  }

  private async executeWhile(node: WhileNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let iterations = 0;

    while (true) {
      iterations++;
      if (iterations > this.maxLoopIterations) {
        return {
          stdout,
          stderr:
            stderr +
            `bash: while loop: too many iterations (${this.maxLoopIterations}), increase maxLoopIterations\n`,
          exitCode: 1,
        };
      }

      // Check condition
      let conditionExitCode = 0;
      for (const stmt of node.condition) {
        try {
          const result = await this.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          conditionExitCode = result.exitCode;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
        }
      }

      if (conditionExitCode !== 0) break;

      // Execute body
      for (const stmt of node.body) {
        try {
          const result = await this.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
        }
      }
    }

    return { stdout, stderr, exitCode };
  }

  private async executeUntil(node: UntilNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let iterations = 0;

    while (true) {
      iterations++;
      if (iterations > this.maxLoopIterations) {
        return {
          stdout,
          stderr:
            stderr +
            `bash: until loop: too many iterations (${this.maxLoopIterations}), increase maxLoopIterations\n`,
          exitCode: 1,
        };
      }

      // Check condition
      let conditionExitCode = 0;
      for (const stmt of node.condition) {
        try {
          const result = await this.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          conditionExitCode = result.exitCode;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
        }
      }

      if (conditionExitCode === 0) break;

      // Execute body
      for (const stmt of node.body) {
        try {
          const result = await this.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
        }
      }
    }

    return { stdout, stderr, exitCode };
  }

  private async executeCase(node: CaseNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    const value = await this.expandWord(node.word);

    for (const item of node.items) {
      let matched = false;

      for (const pattern of item.patterns) {
        const patternStr = await this.expandWord(pattern);
        if (this.matchPattern(value, patternStr)) {
          matched = true;
          break;
        }
      }

      if (matched) {
        for (const stmt of item.body) {
          const result = await this.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        }

        if (item.terminator === ";;") {
          break;
        }
        // ;& falls through to next, ;;& continues checking
      }
    }

    return { stdout, stderr, exitCode };
  }

  private async executeSubshell(node: SubshellNode): Promise<ExecResult> {
    // Save state
    const savedEnv = { ...this.env };
    const savedCwd = this.cwd;

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    for (const stmt of node.body) {
      const result = await this.executeStatement(stmt);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
    }

    // Restore state (subshell doesn't affect parent)
    this.env = savedEnv;
    this.cwd = savedCwd;

    return { stdout, stderr, exitCode };
  }

  private async executeGroup(node: GroupNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    for (const stmt of node.body) {
      const result = await this.executeStatement(stmt);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
    }

    return { stdout, stderr, exitCode };
  }

  private executeFunctionDef(node: FunctionDefNode): ExecResult {
    this.functions.set(node.name, node);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  private async callFunction(
    func: FunctionDefNode,
    args: string[],
  ): Promise<ExecResult> {
    this.callDepth++;
    if (this.callDepth > this.maxCallDepth) {
      this.callDepth--;
      return {
        stdout: "",
        stderr: `bash: ${func.name}: maximum recursion depth (${this.maxCallDepth}) exceeded, increase maxCallDepth\n`,
        exitCode: 1,
      };
    }

    // Push local scope
    this.localScopes.push(new Map());

    // Set positional parameters
    const savedPositional: Record<string, string | undefined> = {};
    for (let i = 0; i < args.length; i++) {
      savedPositional[String(i + 1)] = this.env[String(i + 1)];
      this.env[String(i + 1)] = args[i];
    }
    savedPositional["@"] = this.env["@"];
    savedPositional["#"] = this.env["#"];
    this.env["@"] = args.join(" ");
    this.env["#"] = String(args.length);

    // Execute function body
    const result = await this.executeCommand(func.body, "");

    // Pop local scope
    const localScope = this.localScopes.pop();
    if (localScope) {
      for (const [varName, originalValue] of localScope) {
        if (originalValue === undefined) {
          delete this.env[varName];
        } else {
          this.env[varName] = originalValue;
        }
      }
    }

    // Restore positional parameters
    for (const [key, value] of Object.entries(savedPositional)) {
      if (value === undefined) {
        delete this.env[key];
      } else {
        this.env[key] = value;
      }
    }

    this.callDepth--;
    return result;
  }

  private executeArithmeticCommand(node: ArithmeticCommandNode): ExecResult {
    try {
      const result = this.evaluateArithmetic(node.expression.expression);
      return { stdout: "", stderr: "", exitCode: result === 0 ? 1 : 0 };
    } catch (error) {
      return {
        stdout: "",
        stderr: `bash: arithmetic expression: ${(error as Error).message}\n`,
        exitCode: 1,
      };
    }
  }

  private async executeConditionalCommand(
    node: ConditionalCommandNode,
  ): Promise<ExecResult> {
    try {
      const result = await this.evaluateConditional(node.expression);
      return { stdout: "", stderr: "", exitCode: result ? 0 : 1 };
    } catch (error) {
      return {
        stdout: "",
        stderr: `bash: conditional expression: ${(error as Error).message}\n`,
        exitCode: 2,
      };
    }
  }

  // ===========================================================================
  // WORD EXPANSION
  // ===========================================================================

  private async expandWord(word: WordNode): Promise<string> {
    const wordParts = word.parts;
    const len = wordParts.length;

    // Fast path: single part (very common)
    if (len === 1) {
      return this.expandPart(wordParts[0]);
    }

    // Multiple parts: build array
    const parts: string[] = [];
    for (let i = 0; i < len; i++) {
      parts.push(await this.expandPart(wordParts[i]));
    }
    return parts.join("");
  }

  private async expandWordWithGlob(
    word: WordNode,
  ): Promise<{ values: string[]; quoted: boolean }> {
    const wordParts = word.parts;
    const len = wordParts.length;
    let hasQuoted = false;
    let hasCommandSub = false;
    let hasArrayVar = false;
    let value: string;

    // Fast path: single part (very common)
    if (len === 1) {
      const part = wordParts[0];
      const partType = part.type;
      if (partType === "SingleQuoted" || partType === "DoubleQuoted") {
        hasQuoted = true;
      }
      if (partType === "CommandSubstitution") {
        hasCommandSub = true;
      }
      if (
        partType === "ParameterExpansion" &&
        ((part as any).parameter === "@" || (part as any).parameter === "*")
      ) {
        hasArrayVar = true;
      }
      value = await this.expandPart(part);
    } else {
      // Multiple parts: build array
      const parts: string[] = [];
      for (let i = 0; i < len; i++) {
        const part = wordParts[i];
        const partType = part.type;
        if (partType === "SingleQuoted" || partType === "DoubleQuoted") {
          hasQuoted = true;
        }
        if (partType === "CommandSubstitution") {
          hasCommandSub = true;
        }
        if (
          partType === "ParameterExpansion" &&
          ((part as any).parameter === "@" || (part as any).parameter === "*")
        ) {
          hasArrayVar = true;
        }
        parts.push(await this.expandPart(part));
      }
      value = parts.join("");
    }

    // Word splitting for unquoted command substitution or $@/$* results
    if (!hasQuoted && (hasCommandSub || hasArrayVar) && value.includes(" ")) {
      const splitValues = value.split(/\s+/).filter((v) => v !== "");
      if (splitValues.length > 1) {
        return { values: splitValues, quoted: false };
      }
    }

    // Glob expansion (only if not quoted)
    if (!hasQuoted && /[*?[]/.test(value)) {
      const globExpander = new GlobExpander(this.fs, this.cwd);
      const matches = await globExpander.expand(value);
      if (matches.length > 0) {
        return { values: matches, quoted: false };
      }
    }

    return { values: [value], quoted: hasQuoted };
  }

  private async expandPart(part: WordPart): Promise<string> {
    switch (part.type) {
      case "Literal":
        return part.value;

      case "SingleQuoted":
        return part.value;

      case "DoubleQuoted": {
        const parts: string[] = [];
        for (const p of part.parts) {
          parts.push(await this.expandPart(p));
        }
        return parts.join("");
      }

      case "Escaped":
        return part.value;

      case "ParameterExpansion":
        return this.expandParameter(part);

      case "CommandSubstitution": {
        const result = await this.executeScript(part.body);
        return result.stdout.replace(/\n+$/, "");
      }

      case "ArithmeticExpansion": {
        const value = this.evaluateArithmetic(part.expression.expression);
        return String(value);
      }

      case "TildeExpansion":
        if (part.user === null) {
          return this.env.HOME || "/home/user";
        }
        return `/home/${part.user}`;

      case "BraceExpansion": {
        // Brace expansion should be handled earlier, but fallback
        const results: string[] = [];
        for (const item of part.items) {
          if (item.type === "Range") {
            const start = item.start;
            const end = item.end;
            if (typeof start === "number" && typeof end === "number") {
              const step = item.step || 1;
              if (start <= end) {
                for (let i = start; i <= end; i += step)
                  results.push(String(i));
              } else {
                for (let i = start; i >= end; i -= step)
                  results.push(String(i));
              }
            } else if (typeof start === "string" && typeof end === "string") {
              const startCode = start.charCodeAt(0);
              const endCode = end.charCodeAt(0);
              if (startCode <= endCode) {
                for (let i = startCode; i <= endCode; i++)
                  results.push(String.fromCharCode(i));
              } else {
                for (let i = startCode; i >= endCode; i--)
                  results.push(String.fromCharCode(i));
              }
            }
          } else {
            results.push(await this.expandWord(item.word));
          }
        }
        return results.join(" ");
      }

      case "Glob":
        return part.pattern;

      default:
        return "";
    }
  }

  private expandParameter(part: {
    type: "ParameterExpansion";
    parameter: string;
    operation: any;
  }): string {
    const { parameter, operation } = part;
    const value = this.getVariable(parameter);

    if (!operation) {
      return value;
    }

    const isUnset = !(parameter in this.env);
    const isEmpty = value === "";

    switch (operation.type) {
      case "DefaultValue": {
        const useDefault = isUnset || (operation.checkEmpty && isEmpty);
        if (useDefault && operation.word) {
          // Simplified: use literal value
          return operation.word.parts.map((p: any) => p.value || "").join("");
        }
        return value;
      }

      case "AssignDefault": {
        const useDefault = isUnset || (operation.checkEmpty && isEmpty);
        if (useDefault && operation.word) {
          const defaultValue = operation.word.parts
            .map((p: any) => p.value || "")
            .join("");
          this.env[parameter] = defaultValue;
          return defaultValue;
        }
        return value;
      }

      case "ErrorIfUnset": {
        const shouldError = isUnset || (operation.checkEmpty && isEmpty);
        if (shouldError) {
          const message = operation.word
            ? operation.word.parts.map((p: any) => p.value || "").join("")
            : `${parameter}: parameter null or not set`;
          throw new Error(message);
        }
        return value;
      }

      case "UseAlternative": {
        const useAlternative = !(isUnset || (operation.checkEmpty && isEmpty));
        if (useAlternative && operation.word) {
          return operation.word.parts.map((p: any) => p.value || "").join("");
        }
        return "";
      }

      case "Length":
        return String(value.length);

      case "Substring": {
        const offset = operation.offset?.expression?.value ?? 0;
        const length = operation.length?.expression?.value;
        let start = offset;
        if (start < 0) start = Math.max(0, value.length + start);
        if (length !== undefined) {
          if (length < 0) {
            return value.slice(start, Math.max(start, value.length + length));
          }
          return value.slice(start, start + length);
        }
        return value.slice(start);
      }

      case "PatternRemoval": {
        const pattern =
          operation.pattern?.parts.map((p: any) => p.value || "").join("") ||
          "";
        const regex = this.patternToRegex(pattern, operation.greedy);
        if (operation.side === "prefix") {
          return value.replace(new RegExp(`^${regex}`), "");
        }
        return value.replace(new RegExp(`${regex}$`), "");
      }

      case "PatternReplacement": {
        const pattern =
          operation.pattern?.parts.map((p: any) => p.value || "").join("") ||
          "";
        const replacement =
          operation.replacement?.parts
            .map((p: any) => p.value || "")
            .join("") || "";
        const regex = this.patternToRegex(pattern, true);
        const flags = operation.all ? "g" : "";
        return value.replace(new RegExp(regex, flags), replacement);
      }

      case "CaseModification": {
        if (operation.direction === "upper") {
          return operation.all
            ? value.toUpperCase()
            : value.charAt(0).toUpperCase() + value.slice(1);
        }
        return operation.all
          ? value.toLowerCase()
          : value.charAt(0).toLowerCase() + value.slice(1);
      }

      case "Indirection": {
        return this.getVariable(value);
      }

      default:
        return value;
    }
  }

  private getVariable(name: string): string {
    switch (name) {
      case "?":
        return String(this.lastExitCode);
      case "$":
        return String(process.pid);
      case "#":
        return this.env["#"] || "0";
      case "@":
      case "*":
        return this.env["@"] || "";
      case "0":
        return this.env["0"] || "bash";
      case "PWD":
        return this.cwd;
      case "OLDPWD":
        return this.previousDir;
    }

    if (/^[1-9][0-9]*$/.test(name)) {
      return this.env[name] || "";
    }

    return this.env[name] || "";
  }

  private patternToRegex(pattern: string, greedy: boolean): string {
    let regex = "";
    for (const char of pattern) {
      if (char === "*") {
        regex += greedy ? ".*" : ".*?";
      } else if (char === "?") {
        regex += ".";
      } else if (/[\\^$.|+(){}[\]]/.test(char)) {
        regex += `\\${char}`;
      } else {
        regex += char;
      }
    }
    return regex;
  }

  // ===========================================================================
  // ARITHMETIC
  // ===========================================================================

  private evaluateArithmetic(expr: ArithExpr): number {
    switch (expr.type) {
      case "ArithNumber":
        return expr.value;

      case "ArithVariable": {
        const value = this.getVariable(expr.name);
        return Number.parseInt(value, 10) || 0;
      }

      case "ArithBinary": {
        const left = this.evaluateArithmetic(expr.left);
        const right = this.evaluateArithmetic(expr.right);

        switch (expr.operator) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            return right !== 0 ? Math.trunc(left / right) : 0;
          case "%":
            return right !== 0 ? left % right : 0;
          case "**":
            return left ** right;
          case "<<":
            return left << right;
          case ">>":
            return left >> right;
          case "<":
            return left < right ? 1 : 0;
          case "<=":
            return left <= right ? 1 : 0;
          case ">":
            return left > right ? 1 : 0;
          case ">=":
            return left >= right ? 1 : 0;
          case "==":
            return left === right ? 1 : 0;
          case "!=":
            return left !== right ? 1 : 0;
          case "&":
            return left & right;
          case "|":
            return left | right;
          case "^":
            return left ^ right;
          case "&&":
            return left && right ? 1 : 0;
          case "||":
            return left || right ? 1 : 0;
          case ",":
            return right;
          default:
            return 0;
        }
      }

      case "ArithUnary": {
        const operand = this.evaluateArithmetic(expr.operand);
        switch (expr.operator) {
          case "-":
            return -operand;
          case "+":
            return +operand;
          case "!":
            return operand === 0 ? 1 : 0;
          case "~":
            return ~operand;
          case "++":
          case "--": {
            if (expr.operand.type === "ArithVariable") {
              const name = expr.operand.name;
              const current = Number.parseInt(this.getVariable(name), 10) || 0;
              const newValue =
                expr.operator === "++" ? current + 1 : current - 1;
              this.env[name] = String(newValue);
              return expr.prefix ? newValue : current;
            }
            return operand;
          }
          default:
            return operand;
        }
      }

      case "ArithTernary": {
        const condition = this.evaluateArithmetic(expr.condition);
        return condition
          ? this.evaluateArithmetic(expr.consequent)
          : this.evaluateArithmetic(expr.alternate);
      }

      case "ArithAssignment": {
        const name = expr.variable;
        const current = Number.parseInt(this.getVariable(name), 10) || 0;
        const value = this.evaluateArithmetic(expr.value);
        let newValue: number;

        switch (expr.operator) {
          case "=":
            newValue = value;
            break;
          case "+=":
            newValue = current + value;
            break;
          case "-=":
            newValue = current - value;
            break;
          case "*=":
            newValue = current * value;
            break;
          case "/=":
            newValue = value !== 0 ? Math.trunc(current / value) : 0;
            break;
          case "%=":
            newValue = value !== 0 ? current % value : 0;
            break;
          case "<<=":
            newValue = current << value;
            break;
          case ">>=":
            newValue = current >> value;
            break;
          case "&=":
            newValue = current & value;
            break;
          case "|=":
            newValue = current | value;
            break;
          case "^=":
            newValue = current ^ value;
            break;
          default:
            newValue = value;
        }

        this.env[name] = String(newValue);
        return newValue;
      }

      case "ArithGroup":
        return this.evaluateArithmetic(expr.expression);

      default:
        return 0;
    }
  }

  // ===========================================================================
  // CONDITIONAL EXPRESSIONS
  // ===========================================================================

  private async evaluateConditional(
    expr: ConditionalExpressionNode,
  ): Promise<boolean> {
    switch (expr.type) {
      case "CondBinary": {
        const left = await this.expandWord(expr.left);
        const right = await this.expandWord(expr.right);

        switch (expr.operator) {
          case "==":
          case "=":
            return this.matchPattern(left, right);
          case "!=":
            return !this.matchPattern(left, right);
          case "=~": {
            try {
              const regex = new RegExp(right);
              const match = left.match(regex);
              if (match) {
                // Set BASH_REMATCH
                this.env.BASH_REMATCH = match[0];
                for (let i = 1; i < match.length; i++) {
                  this.env[`BASH_REMATCH_${i}`] = match[i] || "";
                }
              }
              return match !== null;
            } catch {
              return false;
            }
          }
          case "<":
            return left < right;
          case ">":
            return left > right;
          case "-eq":
            return Number.parseInt(left, 10) === Number.parseInt(right, 10);
          case "-ne":
            return Number.parseInt(left, 10) !== Number.parseInt(right, 10);
          case "-lt":
            return Number.parseInt(left, 10) < Number.parseInt(right, 10);
          case "-le":
            return Number.parseInt(left, 10) <= Number.parseInt(right, 10);
          case "-gt":
            return Number.parseInt(left, 10) > Number.parseInt(right, 10);
          case "-ge":
            return Number.parseInt(left, 10) >= Number.parseInt(right, 10);
          case "-nt":
          case "-ot":
          case "-ef":
            // File comparison - simplified
            return false;
          default:
            return false;
        }
      }

      case "CondUnary": {
        const operand = await this.expandWord(expr.operand);

        switch (expr.operator) {
          case "-z":
            return operand === "";
          case "-n":
            return operand !== "";
          case "-e":
          case "-a":
            return await this.fs.exists(this.resolvePath(operand));
          case "-f": {
            const path = this.resolvePath(operand);
            if (await this.fs.exists(path)) {
              const stat = await this.fs.stat(path);
              return stat.isFile;
            }
            return false;
          }
          case "-d": {
            const path = this.resolvePath(operand);
            if (await this.fs.exists(path)) {
              const stat = await this.fs.stat(path);
              return stat.isDirectory;
            }
            return false;
          }
          case "-r":
          case "-w":
          case "-x":
            return await this.fs.exists(this.resolvePath(operand));
          case "-s": {
            const path = this.resolvePath(operand);
            if (await this.fs.exists(path)) {
              const content = await this.fs.readFile(path);
              return content.length > 0;
            }
            return false;
          }
          case "-L":
          case "-h": {
            const path = this.resolvePath(operand);
            if (await this.fs.exists(path)) {
              const stat = await this.fs.lstat(path);
              return stat.isSymbolicLink;
            }
            return false;
          }
          case "-v":
            return operand in this.env;
          default:
            return false;
        }
      }

      case "CondNot":
        return !(await this.evaluateConditional(expr.operand));

      case "CondAnd": {
        const left = await this.evaluateConditional(expr.left);
        if (!left) return false;
        return await this.evaluateConditional(expr.right);
      }

      case "CondOr": {
        const left = await this.evaluateConditional(expr.left);
        if (left) return true;
        return await this.evaluateConditional(expr.right);
      }

      case "CondGroup":
        return await this.evaluateConditional(expr.expression);

      case "CondWord": {
        const value = await this.expandWord(expr.word);
        return value !== "";
      }

      default:
        return false;
    }
  }

  private async evaluateTestArgs(args: string[]): Promise<ExecResult> {
    if (args.length === 0) {
      return { stdout: "", stderr: "", exitCode: 1 };
    }

    // Single arg: true if non-empty
    if (args.length === 1) {
      return { stdout: "", stderr: "", exitCode: args[0] ? 0 : 1 };
    }

    // Two args: unary operator
    if (args.length === 2) {
      const op = args[0];
      const operand = args[1];

      switch (op) {
        case "-z":
          return { stdout: "", stderr: "", exitCode: operand === "" ? 0 : 1 };
        case "-n":
          return { stdout: "", stderr: "", exitCode: operand !== "" ? 0 : 1 };
        case "-e":
        case "-a": {
          const exists = await this.fs.exists(this.resolvePath(operand));
          return { stdout: "", stderr: "", exitCode: exists ? 0 : 1 };
        }
        case "-f": {
          const path = this.resolvePath(operand);
          if (await this.fs.exists(path)) {
            const stat = await this.fs.stat(path);
            return { stdout: "", stderr: "", exitCode: stat.isFile ? 0 : 1 };
          }
          return { stdout: "", stderr: "", exitCode: 1 };
        }
        case "-d": {
          const path = this.resolvePath(operand);
          if (await this.fs.exists(path)) {
            const stat = await this.fs.stat(path);
            return {
              stdout: "",
              stderr: "",
              exitCode: stat.isDirectory ? 0 : 1,
            };
          }
          return { stdout: "", stderr: "", exitCode: 1 };
        }
        case "-r":
        case "-w":
        case "-x": {
          const exists = await this.fs.exists(this.resolvePath(operand));
          return { stdout: "", stderr: "", exitCode: exists ? 0 : 1 };
        }
        case "-s": {
          const path = this.resolvePath(operand);
          if (await this.fs.exists(path)) {
            const content = await this.fs.readFile(path);
            return {
              stdout: "",
              stderr: "",
              exitCode: content.length > 0 ? 0 : 1,
            };
          }
          return { stdout: "", stderr: "", exitCode: 1 };
        }
        case "!":
          return { stdout: "", stderr: "", exitCode: operand ? 1 : 0 };
        default:
          return { stdout: "", stderr: "", exitCode: 1 };
      }
    }

    // Three args: binary operator
    if (args.length === 3) {
      const left = args[0];
      const op = args[1];
      const right = args[2];

      switch (op) {
        case "=":
        case "==":
          return {
            stdout: "",
            stderr: "",
            exitCode: this.matchPattern(left, right) ? 0 : 1,
          };
        case "!=":
          return {
            stdout: "",
            stderr: "",
            exitCode: !this.matchPattern(left, right) ? 0 : 1,
          };
        case "-eq":
          return {
            stdout: "",
            stderr: "",
            exitCode:
              Number.parseInt(left, 10) === Number.parseInt(right, 10) ? 0 : 1,
          };
        case "-ne":
          return {
            stdout: "",
            stderr: "",
            exitCode:
              Number.parseInt(left, 10) !== Number.parseInt(right, 10) ? 0 : 1,
          };
        case "-lt":
          return {
            stdout: "",
            stderr: "",
            exitCode:
              Number.parseInt(left, 10) < Number.parseInt(right, 10) ? 0 : 1,
          };
        case "-le":
          return {
            stdout: "",
            stderr: "",
            exitCode:
              Number.parseInt(left, 10) <= Number.parseInt(right, 10) ? 0 : 1,
          };
        case "-gt":
          return {
            stdout: "",
            stderr: "",
            exitCode:
              Number.parseInt(left, 10) > Number.parseInt(right, 10) ? 0 : 1,
          };
        case "-ge":
          return {
            stdout: "",
            stderr: "",
            exitCode:
              Number.parseInt(left, 10) >= Number.parseInt(right, 10) ? 0 : 1,
          };
        default:
          return { stdout: "", stderr: "", exitCode: 1 };
      }
    }

    // Complex expression with && and ||
    // Simplified handling
    return { stdout: "", stderr: "", exitCode: 1 };
  }

  private matchPattern(value: string, pattern: string): boolean {
    // Convert glob pattern to regex
    let regex = "^";
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === "*") {
        regex += ".*";
      } else if (char === "?") {
        regex += ".";
      } else if (char === "[") {
        const closeIdx = pattern.indexOf("]", i + 1);
        if (closeIdx !== -1) {
          regex += pattern.slice(i, closeIdx + 1);
          i = closeIdx;
        } else {
          regex += "\\[";
        }
      } else if (/[\\^$.|+(){}]/.test(char)) {
        regex += `\\${char}`;
      } else {
        regex += char;
      }
    }
    regex += "$";

    return new RegExp(regex).test(value);
  }

  // ===========================================================================
  // REDIRECTIONS
  // ===========================================================================

  private async applyRedirections(
    result: ExecResult,
    redirections: RedirectionNode[],
  ): Promise<ExecResult> {
    let { stdout, stderr, exitCode } = result;

    for (const redir of redirections) {
      if (redir.target.type === "HereDoc") {
        continue; // Here-docs handled separately
      }

      const target = await this.expandWord(redir.target as WordNode);

      switch (redir.operator) {
        case ">": {
          const fd = redir.fd ?? 1;
          if (fd === 1) {
            const filePath = this.resolvePath(target);
            await this.fs.writeFile(filePath, stdout);
            stdout = "";
          } else if (fd === 2) {
            if (target === "/dev/null") {
              stderr = "";
            } else {
              const filePath = this.resolvePath(target);
              await this.fs.writeFile(filePath, stderr);
              stderr = "";
            }
          }
          break;
        }

        case ">>": {
          const fd = redir.fd ?? 1;
          if (fd === 1) {
            const filePath = this.resolvePath(target);
            await this.fs.appendFile(filePath, stdout);
            stdout = "";
          } else if (fd === 2) {
            const filePath = this.resolvePath(target);
            await this.fs.appendFile(filePath, stderr);
            stderr = "";
          }
          break;
        }

        case ">&": {
          if (target === "1" || target === "&1") {
            stdout += stderr;
            stderr = "";
          }
          break;
        }

        case "&>": {
          const filePath = this.resolvePath(target);
          await this.fs.writeFile(filePath, stdout + stderr);
          stdout = "";
          stderr = "";
          break;
        }

        case "&>>": {
          const filePath = this.resolvePath(target);
          await this.fs.appendFile(filePath, stdout + stderr);
          stdout = "";
          stderr = "";
          break;
        }
      }
    }

    return { stdout, stderr, exitCode };
  }

  // ===========================================================================
  // BUILT-IN COMMANDS
  // ===========================================================================

  private async handleCd(args: string[]): Promise<ExecResult> {
    let target: string;

    if (args.length === 0 || args[0] === "~") {
      target = this.env.HOME || "/";
    } else if (args[0] === "-") {
      target = this.previousDir;
    } else {
      target = args[0];
    }

    const newDir = this.resolvePath(target);

    // Check if directory exists
    try {
      const statResult = await this.fs.stat(newDir);
      if (!statResult.isDirectory) {
        return {
          stdout: "",
          stderr: `bash: cd: ${target}: Not a directory\n`,
          exitCode: 1,
        };
      }
    } catch {
      // If stat fails, directory doesn't exist (unless root)
      if (newDir !== "/") {
        return {
          stdout: "",
          stderr: `bash: cd: ${target}: No such file or directory\n`,
          exitCode: 1,
        };
      }
    }

    this.previousDir = this.cwd;
    this.cwd = newDir;
    this.env.PWD = this.cwd;
    this.env.OLDPWD = this.previousDir;

    return { stdout: "", stderr: "", exitCode: 0 };
  }

  private handleExport(args: string[]): ExecResult {
    for (const arg of args) {
      if (arg.includes("=")) {
        const [name, ...rest] = arg.split("=");
        this.env[name] = rest.join("=");
      }
      // If no =, the variable is just marked for export (no-op in our impl)
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  private handleUnset(args: string[]): ExecResult {
    for (const arg of args) {
      delete this.env[arg];
      this.functions.delete(arg);
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  private handleExit(args: string[]): ExecResult {
    const code = args.length > 0 ? Number.parseInt(args[0], 10) || 0 : 0;
    return { stdout: "", stderr: "", exitCode: code };
  }

  private handleLocal(args: string[]): ExecResult {
    if (this.localScopes.length === 0) {
      return {
        stdout: "",
        stderr: "bash: local: can only be used in a function\n",
        exitCode: 1,
      };
    }

    const currentScope = this.localScopes[this.localScopes.length - 1];

    for (const arg of args) {
      if (arg.includes("=")) {
        const [name, ...rest] = arg.split("=");
        if (!currentScope.has(name)) {
          currentScope.set(name, this.env[name]);
        }
        this.env[name] = rest.join("=");
      } else {
        if (!currentScope.has(arg)) {
          currentScope.set(arg, this.env[arg]);
        }
      }
    }

    return { stdout: "", stderr: "", exitCode: 0 };
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private resolvePath(path: string): string {
    return this.fs.resolvePath(this.cwd, path);
  }

  // Public API
  async readFile(path: string): Promise<string> {
    return this.fs.readFile(this.resolvePath(path));
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.fs.writeFile(this.resolvePath(path), content);
  }

  getCwd(): string {
    return this.cwd;
  }

  getEnv(): Record<string, string> {
    return { ...this.env };
  }
}
