/**
 * Tree-Walking Interpreter for Bash AST
 *
 * This interpreter executes bash scripts by walking the AST.
 * It follows the classic interpreter pattern:
 *
 *   1. Visit node
 *   2. Expand words (variable substitution, command substitution, etc.)
 *   3. Execute command
 *   4. Return result
 *
 * The interpreter maintains:
 *   - Environment variables
 *   - Current working directory
 *   - Function definitions
 *   - Exit status ($?)
 */

import type {
  ArithExpr,
  ArithmeticCommandNode,
  AssignmentNode,
  CaseNode,
  ConditionalCommandNode,
  ConditionalExpressionNode,
  CStyleForNode,
  ForNode,
  FunctionDefNode,
  GroupNode,
  IfNode,
  PipelineNode,
  ScriptNode,
  SimpleCommandNode,
  StatementNode,
  SubshellNode,
  UntilNode,
  WhileNode,
  WordNode,
  WordPart,
} from "../ast/types.js";
import type { IFileSystem } from "../fs-interface.js";
import type { ASTVisitor, ExecResult } from "./visitor.js";
import { visitCommand } from "./visitor.js";

/**
 * Command handler function type
 */
export type CommandHandler = (
  args: string[],
  ctx: CommandContext,
) => Promise<ExecResult> | ExecResult;

/**
 * Context passed to command handlers
 */
export interface CommandContext {
  stdin: string;
  env: Record<string, string>;
  cwd: string;
  fs: IFileSystem;
  /** Execute a nested command */
  exec: (script: string) => Promise<ExecResult>;
}

/**
 * Interpreter options
 */
export interface InterpreterOptions {
  /** Initial environment variables */
  env?: Record<string, string>;
  /** Initial working directory */
  cwd?: string;
  /** Filesystem implementation */
  fs: IFileSystem;
  /** Command registry */
  commands: Map<string, CommandHandler>;
  /** Maximum loop iterations (prevent infinite loops) */
  maxLoopIterations?: number;
  /** Maximum call stack depth */
  maxCallDepth?: number;
}

/**
 * The main interpreter class
 */
export class Interpreter implements ASTVisitor<ExecResult> {
  private env: Record<string, string>;
  private cwd: string;
  private fs: IFileSystem;
  private commands: Map<string, CommandHandler>;
  private functions: Map<string, FunctionDefNode> = new Map();
  private lastExitCode = 0;
  private maxLoopIterations: number;
  private maxCallDepth: number;
  private callDepth = 0;

  constructor(options: InterpreterOptions) {
    this.env = options.env ? { ...options.env } : {};
    this.cwd = options.cwd || "/home/user";
    this.fs = options.fs;
    this.commands = options.commands;
    this.maxLoopIterations = options.maxLoopIterations || 10000;
    this.maxCallDepth = options.maxCallDepth || 100;

    // Set default environment variables
    this.env.HOME = this.env.HOME || "/home/user";
    this.env.PWD = this.cwd;
    this.env.OLDPWD = this.env.OLDPWD || this.cwd;
  }

  /**
   * Execute a script AST
   */
  async execute(script: ScriptNode): Promise<ExecResult> {
    return this.visitScript(script);
  }

  /**
   * Get current environment
   */
  getEnv(): Record<string, string> {
    return { ...this.env };
  }

  /**
   * Get current working directory
   */
  getCwd(): string {
    return this.cwd;
  }

  /**
   * Set current working directory
   */
  setCwd(cwd: string): void {
    this.env.OLDPWD = this.cwd;
    this.cwd = cwd;
    this.env.PWD = cwd;
  }

  // ===========================================================================
  // VISITOR METHODS
  // ===========================================================================

  async visitScript(node: ScriptNode): Promise<ExecResult> {
    let result: ExecResult = { stdout: "", stderr: "", exitCode: 0 };

    for (const statement of node.statements) {
      result = await this.visitStatement(statement);
      this.lastExitCode = result.exitCode;
      this.env["?"] = String(result.exitCode);
    }

    return result;
  }

  async visitStatement(node: StatementNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    for (let i = 0; i < node.pipelines.length; i++) {
      const pipeline = node.pipelines[i];
      const operator = i > 0 ? node.operators[i - 1] : null;

      // Handle && and || operators
      if (operator === "&&" && exitCode !== 0) {
        continue; // Skip if previous failed
      }
      if (operator === "||" && exitCode === 0) {
        continue; // Skip if previous succeeded
      }

      const result = await this.visitPipeline(pipeline);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
    }

    return { stdout, stderr, exitCode };
  }

