import { createLazyCommands } from "./commands/registry.js";
import { type IFileSystem, VirtualFs } from "./fs.js";
import type { InitialFiles } from "./fs-interface.js";
import {
  type BuiltinContext,
  evaluateTopLevelTest,
  executeCaseStatement,
  executeForLoop,
  executeIfStatement,
  executeUntilLoop,
  executeWhileLoop,
  executeWithHereDoc,
  expandVariablesAsync,
  type HereDocContext,
  handleCd,
  handleExit,
  handleExport,
  handleLocal,
  handleTestExpression,
  handleUnset,
  handleVariableAssignment,
  type InterpreterContext,
} from "./interpreter/index.js";
import {
  GlobExpander,
  type Pipeline,
  type Redirection,
  ShellParser,
} from "./shell/index.js";
import type {
  Command,
  CommandContext,
  CommandRegistry,
  ExecResult,
} from "./types.js";

// Default protection limits
const DEFAULT_MAX_CALL_DEPTH = 100;
const DEFAULT_MAX_COMMAND_COUNT = 10000;
const DEFAULT_MAX_LOOP_ITERATIONS = 10000;

export interface BashEnvOptions {
  /**
   * Initial files to populate the virtual filesystem.
   * Can be simple content strings/Uint8Arrays, or FileInit objects with metadata.
   * Only used when fs is not provided.
   * @example
   * // Simple content
   * files: { "/file.txt": "content" }
   * // With metadata
   * files: { "/file.txt": { content: "data", mode: 0o755, mtime: new Date("2024-01-01") } }
   */
  files?: InitialFiles;
  /**
   * Environment variables
   */
  env?: Record<string, string>;
  /**
   * Initial working directory
   */
  cwd?: string;
  /**
   * Custom filesystem implementation.
   * If provided, 'files' option is ignored.
   * Defaults to VirtualFs if not provided.
   */
  fs?: IFileSystem;
  /**
   * Maximum function call/recursion depth. Default: 100
   */
  maxCallDepth?: number;
  /**
   * Maximum number of commands per exec call. Default: 10000
   */
  maxCommandCount?: number;
  /**
   * Maximum iterations per loop (for/while/until). Default: 10000
   */
  maxLoopIterations?: number;
}

export class BashEnv {
  readonly fs: IFileSystem;
  private cwd: string;
  private env: Record<string, string>;
  private commands: CommandRegistry = new Map();
  private functions: Map<string, string> = new Map();
  private previousDir: string = "/home/user";
  private parser: ShellParser;
  private useDefaultLayout: boolean = false;
  // Stack of local variable scopes for function calls
  private localScopes: Map<string, string | undefined>[] = [];
  // Protection against endless execution
  private callDepth: number = 0;
  private commandCount: number = 0;
  // Configurable limits
  private maxCallDepth: number;
  private maxCommandCount: number;
  private maxLoopIterations: number;

  constructor(options: BashEnvOptions = {}) {
    // Use provided filesystem or create a new VirtualFs
    const fs = options.fs ?? new VirtualFs(options.files);
    this.fs = fs;

    // Use /home/user as default cwd only if no cwd specified
    this.useDefaultLayout = !options.cwd && !options.files;
    this.cwd = options.cwd || (this.useDefaultLayout ? "/home/user" : "/");
    this.env = {
      HOME: this.useDefaultLayout ? "/home/user" : "/",
      PATH: "/bin:/usr/bin",
      ...options.env,
    };
    this.parser = new ShellParser(this.env);

    // Initialize protection limits
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

    // Ensure cwd exists in the virtual filesystem
    if (this.cwd !== "/" && fs instanceof VirtualFs) {
      try {
        fs.mkdirSync(this.cwd, { recursive: true });
      } catch {
        // Ignore errors - the directory may already exist
      }
    }

    // Register built-in commands with lazy loading
    // Commands are registered eagerly but implementations load on first use
    for (const cmd of createLazyCommands()) {
      this.registerCommand(cmd);
    }
  }