  async visitPipeline(node: PipelineNode): Promise<ExecResult> {
    let stdin = "";
    let lastResult: ExecResult = { stdout: "", stderr: "", exitCode: 0 };

    for (const command of node.commands) {
      // Pass previous stdout as stdin
      const result = await this.executeCommandWithStdin(command, stdin);
      stdin = result.stdout;
      lastResult = result;
    }

    // Handle pipeline negation (!)
    if (node.negated) {
      lastResult.exitCode = lastResult.exitCode === 0 ? 1 : 0;
    }

    return lastResult;
  }

  private async executeCommandWithStdin(
    command: SimpleCommandNode | FunctionDefNode | any,
    stdin: string,
  ): Promise<ExecResult> {
    // Store stdin for command execution
    const savedStdin = this.env.STDIN;
    this.env.STDIN = stdin;

    try {
      const result = await visitCommand(this, command);
      return result;
    } finally {
      if (savedStdin !== undefined) {
        this.env.STDIN = savedStdin;
      } else {
        delete this.env.STDIN;
      }
    }
  }

  async visitSimpleCommand(node: SimpleCommandNode): Promise<ExecResult> {
    // Handle assignments (VAR=value)
    for (const assignment of node.assignments) {
      await this.executeAssignment(assignment);
    }

    // If no command name, just do assignments
    if (!node.name) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // Expand command name and arguments
    const commandName = await this.expandWord(node.name);
    const args: string[] = [];
    for (const arg of node.args) {
      const expanded = await this.expandWordWithGlob(arg);
      args.push(...expanded);
    }

    // Check for function
    const func = this.functions.get(commandName);
    if (func) {
      return this.executeFunction(func, args);
    }

    // Check for builtin/external command
    const handler = this.commands.get(commandName);
    if (!handler) {
      return {
        stdout: "",
        stderr: `bash: ${commandName}: command not found\n`,
        exitCode: 127,
      };
    }

    // Create command context
    const ctx: CommandContext = {
      stdin: this.env.STDIN || "",
      env: this.env,
      cwd: this.cwd,
      fs: this.fs,
      exec: async (_script: string) => {
        // This would need a parser - for now just return empty
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };

    // Execute command
    try {
      const result = await handler([commandName, ...args], ctx);
      return result;
    } catch (error) {
      return {
        stdout: "",
        stderr: `bash: ${commandName}: ${(error as Error).message}\n`,
        exitCode: 1,
      };
    }
  }

  async visitIf(node: IfNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    // Try each clause
    for (const clause of node.clauses) {
      // Evaluate condition
      let conditionResult: ExecResult = { stdout: "", stderr: "", exitCode: 0 };
      for (const stmt of clause.condition) {
        conditionResult = await this.visitStatement(stmt);
      }

      if (conditionResult.exitCode === 0) {
        // Condition true - execute body
        for (const stmt of clause.body) {
          const result = await this.visitStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        }
        return { stdout, stderr, exitCode };
      }
    }

    // No condition matched - execute else body if present
    if (node.elseBody) {
      for (const stmt of node.elseBody) {
        const result = await this.visitStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }
    }

    return { stdout, stderr, exitCode };
  }

  async visitFor(node: ForNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let iterations = 0;

    // Get list of words to iterate over
    let words: string[];
    if (node.words === null) {
      // for x; do ... done - iterate over positional parameters
      words = (this.env["@"] || "").split(/\s+/).filter((s) => s);
    } else {
      words = [];
      for (const word of node.words) {
        const expanded = await this.expandWordWithGlob(word);
        words.push(...expanded);
      }
    }

    // Iterate
    for (const word of words) {
      if (iterations++ >= this.maxLoopIterations) {
        return {
          stdout,
          stderr:
            stderr +
            `bash: for loop: too many iterations (${this.maxLoopIterations})\n`,
          exitCode: 1,
        };
      }

      // Set loop variable
      this.env[node.variable] = word;

      // Execute body
      for (const stmt of node.body) {
        const result = await this.visitStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }
    }

    // Clean up loop variable
    delete this.env[node.variable];

    return { stdout, stderr, exitCode };
  }

  async visitCStyleFor(node: CStyleForNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let iterations = 0;

    // Execute init expression
    if (node.init) {
      await this.evaluateArithmetic(node.init.expression);
    }

    // Loop
    while (true) {
      if (iterations++ >= this.maxLoopIterations) {
        return {
          stdout,
          stderr:
            stderr +
            `bash: for loop: too many iterations (${this.maxLoopIterations})\n`,
          exitCode: 1,
        };
      }

      // Check condition
      if (node.condition) {
        const condResult = await this.evaluateArithmetic(
          node.condition.expression,
        );
        if (condResult === 0) break;
      }

      // Execute body
      for (const stmt of node.body) {
        const result = await this.visitStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }

      // Execute update
      if (node.update) {
        await this.evaluateArithmetic(node.update.expression);
      }
    }

    return { stdout, stderr, exitCode };
  }

  async visitWhile(node: WhileNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let iterations = 0;

    while (true) {
      if (iterations++ >= this.maxLoopIterations) {
        return {
          stdout,
          stderr:
            stderr +
            `bash: while loop: too many iterations (${this.maxLoopIterations})\n`,
          exitCode: 1,
        };
      }

      // Evaluate condition
      let conditionResult: ExecResult = { stdout: "", stderr: "", exitCode: 0 };
      for (const stmt of node.condition) {
        conditionResult = await this.visitStatement(stmt);
      }

      // Exit if condition failed
      if (conditionResult.exitCode !== 0) break;

      // Execute body
      for (const stmt of node.body) {
        const result = await this.visitStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }
    }

    return { stdout, stderr, exitCode };
  }

  async visitUntil(node: UntilNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let iterations = 0;

    while (true) {
      if (iterations++ >= this.maxLoopIterations) {
        return {
          stdout,
          stderr:
            stderr +
            `bash: until loop: too many iterations (${this.maxLoopIterations})\n`,
          exitCode: 1,
        };
      }

      // Evaluate condition
      let conditionResult: ExecResult = { stdout: "", stderr: "", exitCode: 0 };
      for (const stmt of node.condition) {
        conditionResult = await this.visitStatement(stmt);
      }

      // Exit if condition succeeded
      if (conditionResult.exitCode === 0) break;

      // Execute body
      for (const stmt of node.body) {
        const result = await this.visitStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }
    }

    return { stdout, stderr, exitCode };
  }

  async visitCase(node: CaseNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    // Expand the word to match against
    const word = await this.expandWord(node.word);

    // Try each pattern
    for (const item of node.items) {
      let matched = false;

      for (const pattern of item.patterns) {
        const patternStr = await this.expandWord(pattern);
        if (this.matchGlobPattern(word, patternStr)) {
          matched = true;
          break;
        }
      }

      if (matched) {
        // Execute body
        for (const stmt of item.body) {
          const result = await this.visitStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        }

        // Handle fall-through terminators
        if (item.terminator === ";;") {
          break; // Normal termination
        } else if (item.terminator === ";&") {
        } else if (item.terminator === ";;&") {
        }
      }
    }

    return { stdout, stderr, exitCode };
  }

  async visitSubshell(node: SubshellNode): Promise<ExecResult> {
    // Create a copy of environment for subshell
    const savedEnv = { ...this.env };
    const savedCwd = this.cwd;

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      for (const stmt of node.body) {
        const result = await this.visitStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }
    } finally {
      // Restore parent environment
      this.env = savedEnv;
      this.cwd = savedCwd;
    }

    return { stdout, stderr, exitCode };
  }

  async visitGroup(node: GroupNode): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    for (const stmt of node.body) {
      const result = await this.visitStatement(stmt);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
    }

    return { stdout, stderr, exitCode };
  }

  async visitFunctionDef(node: FunctionDefNode): Promise<ExecResult> {
    // Register the function
    this.functions.set(node.name, node);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  async visitArithmeticCommand(
    node: ArithmeticCommandNode,
  ): Promise<ExecResult> {
    try {
      const result = await this.evaluateArithmetic(node.expression.expression);
      // (( )) returns 0 if result is non-zero, 1 if result is zero
      return { stdout: "", stderr: "", exitCode: result === 0 ? 1 : 0 };
    } catch (error) {
      return {
        stdout: "",
        stderr: `bash: arithmetic expression: ${(error as Error).message}\n`,
        exitCode: 1,
      };
    }
  }

  async visitConditionalCommand(
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

  /**
   * Expand a word node to a string
   */
  async expandWord(node: WordNode): Promise<string> {
    let result = "";
    for (const part of node.parts) {
      result += await this.expandWordPart(part);
    }
    return result;
  }

  /**
   * Expand a word node with glob expansion (may return multiple strings)
   */
  async expandWordWithGlob(node: WordNode): Promise<string[]> {
    const expanded = await this.expandWord(node);

    // Check if the word contains glob patterns
    if (/[*?[]/.test(expanded)) {
      const matches = await this.expandGlob(expanded);
      if (matches.length > 0) {
        return matches;
      }
    }

    return [expanded];
  }

  private async expandWordPart(part: WordPart): Promise<string> {
    switch (part.type) {
      case "Literal":
        return part.value;

      case "SingleQuoted":
        return part.value;

      case "DoubleQuoted": {
        let result = "";
        for (const p of part.parts) {
          result += await this.expandWordPart(p);
        }
        return result;
      }

      case "Escaped":
        return part.value;

      case "ParameterExpansion":
        return this.expandParameter(part);

      case "CommandSubstitution":
        return this.expandCommandSubstitution(part);

      case "ArithmeticExpansion":
        return String(
          await this.evaluateArithmetic(part.expression.expression),
        );

      case "TildeExpansion":
        if (part.user === null) {
          return this.env.HOME || "/home/user";
        }
        return `/home/${part.user}`;

      case "Glob":
        return part.pattern; // Glob expansion happens at word level

      default:
        return "";
    }
  }

  private expandParameter(part: {
    type: "ParameterExpansion";
    parameter: string;
    operation: any;
  }): string {
    const value = this.env[part.parameter] ?? "";

    if (!part.operation) {
      return value;
    }

    // Handle various parameter expansion operations
    switch (part.operation.type) {
      case "DefaultValue":
        if (
          value === "" ||
          (part.operation.checkEmpty && this.env[part.parameter] === undefined)
        ) {
          // Would need to expand the word - simplified for now
          return value || "";
        }
        return value;

      case "Length":
        return String(value.length);

      // Add more operations as needed
      default:
        return value;
    }
  }

  private async expandCommandSubstitution(part: {
    type: "CommandSubstitution";
    body: ScriptNode;
    legacy: boolean;
  }): Promise<string> {
    const result = await this.visitScript(part.body);
    // Remove trailing newline
    return result.stdout.replace(/\n$/, "");
  }

  // ===========================================================================
  // ARITHMETIC EVALUATION
  // ===========================================================================

  private async evaluateArithmetic(expr: ArithExpr): Promise<number> {
    switch (expr.type) {
      case "ArithNumber":
        return expr.value;

      case "ArithVariable": {
        const value = this.env[expr.name];
        return value ? parseInt(value, 10) || 0 : 0;
      }

      case "ArithBinary": {
        const left = await this.evaluateArithmetic(expr.left);
        const right = await this.evaluateArithmetic(expr.right);

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
        const operand = await this.evaluateArithmetic(expr.operand);
        switch (expr.operator) {
          case "-":
            return -operand;
          case "+":
            return operand;
          case "!":
            return operand ? 0 : 1;
          case "~":
            return ~operand;
          default:
            return operand;
        }
      }

      case "ArithTernary": {
        const condition = await this.evaluateArithmetic(expr.condition);
        return condition
          ? await this.evaluateArithmetic(expr.consequent)
          : await this.evaluateArithmetic(expr.alternate);
      }

      case "ArithAssignment": {
        let value = await this.evaluateArithmetic(expr.value);
        const current = parseInt(this.env[expr.variable] || "0", 10);

        switch (expr.operator) {
          case "=":
            break;
          case "+=":
            value = current + value;
            break;
          case "-=":
            value = current - value;
            break;
          case "*=":
            value = current * value;
            break;
          case "/=":
            value = value !== 0 ? Math.trunc(current / value) : 0;
            break;
          case "%=":
            value = value !== 0 ? current % value : 0;
            break;
          // Add more as needed
        }

        this.env[expr.variable] = String(value);
        return value;
      }

      case "ArithGroup":
        return this.evaluateArithmetic(expr.expression);

      default:
        return 0;
    }
  }

  // ===========================================================================
  // CONDITIONAL EVALUATION
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
            return this.matchGlobPattern(left, right);
          case "!=":
            return !this.matchGlobPattern(left, right);
          case "=~":
            return new RegExp(right).test(left);
          case "<":
            return left < right;
          case ">":
            return left > right;
          case "-eq":
            return parseInt(left, 10) === parseInt(right, 10);
          case "-ne":
            return parseInt(left, 10) !== parseInt(right, 10);
          case "-lt":
            return parseInt(left, 10) < parseInt(right, 10);
          case "-le":
            return parseInt(left, 10) <= parseInt(right, 10);
          case "-gt":
            return parseInt(left, 10) > parseInt(right, 10);
          case "-ge":
            return parseInt(left, 10) >= parseInt(right, 10);
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
          default:
            return false;
        }
      }

      case "CondNot":
        return !(await this.evaluateConditional(expr.operand));

      case "CondAnd":
        return (
          (await this.evaluateConditional(expr.left)) &&
          (await this.evaluateConditional(expr.right))
        );

      case "CondOr":
        return (
          (await this.evaluateConditional(expr.left)) ||
          (await this.evaluateConditional(expr.right))
        );

      case "CondGroup":
        return this.evaluateConditional(expr.expression);

      case "CondWord": {
        const value = await this.expandWord(expr.word);
        return value !== "";
      }

      default:
        return false;
    }
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private async executeAssignment(assignment: AssignmentNode): Promise<void> {
    let value = "";
    if (assignment.value) {
      value = await this.expandWord(assignment.value);
    }

    if (assignment.append) {
      this.env[assignment.name] = (this.env[assignment.name] || "") + value;
    } else {
      this.env[assignment.name] = value;
    }
  }

  private async executeFunction(
    func: FunctionDefNode,
    args: string[],
  ): Promise<ExecResult> {
    if (this.callDepth >= this.maxCallDepth) {
      return {
        stdout: "",
        stderr: `bash: ${func.name}: maximum recursion depth exceeded\n`,
        exitCode: 1,
      };
    }

    // Save positional parameters
    const savedParams: Record<string, string> = {};
    for (let i = 0; i <= 9; i++) {
      savedParams[String(i)] = this.env[String(i)] || "";
    }
    savedParams["@"] = this.env["@"] || "";
    savedParams["#"] = this.env["#"] || "";

    // Set new positional parameters
    this.env["0"] = func.name;
    for (let i = 0; i < args.length && i < 9; i++) {
      this.env[String(i + 1)] = args[i];
    }
    this.env["@"] = args.join(" ");
    this.env["#"] = String(args.length);

    this.callDepth++;

    try {
      const result = await visitCommand(this, func.body);
      return result;
    } finally {
      this.callDepth--;

      // Restore positional parameters
      for (const [key, value] of Object.entries(savedParams)) {
        if (value) {
          this.env[key] = value;
        } else {
          delete this.env[key];
        }
      }
    }
  }

  private resolvePath(path: string): string {
    if (path.startsWith("/")) {
      return path;
    }
    if (path.startsWith("~")) {
      const home = this.env.HOME || "/home/user";
      return home + path.slice(1);
    }
    return `${this.cwd}/${path}`.replace(/\/+/g, "/");
  }

  private matchGlobPattern(str: string, pattern: string): boolean {
    if (pattern === "*") return true;

    // Convert glob pattern to regex
    let regex = "^";
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === "*") {
        regex += ".*";
      } else if (char === "?") {
        regex += ".";
      } else if (char === "[") {
        const closeIdx = pattern.indexOf("]", i);
        if (closeIdx !== -1) {
          regex += pattern.slice(i, closeIdx + 1);
          i = closeIdx;
        } else {
          regex += "\\[";
        }
      } else if (/[.+^${}()|\\]/.test(char)) {
        regex += `\\${char}`;
      } else {
        regex += char;
      }
    }
    regex += "$";

    try {
      return new RegExp(regex).test(str);
    } catch {
      return str === pattern;
    }
  }

  private async expandGlob(_pattern: string): Promise<string[]> {
    // Simplified glob expansion - would need full implementation
    // For now, just return the pattern if no matches
    return [];
  }
}