  registerCommand(command: Command): void {
    this.commands.set(command.name, command);
    // Create executable stub in /bin for VirtualFs (only for default layout)
    if (this.fs instanceof VirtualFs && this.useDefaultLayout) {
      try {
        // Create a stub executable file in /bin
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
    // Reset command count for top-level calls
    if (this.callDepth === 0) {
      this.commandCount = 0;
    }

    // Protection against too many commands
    this.commandCount++;
    if (this.commandCount > this.maxCommandCount) {
      return {
        stdout: "",
        stderr: `bash: maximum command count (${this.maxCommandCount}) exceeded (possible infinite loop). Increase with maxCommandCount option.\n`,
        exitCode: 1,
      };
    }

    // Handle empty command
    if (!commandLine.trim()) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // Normalize: strip leading whitespace from each line
    // This handles indented multi-line scripts like template literals
    const normalizedLines = commandLine
      .split("\n")
      .map((line) => line.trimStart());
    const normalized = normalizedLines.join("\n");

    // Split into statements and execute sequentially
    // This allows control structures to appear in multi-line scripts
    const statements = this.splitIntoStatements(normalized);
    if (statements.length > 1) {
      let stdout = "";
      let stderr = "";
      let exitCode = 0;
      for (const statement of statements) {
        const result = await this.exec(statement);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }
      return { stdout, stderr, exitCode };
    }

    // Check for if statements
    const trimmed = normalized.trim();
    if (
      trimmed.startsWith("if ") ||
      trimmed.startsWith("if;") ||
      trimmed === "if"
    ) {
      return executeIfStatement(trimmed, this.getInterpreterContext());
    }

    // Check for for loops
    if (trimmed.startsWith("for ")) {
      return executeForLoop(trimmed, this.getInterpreterContext());
    }

    // Check for while loops
    if (trimmed.startsWith("while ")) {
      return executeWhileLoop(trimmed, this.getInterpreterContext());
    }

    // Check for until loops
    if (trimmed.startsWith("until ")) {
      return executeUntilLoop(trimmed, this.getInterpreterContext());
    }

    // Check for case statements
    if (trimmed.startsWith("case ")) {
      return executeCaseStatement(trimmed, this.getInterpreterContext());
    }

    // Check for [[ ]] test expressions at top level
    if (trimmed.startsWith("[[ ")) {
      return evaluateTopLevelTest(trimmed, this.getInterpreterContext());
    }

    // Check for function definitions BEFORE here documents
    // (function bodies may contain here documents)
    const funcDef = this.extractFunctionDefinition(trimmed);
    if (funcDef) {
      this.functions.set(funcDef.name, funcDef.body);
      // If there's code after the function definition, execute it
      if (funcDef.rest) {
        return this.exec(funcDef.rest);
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // Check for here documents
    if (trimmed.includes("<<")) {
      // Find where << appears (not inside quotes)
      const hereDocIndex = this.findHereDocIndex(trimmed);
      if (hereDocIndex !== -1) {
        // Check if there are commands before the here document (separated by semicolon)
        const beforeHereDoc = trimmed.slice(0, hereDocIndex);
        const lastSemicolon = beforeHereDoc.lastIndexOf(";");
        if (lastSemicolon !== -1) {
          // Execute commands before the here doc first
          const preCommands = trimmed.slice(0, lastSemicolon).trim();
          const hereDocPart = trimmed.slice(lastSemicolon + 1).trim();
          const preResult = await this.exec(preCommands);
          const hereDocResult = await executeWithHereDoc(
            hereDocPart,
            this.getHereDocContext(),
          );
          return {
            stdout: preResult.stdout + hereDocResult.stdout,
            stderr: preResult.stderr + hereDocResult.stderr,
            exitCode: hereDocResult.exitCode,
          };
        }
        return executeWithHereDoc(trimmed, this.getHereDocContext());
      }
    }

    // Update parser with current environment
    this.parser.setEnv(this.env);

    // Parse the command line into pipelines
    const pipelines = this.parser.parse(commandLine);

    let stdin = "";
    let lastResult: ExecResult = { stdout: "", stderr: "", exitCode: 0 };

    // Execute each pipeline
    for (const pipeline of pipelines) {
      const result = await this.executePipeline(pipeline, stdin);
      stdin = result.stdout;
      lastResult = result;
    }

    return lastResult;
  }

  /**
   * Get interpreter context for control flow and other modules
   */
  private getInterpreterContext(): InterpreterContext {
    return {
      fs: this.fs,
      cwd: this.cwd,
      env: this.env,
      exec: this.exec.bind(this),
      expandVariables: (str: string) =>
        expandVariablesAsync(str, {
          env: this.env,
          exec: this.exec.bind(this),
        }),
      resolvePath: this.resolvePath.bind(this),
      maxLoopIterations: this.maxLoopIterations,
    };
  }

  /**
   * Get here document context
   */
  private getHereDocContext(): HereDocContext {
    return {
      ...this.getInterpreterContext(),
      parse: (cmd: string) => {
        this.parser.setEnv(this.env);
        return this.parser.parse(cmd);
      },
      executePipeline: this.executePipeline.bind(this),
    };
  }

  /**
   * Get builtin command context
   */
  private getBuiltinContext(): BuiltinContext {
    return {
      fs: this.fs,
      cwd: this.cwd,
      setCwd: (cwd: string) => {
        this.cwd = cwd;
      },
      previousDir: this.previousDir,
      setPreviousDir: (dir: string) => {
        this.previousDir = dir;
      },
      env: this.env,
      localScopes: this.localScopes,
      resolvePath: this.resolvePath.bind(this),
    };
  }

  /**
   * Split input into separate statements, keeping control structures intact
   * Handles: case...esac, if...fi, for/while/until...done, functions, here documents
   */
  private splitIntoStatements(input: string): string[] {
    const statements: string[] = [];
    const lines = input.split("\n");
    let current: string[] = [];
    let depth = 0;
    let inControlStructure: "case" | "if" | "loop" | "function" | null = null;
    let hereDocDelimiter: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        if (current.length > 0) {
          current.push("");
        }
        continue;
      }

      // If we're inside a here document, check for the end delimiter
      if (hereDocDelimiter) {
        current.push(line);
        if (line === hereDocDelimiter) {
          // End of here document - save it
          statements.push(current.join("\n"));
          current = [];
          hereDocDelimiter = null;
        }
        continue;
      }

      // Check for here document start (but only if not in a control structure)
      const hereDocMatch = line.match(/<<(-?)(['"]?)(\w+)\2/);
      if (hereDocMatch && depth === 0) {
        // If there are pending lines that don't contain << , flush them first
        if (current.length > 0) {
          const lastLine = current[current.length - 1];
          if (!lastLine.includes("<<")) {
            // Flush all previous lines as a statement
            statements.push(current.join("\n"));
            current = [];
          }
        }
        hereDocDelimiter = hereDocMatch[3];
        current.push(line);
        continue;
      }

      // Check for start of control structures
      let justStartedStructure = false;
      if (depth === 0) {
        if (line.startsWith("case ") && line.includes(" in")) {
          inControlStructure = "case";
          depth = 1;
          justStartedStructure = true;
        } else if (
          line.startsWith("if ") ||
          line.startsWith("if;") ||
          line === "if"
        ) {
          inControlStructure = "if";
          depth = 1;
          justStartedStructure = true;
        } else if (
          line.startsWith("for ") ||
          line.startsWith("while ") ||
          line.startsWith("until ")
        ) {
          inControlStructure = "loop";
          depth = 1;
          justStartedStructure = true;
        } else if (line.match(/^(function\s+\w+|\w+\s*\(\s*\))\s*\{/)) {
          inControlStructure = "function";
          depth = 1;
          justStartedStructure = true;
        }

        // If we started a control structure, flush any pending current lines first
        if (inControlStructure && current.length > 0) {
          statements.push(current.join("\n"));
          current = [];
        }
      }

      // Track nested structures (but not for the line that just started one)
      if (depth > 0 && !justStartedStructure) {
        // Check for nested structures
        if (line.startsWith("case ") && line.includes(" in")) {
          depth++;
        } else if (
          line.startsWith("if ") ||
          line.startsWith("if;") ||
          line === "if"
        ) {
          depth++;
        } else if (
          line.startsWith("for ") ||
          line.startsWith("while ") ||
          line.startsWith("until ")
        ) {
          depth++;
        }

        // Check for end markers
        if (
          line === "esac" ||
          line.startsWith("esac;") ||
          line.startsWith("esac ") ||
          line.match(/^esac(\s|;|$)/)
        ) {
          depth--;
        } else if (
          line === "fi" ||
          line.startsWith("fi;") ||
          line.startsWith("fi ") ||
          line.match(/^fi(\s|;|$)/)
        ) {
          depth--;
        } else if (
          line === "done" ||
          line.startsWith("done;") ||
          line.startsWith("done ") ||
          line.match(/^done(\s|;|$)/)
        ) {
          depth--;
        } else if (line === "}" || line.startsWith("};")) {
          if (inControlStructure === "function") {
            depth--;
          }
        }
      }

      current.push(line);

      // If we've finished a control structure, save it
      if (depth === 0 && inControlStructure) {
        statements.push(current.join("\n"));
        current = [];
        inControlStructure = null;
      }
    }

    // Add any remaining lines
    if (current.length > 0) {
      const remaining = current.join("\n").trim();
      if (remaining) {
        statements.push(remaining);
      }
    }

    return statements;
  }

  /**
   * Find the index of << in the string, ignoring quoted occurrences
   */
  private findHereDocIndex(input: string): number {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    for (let i = 0; i < input.length - 1; i++) {
      const char = input[i];
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      } else if (
        char === "<" &&
        input[i + 1] === "<" &&
        !inSingleQuote &&
        !inDoubleQuote
      ) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Parse and extract function definitions from input
   * Returns the function (if found) and any remaining code after it
   * Syntax: function name { commands; } or name() { commands; }
   */
  private extractFunctionDefinition(
    input: string,
  ): { name: string; body: string; rest: string } | null {
    // Match: function name { or name() {
    const funcStart = input.match(
      /^(function\s+([a-zA-Z_][a-zA-Z0-9_]*)|([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*\))\s*\{/,
    );
    if (!funcStart) {
      return null;
    }

    const name = funcStart[2] || funcStart[3];
    const braceStart = input.indexOf("{", funcStart[0].length - 1);

    // Find the matching closing brace
    let depth = 1;
    let i = braceStart + 1;
    while (i < input.length && depth > 0) {
      if (input[i] === "{") {
        depth++;
      } else if (input[i] === "}") {
        depth--;
      } else if (input[i] === "'" || input[i] === '"') {
        // Skip quoted strings
        const quote = input[i];
        i++;
        while (i < input.length && input[i] !== quote) {
          if (input[i] === "\\" && i + 1 < input.length) {
            i += 2;
          } else {
            i++;
          }
        }
      }
      i++;
    }

    if (depth !== 0) {
      return null; // Unbalanced braces
    }

    const body = input.slice(braceStart + 1, i - 1).trim();
    const rest = input.slice(i).trim();

    return { name, body, rest };
  }

  private async executePipeline(
    pipeline: Pipeline,
    initialStdin: string,
  ): Promise<ExecResult> {
    let stdin = initialStdin;
    let lastResult: ExecResult = { stdout: "", stderr: "", exitCode: 0 };
    let accumulatedStdout = "";
    let accumulatedStderr = "";

    // Track negation for current pipeline segment
    let currentNegationCount = 0;

    for (let i = 0; i < pipeline.commands.length; i++) {
      const { parsed, operator, negationCount } = pipeline.commands[i];
      const nextCommand = pipeline.commands[i + 1];
      const nextOperator = nextCommand?.operator || "";

      // At the start of a new pipeline segment, capture the negation count
      if (operator !== "" || i === 0) {
        // This is the first command of a pipeline segment
        currentNegationCount = negationCount || 0;
      }

      // Check if we should run based on previous result (for &&, ||, ;)
      // Note: lastResult here is from the previous pipeline segment (already negated if needed)
      if (operator === "&&" && lastResult.exitCode !== 0) continue;
      if (operator === "||" && lastResult.exitCode === 0) continue;
      // For ';', always run

      // Determine if previous command was a pipe (empty operator means pipe)
      const isPipedInput = operator === "";
      // Determine if next command is a pipe
      const isPipedOutput = nextOperator === "";

      // Execute the command
      const commandStdin = isPipedInput && i > 0 ? stdin : initialStdin;
      let result = await this.executeCommand(
        parsed.command,
        parsed.args,
        parsed.quotedArgs,
        parsed.singleQuotedArgs,
        parsed.redirections,
        commandStdin,
      );

      // Handle stdout based on whether this is piped to next command
      if (isPipedOutput && i < pipeline.commands.length - 1) {
        // This command's stdout goes to next command's stdin
        stdin = result.stdout;
      } else {
        // End of pipeline segment - apply negation if odd count
        if (currentNegationCount % 2 === 1) {
          result = {
            ...result,
            exitCode: result.exitCode === 0 ? 1 : 0,
          };
        }
        // Accumulate stdout for final output
        accumulatedStdout += result.stdout;
      }

      // Always accumulate stderr
      accumulatedStderr += result.stderr;

      // Update last result for operator checks
      lastResult = result;
    }

    return {
      stdout: accumulatedStdout,
      stderr: accumulatedStderr,
      exitCode: lastResult.exitCode,
    };
  }

  private async executeCommand(
    command: string,
    args: string[],
    quotedArgs: boolean[],
    singleQuotedArgs: boolean[],
    redirections: Redirection[],
    stdin: string,
  ): Promise<ExecResult> {
    if (!command) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // Handle stdin redirection (<) - must be processed BEFORE command execution
    for (const redir of redirections) {
      if (redir.type === "stdin" && redir.target) {
        try {
          const filePath = this.resolvePath(redir.target);
          stdin = await this.fs.readFile(filePath);
        } catch {
          return {
            stdout: "",
            stderr: `bash: ${redir.target}: No such file or directory\n`,
            exitCode: 1,
          };
        }
      }
    }

    // Check for compound commands (if statements collected by parser)
    if (command.startsWith("if ") || command.startsWith("if;")) {
      return executeIfStatement(command, this.getInterpreterContext());
    }

    // Expand variables in command and args at execution time
    // Use async expansion to support command substitution $(...)
    // Note: quotedArgs flag is used for glob expansion only
    // singleQuotedArgs flag determines variable expansion (single-quoted = literal)
    const expandedCommand = await expandVariablesAsync(command, {
      env: this.env,
      exec: this.exec.bind(this),
    });
    const varExpandedArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (singleQuotedArgs[i]) {
        // Single-quoted args are literal - no expansion
        varExpandedArgs.push(args[i]);
      } else {
        varExpandedArgs.push(
          await expandVariablesAsync(args[i], {
            env: this.env,
            exec: this.exec.bind(this),
          }),
        );
      }
    }

    // Create glob expander for this execution
    const globExpander = new GlobExpander(this.fs, this.cwd);

    // Expand glob patterns in arguments (skip quoted args)
    const expandedArgs = await globExpander.expandArgs(
      varExpandedArgs,
      quotedArgs,
    );

    // Handle built-in commands that modify shell state
    if (expandedCommand === "cd") {
      return handleCd(expandedArgs, this.getBuiltinContext());
    }
    if (expandedCommand === "export") {
      return handleExport(expandedArgs, this.env);
    }
    if (expandedCommand === "unset") {
      return handleUnset(expandedArgs, this.env);
    }
    if (expandedCommand === "exit") {
      return handleExit(expandedArgs);
    }
    if (expandedCommand === "local") {
      return handleLocal(expandedArgs, this.getBuiltinContext());
    }

    // Handle [[ ]] test expressions
    if (expandedCommand === "[[") {
      return await handleTestExpression(
        expandedArgs,
        this.getInterpreterContext(),
      );
    }

    // Handle variable assignment: VAR=value (no args, command contains =)
    if (expandedArgs.length === 0) {
      const assignResult = handleVariableAssignment(expandedCommand, this.env);
      if (assignResult) return assignResult;
    }

    // Check for user-defined functions first
    const funcBody = this.functions.get(expandedCommand);
    if (funcBody) {
      return this.executeFunction(expandedCommand, funcBody, expandedArgs);
    }

    // Look up command - handle paths like /bin/ls
    let commandName = expandedCommand;
    if (expandedCommand.includes("/")) {
      // Extract the command name from the path
      commandName = expandedCommand.split("/").pop() || expandedCommand;
    }
    const cmd = this.commands.get(commandName);
    if (!cmd) {
      return {
        stdout: "",
        stderr: `bash: ${expandedCommand}: command not found\n`,
        exitCode: 127,
      };
    }

    // Execute the command
    const ctx: CommandContext = {
      fs: this.fs,
      cwd: this.cwd,
      env: this.env,
      stdin,
      exec: this.exec.bind(this),
    };

    let result: ExecResult;
    try {
      result = await cmd.execute(expandedArgs, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = {
        stdout: "",
        stderr: `${command}: ${message}\n`,
        exitCode: 1,
      };
    }

    // Apply redirections
    result = await this.applyRedirections(result, redirections);

    return result;
  }

  /**
   * Execute a user-defined function
   */
  private async executeFunction(
    name: string,
    body: string,
    args: string[],
  ): Promise<ExecResult> {
    // Protection against infinite recursion
    this.callDepth++;
    if (this.callDepth > this.maxCallDepth) {
      this.callDepth--;
      return {
        stdout: "",
        stderr: `bash: ${name}: maximum recursion depth (${this.maxCallDepth}) exceeded. Increase with maxCallDepth option.\n`,
        exitCode: 1,
      };
    }

    // Push a new local scope for this function call
    this.localScopes.push(new Map());

    // Set positional parameters ($1, $2, etc.)
    for (let i = 0; i < args.length; i++) {
      this.env[String(i + 1)] = args[i];
    }
    this.env["@"] = args.join(" ");
    this.env["#"] = String(args.length);

    // Execute the function body
    const result = await this.exec(body);

    // Decrement call depth
    this.callDepth--;

    // Pop the local scope and restore shadowed variables
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

    // Clean up positional parameters
    for (let i = 1; i <= args.length; i++) {
      delete this.env[String(i)];
    }
    delete this.env["@"];
    delete this.env["#"];

    return result;
  }

  private async applyRedirections(
    result: ExecResult,
    redirections: Redirection[],
  ): Promise<ExecResult> {
    let { stdout, stderr, exitCode } = result;

    for (const redir of redirections) {
      switch (redir.type) {
        case "stdout":
          if (redir.target) {
            const filePath = this.resolvePath(redir.target);
            if (redir.append) {
              await this.fs.appendFile(filePath, stdout);
            } else {
              await this.fs.writeFile(filePath, stdout);
            }
            stdout = "";
          }
          break;

        case "stderr":
          if (redir.target === "/dev/null") {
            stderr = "";
          } else if (redir.target) {
            const filePath = this.resolvePath(redir.target);
            if (redir.append) {
              await this.fs.appendFile(filePath, stderr);
            } else {
              await this.fs.writeFile(filePath, stderr);
            }
            stderr = "";
          }
          break;

        case "stderr-to-stdout":
          stdout += stderr;
          stderr = "";
          break;
      }
    }

    return { stdout, stderr, exitCode };
  }

  private resolvePath(path: string): string {
    return this.fs.resolvePath(this.cwd, path);
  }

  // Public API for file access
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
