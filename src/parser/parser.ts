/**
 * Recursive Descent Parser for Bash Scripts
 *
 * This parser consumes tokens from the lexer and produces an AST.
 * It follows the bash grammar structure for correctness.
 *
 * Grammar (simplified):
 *   script       ::= statement*
 *   statement    ::= pipeline ((&&|'||') pipeline)*  [&]
 *   pipeline     ::= [!] command (| command)*
 *   command      ::= simple_command | compound_command | function_def
 *   simple_cmd   ::= (assignment)* [word] (word)* (redirection)*
 *   compound_cmd ::= if | for | while | until | case | subshell | group | (( | [[
 */

import {
  type ArithAssignmentOperator,
  type ArithExpr,
  type ArithmeticCommandNode,
  type ArithmeticExpansionPart,
  type ArithmeticExpressionNode,
  AST,
  type AssignmentNode,
  type CaseItemNode,
  type CaseNode,
  type CommandNode,
  type CommandSubstitutionPart,
  type CompoundCommandNode,
  type CondBinaryOperator,
  type ConditionalCommandNode,
  type ConditionalExpressionNode,
  type CondUnaryOperator,
  type CStyleForNode,
  type ForNode,
  type FunctionDefNode,
  type GroupNode,
  type IfClause,
  type IfNode,
  type ParameterExpansionPart,
  type ParameterOperation,
  type PipelineNode,
  type RedirectionNode,
  type RedirectionOperator,
  type ScriptNode,
  type SimpleCommandNode,
  type StatementNode,
  type SubshellNode,
  type UntilNode,
  type WhileNode,
  type WordNode,
  type WordPart,
} from "../ast/types.js";
import { Lexer, type Token, TokenType } from "./lexer.js";

// Pre-computed Sets for fast redirection token lookup (avoids array allocation per call)
const REDIRECTION_TOKENS = new Set([
  TokenType.LESS,
  TokenType.GREAT,
  TokenType.DLESS,
  TokenType.DGREAT,
  TokenType.LESSAND,
  TokenType.GREATAND,
  TokenType.LESSGREAT,
  TokenType.DLESSDASH,
  TokenType.CLOBBER,
  TokenType.TLESS,
  TokenType.AND_GREAT,
  TokenType.AND_DGREAT,
]);

const REDIRECTION_AFTER_NUMBER = new Set([
  TokenType.LESS,
  TokenType.GREAT,
  TokenType.DLESS,
  TokenType.DGREAT,
  TokenType.LESSAND,
  TokenType.GREATAND,
  TokenType.LESSGREAT,
  TokenType.DLESSDASH,
  TokenType.CLOBBER,
  TokenType.TLESS,
]);

export interface ParseError {
  message: string;
  line: number;
  column: number;
  token?: Token;
}

export class ParseException extends Error {
  constructor(
    message: string,
    public line: number,
    public column: number,
    public token: Token | undefined = undefined,
  ) {
    super(`Parse error at ${line}:${column}: ${message}`);
    this.name = "ParseException";
  }
}

/**
 * Parser class - transforms tokens into AST
 */
export class Parser {
  private tokens: Token[] = [];
  private pos = 0;
  private pendingHeredocs: {
    redirect: RedirectionNode;
    delimiter: string;
    stripTabs: boolean;
    quoted: boolean;
  }[] = [];

  /**
   * Parse a bash script string
   */
  parse(input: string): ScriptNode {
    const lexer = new Lexer(input);
    this.tokens = lexer.tokenize();
    this.pos = 0;
    this.pendingHeredocs = [];
    return this.parseScript();
  }

  /**
   * Parse from pre-tokenized input
   */
  parseTokens(tokens: Token[]): ScriptNode {
    this.tokens = tokens;
    this.pos = 0;
    this.pendingHeredocs = [];
    return this.parseScript();
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private current(): Token {
    return this.tokens[this.pos] || this.tokens[this.tokens.length - 1];
  }

  private peek(offset = 0): Token {
    return (
      this.tokens[this.pos + offset] || this.tokens[this.tokens.length - 1]
    );
  }

  private advance(): Token {
    const token = this.current();
    if (this.pos < this.tokens.length - 1) {
      this.pos++;
    }
    return token;
  }

  /**
   * Check if current token matches any of the given types.
   * Optimized to avoid array allocation for common cases (1-4 args).
   */
  private check(
    t1: TokenType,
    t2?: TokenType,
    t3?: TokenType,
    t4?: TokenType,
    ...rest: TokenType[]
  ): boolean {
    const type = this.tokens[this.pos]?.type;
    if (type === t1) return true;
    if (t2 !== undefined && type === t2) return true;
    if (t3 !== undefined && type === t3) return true;
    if (t4 !== undefined && type === t4) return true;
    if (rest.length > 0) return rest.includes(type);
    return false;
  }

  private match(...types: TokenType[]): boolean {
    if ((this.check as (...t: TokenType[]) => boolean)(...types)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType, message?: string): Token {
    if (this.check(type)) {
      return this.advance();
    }
    const token = this.current();
    throw new ParseException(
      message || `Expected ${type}, got ${token.type}`,
      token.line,
      token.column,
      token,
    );
  }

  private error(message: string): never {
    const token = this.current();
    throw new ParseException(message, token.line, token.column, token);
  }

  private skipNewlines(): void {
    while (this.check(TokenType.NEWLINE, TokenType.COMMENT)) {
      if (this.check(TokenType.NEWLINE)) {
        this.advance();
        // Process pending here-documents after newline
        this.processHeredocs();
      } else {
        this.advance();
      }
    }
  }

  private skipSeparators(includeCaseTerminators = true): void {
    while (true) {
      if (this.check(TokenType.NEWLINE)) {
        this.advance();
        this.processHeredocs();
        continue;
      }
      if (this.check(TokenType.SEMICOLON, TokenType.COMMENT)) {
        this.advance();
        continue;
      }
      // Only skip case terminators (;;, ;&, ;;&) when explicitly allowed
      // This prevents breaking case statement parsing
      if (
        includeCaseTerminators &&
        this.check(TokenType.DSEMI, TokenType.SEMI_AND, TokenType.SEMI_SEMI_AND)
      ) {
        this.advance();
        continue;
      }
      break;
    }
  }

  private processHeredocs(): void {
    // Process pending here-documents
    for (const heredoc of this.pendingHeredocs) {
      if (this.check(TokenType.HEREDOC_CONTENT)) {
        const content = this.advance();
        let contentWord: WordNode;

        if (heredoc.quoted) {
          // Quoted delimiter - no expansion, store as literal
          contentWord = AST.word([AST.literal(content.value)]);
        } else {
          // Unquoted delimiter - parse for variable expansions
          contentWord = this.parseWordFromString(content.value, false, false);
        }

        heredoc.redirect.target = AST.hereDoc(
          heredoc.delimiter,
          contentWord,
          heredoc.stripTabs,
          heredoc.quoted,
        );
      }
    }
    this.pendingHeredocs = [];
  }

  private isStatementEnd(): boolean {
    return this.check(
      TokenType.EOF,
      TokenType.NEWLINE,
      TokenType.SEMICOLON,
      TokenType.AMP,
      TokenType.AND_AND,
      TokenType.OR_OR,
      TokenType.RPAREN,
      TokenType.RBRACE,
      TokenType.DSEMI,
      TokenType.SEMI_AND,
      TokenType.SEMI_SEMI_AND,
    );
  }

  private isCommandStart(): boolean {
    const t = this.current().type;
    return (
      t === TokenType.WORD ||
      t === TokenType.NAME ||
      t === TokenType.NUMBER ||
      t === TokenType.ASSIGNMENT_WORD ||
      t === TokenType.IF ||
      t === TokenType.FOR ||
      t === TokenType.WHILE ||
      t === TokenType.UNTIL ||
      t === TokenType.CASE ||
      t === TokenType.LPAREN ||
      t === TokenType.LBRACE ||
      t === TokenType.DPAREN_START ||
      t === TokenType.DBRACK_START ||
      t === TokenType.FUNCTION ||
      t === TokenType.BANG ||
      // Reserved words outside their context should be treated as commands
      t === TokenType.ELSE ||
      t === TokenType.ELIF ||
      t === TokenType.FI ||
      t === TokenType.THEN ||
      t === TokenType.DO ||
      t === TokenType.DONE ||
      t === TokenType.ESAC ||
      t === TokenType.IN
    );
  }

  // ===========================================================================
  // SCRIPT PARSING
  // ===========================================================================

  private parseScript(): ScriptNode {
    const statements: StatementNode[] = [];
    const maxIterations = 10000;
    let iterations = 0;

    this.skipNewlines();

    while (!this.check(TokenType.EOF)) {
      iterations++;
      if (iterations > maxIterations) {
        this.error(`Parser stuck: too many iterations (>${maxIterations})`);
      }

      const posBefore = this.pos;
      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      }
      this.skipSeparators();

      // Safety: if we didn't advance, force advance to prevent infinite loop
      if (this.pos === posBefore && !this.check(TokenType.EOF)) {
        this.advance();
      }
    }

    return AST.script(statements);
  }

  // ===========================================================================
  // STATEMENT PARSING
  // ===========================================================================

  private parseStatement(): StatementNode | null {
    this.skipNewlines();

    if (!this.isCommandStart()) {
      return null;
    }

    const pipelines: PipelineNode[] = [];
    const operators: ("&&" | "||" | ";")[] = [];
    let background = false;

    // Parse first pipeline
    const firstPipeline = this.parsePipeline();
    pipelines.push(firstPipeline);

    // Parse additional pipelines connected by && or ||
    while (this.check(TokenType.AND_AND, TokenType.OR_OR)) {
      const op = this.advance();
      operators.push(op.type === TokenType.AND_AND ? "&&" : "||");
      this.skipNewlines();
      const nextPipeline = this.parsePipeline();
      pipelines.push(nextPipeline);
    }

    // Check for background execution
    if (this.check(TokenType.AMP)) {
      this.advance();
      background = true;
    }

    return AST.statement(pipelines, operators, background);
  }

  // ===========================================================================
  // PIPELINE PARSING
  // ===========================================================================

  private parsePipeline(): PipelineNode {
    let negationCount = 0;

    // Check for ! (negation) - multiple ! tokens can appear
    // e.g., "! ! true" means double negation (cancels out)
    while (this.check(TokenType.BANG)) {
      this.advance();
      negationCount++;
    }
    const negated = negationCount % 2 === 1;

    const commands: CommandNode[] = [];

    // Parse first command
    const firstCmd = this.parseCommand();
    commands.push(firstCmd);

    // Parse additional commands in pipeline
    while (this.check(TokenType.PIPE, TokenType.PIPE_AMP)) {
      const pipeToken = this.advance();
      this.skipNewlines();

      // |& redirects stderr to stdin of next command
      // We'll handle this by adding implicit redirection
      const nextCmd = this.parseCommand();

      if (
        pipeToken.type === TokenType.PIPE_AMP &&
        nextCmd.type === "SimpleCommand"
      ) {
        // Add implicit 2>&1 redirection
        nextCmd.redirections.unshift(
          AST.redirection(">&", AST.word([AST.literal("1")]), 2),
        );
      }

      commands.push(nextCmd);
    }

    return AST.pipeline(commands, negated);
  }

  // ===========================================================================
  // COMMAND PARSING
  // ===========================================================================

  private parseCommand(): CommandNode {
    // Check for compound commands
    if (this.check(TokenType.IF)) {
      return this.parseIf();
    }
    if (this.check(TokenType.FOR)) {
      return this.parseFor();
    }
    if (this.check(TokenType.WHILE)) {
      return this.parseWhile();
    }
    if (this.check(TokenType.UNTIL)) {
      return this.parseUntil();
    }
    if (this.check(TokenType.CASE)) {
      return this.parseCase();
    }
    if (this.check(TokenType.LPAREN)) {
      return this.parseSubshellOrArithmeticFor();
    }
    if (this.check(TokenType.LBRACE)) {
      return this.parseGroup();
    }
    if (this.check(TokenType.DPAREN_START)) {
      return this.parseArithmeticCommand();
    }
    if (this.check(TokenType.DBRACK_START)) {
      return this.parseConditionalCommand();
    }
    if (this.check(TokenType.FUNCTION)) {
      return this.parseFunctionDef();
    }

    // Check for function definition: name () { ... }
    if (
      this.check(TokenType.NAME, TokenType.WORD) &&
      this.peek(1).type === TokenType.LPAREN &&
      this.peek(2).type === TokenType.RPAREN
    ) {
      return this.parseFunctionDef();
    }

    // Simple command
    return this.parseSimpleCommand();
  }

  // ===========================================================================
  // SIMPLE COMMAND PARSING
  // ===========================================================================

  private parseSimpleCommand(): SimpleCommandNode {
    const assignments: AssignmentNode[] = [];
    let name: WordNode | null = null;
    const args: WordNode[] = [];
    const redirections: RedirectionNode[] = [];

    // Parse prefix assignments
    while (this.check(TokenType.ASSIGNMENT_WORD)) {
      assignments.push(this.parseAssignment());
    }

    // Parse redirections that may come before command
    while (this.isRedirection()) {
      redirections.push(this.parseRedirection());
    }

    // Parse command name
    if (this.isWord()) {
      name = this.parseWord();
    }

    // Parse arguments and redirections
    while (
      !this.isStatementEnd() &&
      !this.check(TokenType.PIPE, TokenType.PIPE_AMP)
    ) {
      if (this.isRedirection()) {
        redirections.push(this.parseRedirection());
      } else if (this.isWord()) {
        args.push(this.parseWord());
      } else if (this.check(TokenType.ASSIGNMENT_WORD)) {
        // Assignment words after command name are treated as arguments
        // (for local, export, declare, etc.)
        const token = this.advance();
        args.push(this.parseWordFromString(token.value, false, false));
      } else {
        break;
      }
    }

    return AST.simpleCommand(name, args, assignments, redirections);
  }

  // ===========================================================================
  // ASSIGNMENT PARSING
  // ===========================================================================

  private parseAssignment(): AssignmentNode {
    const token = this.expect(TokenType.ASSIGNMENT_WORD);
    const value = token.value;

    // Parse VAR=value or VAR+=value
    const match = value.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\+)?=(.*)?$/s);
    if (!match) {
      this.error(`Invalid assignment: ${value}`);
    }

    const name = match[1];
    const append = match[2] === "+";
    const valueStr = match[3] ?? "";

    // Check for array assignment: VAR=(...)
    if (valueStr === "(" || (valueStr === "" && this.check(TokenType.LPAREN))) {
      if (valueStr !== "(") {
        this.expect(TokenType.LPAREN);
      }
      const elements = this.parseArrayElements();
      this.expect(TokenType.RPAREN);
      return AST.assignment(name, null, append, elements);
    }

    // Regular assignment
    const wordValue = valueStr ? this.parseWordFromString(valueStr) : null;
    return AST.assignment(name, wordValue, append, null);
  }

  private parseArrayElements(): WordNode[] {
    const elements: WordNode[] = [];
    this.skipNewlines();

    while (!this.check(TokenType.RPAREN, TokenType.EOF)) {
      if (this.isWord()) {
        elements.push(this.parseWord());
      }
      this.skipNewlines();
    }

    return elements;
  }

  // ===========================================================================
  // WORD PARSING
  // ===========================================================================

  private isWord(): boolean {
    const t = this.current().type;
    return (
      t === TokenType.WORD ||
      t === TokenType.NAME ||
      t === TokenType.NUMBER ||
      // Reserved words can be used as words in certain contexts
      t === TokenType.ELSE ||
      t === TokenType.ELIF ||
      t === TokenType.FI ||
      t === TokenType.THEN ||
      t === TokenType.DO ||
      t === TokenType.DONE ||
      t === TokenType.ESAC ||
      t === TokenType.IN
    );
  }

  private parseWord(): WordNode {
    const token = this.advance();
    return this.parseWordFromString(
      token.value,
      token.quoted,
      token.singleQuoted,
    );
  }

  private parseWordFromString(
    value: string,
    quoted = false,
    singleQuoted = false,
  ): WordNode {
    const parts = this.parseWordParts(value, quoted, singleQuoted);
    return AST.word(parts);
  }

  /**
   * Parse word parts from a string value
   * This handles variable expansion, command substitution, etc.
   */
  private parseWordParts(
    value: string,
    quoted = false,
    singleQuoted = false,
  ): WordPart[] {
    if (singleQuoted) {
      // Single quotes: no expansion
      return [AST.singleQuoted(value)];
    }

    // When quoted=true, the lexer has already stripped outer quotes and processed escapes
    // We need to wrap the result in a DoubleQuoted node, but still process $ expansions
    if (quoted) {
      const innerParts = this.parseDoubleQuotedContent(value);
      return [AST.doubleQuoted(innerParts)];
    }

    const parts: WordPart[] = [];
    let i = 0;
    let literal = "";

    const flushLiteral = () => {
      if (literal) {
        parts.push(AST.literal(literal));
        literal = "";
      }
    };

    while (i < value.length) {
      const char = value[i];

      // Handle escape sequences
      if (char === "\\" && i + 1 < value.length) {
        literal += value[i + 1];
        i += 2;
        continue;
      }

      // Handle single quotes
      if (char === "'") {
        flushLiteral();
        const closeQuote = value.indexOf("'", i + 1);
        if (closeQuote === -1) {
          literal += value.slice(i);
          break;
        }
        parts.push(AST.singleQuoted(value.slice(i + 1, closeQuote)));
        i = closeQuote + 1;
        continue;
      }

      // Handle double quotes
      if (char === '"') {
        flushLiteral();
        const { part, endIndex } = this.parseDoubleQuoted(value, i + 1);
        parts.push(part);
        i = endIndex + 1;
        continue;
      }

      // Handle $ expansions
      if (char === "$") {
        flushLiteral();
        const { part, endIndex } = this.parseExpansion(value, i);
        if (part) {
          parts.push(part);
        }
        i = endIndex;
        continue;
      }

      // Handle backtick command substitution
      if (char === "`") {
        flushLiteral();
        const { part, endIndex } = this.parseBacktickSubstitution(value, i);
        parts.push(part);
        i = endIndex;
        continue;
      }

      // Handle tilde at start
      if (char === "~" && i === 0) {
        const tildeEnd = this.findTildeEnd(value, i);
        const user = value.slice(i + 1, tildeEnd) || null;
        parts.push({ type: "TildeExpansion", user });
        i = tildeEnd;
        continue;
      }

      // Handle glob patterns
      if (char === "*" || char === "?" || char === "[") {
        flushLiteral();
        const { pattern, endIndex } = this.parseGlobPattern(value, i);
        parts.push({ type: "Glob", pattern });
        i = endIndex;
        continue;
      }

      // Handle brace expansion
      if (char === "{") {
        const braceResult = this.tryParseBraceExpansion(value, i);
        if (braceResult) {
          flushLiteral();
          parts.push(braceResult.part);
          i = braceResult.endIndex;
          continue;
        }
      }

      // Regular character
      literal += char;
      i++;
    }

    flushLiteral();
    return parts;
  }

  /**
   * Parse double-quoted content (for tokens already marked as quoted by lexer)
   * This handles $ expansions but NOT quote characters (they're literal)
   */
  private parseDoubleQuotedContent(value: string): WordPart[] {
    const parts: WordPart[] = [];
    let i = 0;
    let literal = "";

    const flushLiteral = () => {
      if (literal) {
        parts.push(AST.literal(literal));
        literal = "";
      }
    };

    while (i < value.length) {
      const char = value[i];

      // Handle escape sequences - \$ and \` should become $ and `
      // In bash, "\$HOME" outputs "$HOME" (backslash is consumed by the escape)
      if (char === "\\" && i + 1 < value.length) {
        const next = value[i + 1];
        // \$ and \` should become $ and ` (prevents expansion, backslash consumed)
        if (next === "$" || next === "`") {
          literal += next; // Add just the escaped character, not the backslash
          i += 2;
          continue;
        }
        // Other backslash sequences: just add the backslash and continue
        literal += char;
        i++;
        continue;
      }

      // Handle $ expansions
      if (char === "$") {
        flushLiteral();
        const { part, endIndex } = this.parseExpansion(value, i);
        if (part) {
          parts.push(part);
        }
        i = endIndex;
        continue;
      }

      // Handle backtick command substitution
      if (char === "`") {
        flushLiteral();
        const { part, endIndex } = this.parseBacktickSubstitution(value, i);
        parts.push(part);
        i = endIndex;
        continue;
      }

      // All other characters are literal (including " and ' which are already processed)
      literal += char;
      i++;
    }

    flushLiteral();
    return parts;
  }

  private parseDoubleQuoted(
    value: string,
    start: number,
  ): { part: WordPart; endIndex: number } {
    const innerParts: WordPart[] = [];
    let i = start;
    let literal = "";

    const flushLiteral = () => {
      if (literal) {
        innerParts.push(AST.literal(literal));
        literal = "";
      }
    };

    while (i < value.length && value[i] !== '"') {
      const char = value[i];

      // Handle escapes in double quotes
      if (char === "\\" && i + 1 < value.length) {
        const next = value[i + 1];
        if ('"\\$`\n'.includes(next)) {
          literal += next;
          i += 2;
          continue;
        }
        literal += char;
        i++;
        continue;
      }

      // Handle $ expansions
      if (char === "$") {
        flushLiteral();
        const { part, endIndex } = this.parseExpansion(value, i);
        if (part) {
          innerParts.push(part);
        }
        i = endIndex;
        continue;
      }

      // Handle backtick
      if (char === "`") {
        flushLiteral();
        const { part, endIndex } = this.parseBacktickSubstitution(value, i);
        innerParts.push(part);
        i = endIndex;
        continue;
      }

      literal += char;
      i++;
    }

    flushLiteral();

    return {
      part: AST.doubleQuoted(innerParts),
      endIndex: i,
    };
  }

  private parseExpansion(
    value: string,
    start: number,
  ): { part: WordPart | null; endIndex: number } {
    // $ at start
    const i = start + 1;

    if (i >= value.length) {
      return { part: AST.literal("$"), endIndex: i };
    }

    const char = value[i];

    // $((expr)) - arithmetic expansion
    if (char === "(" && value[i + 1] === "(") {
      return this.parseArithmeticExpansion(value, start);
    }

    // $(cmd) - command substitution
    if (char === "(") {
      return this.parseCommandSubstitution(value, start);
    }

    // ${...} - parameter expansion with operators
    if (char === "{") {
      return this.parseParameterExpansion(value, start);
    }

    // $VAR or $1 or $@ etc - simple parameter
    if (/[a-zA-Z_0-9@*#?$!-]/.test(char)) {
      return this.parseSimpleParameter(value, start);
    }

    // Just a literal $
    return { part: AST.literal("$"), endIndex: i };
  }

  private parseSimpleParameter(
    value: string,
    start: number,
  ): { part: ParameterExpansionPart; endIndex: number } {
    let i = start + 1;
    const char = value[i];

    // Special parameters: $@, $*, $#, $?, $$, $!, $-, $0-$9
    if ("@*#?$!-0123456789".includes(char)) {
      return {
        part: AST.parameterExpansion(char),
        endIndex: i + 1,
      };
    }

    // Variable name
    let name = "";
    while (i < value.length && /[a-zA-Z0-9_]/.test(value[i])) {
      name += value[i];
      i++;
    }

    return {
      part: AST.parameterExpansion(name),
      endIndex: i,
    };
  }

  private parseParameterExpansion(
    value: string,
    start: number,
  ): { part: ParameterExpansionPart; endIndex: number } {
    // Skip ${
    let i = start + 2;

    // Handle ${!var} indirection
    let indirection = false;
    if (value[i] === "!") {
      indirection = true;
      i++;
    }

    // Handle ${#var} length
    let lengthOp = false;
    if (value[i] === "#" && !/[}:#%/^,]/.test(value[i + 1] || "}")) {
      lengthOp = true;
      i++;
    }

    // Parse parameter name
    let name = "";
    while (i < value.length && /[a-zA-Z0-9_@*#?$!-]/.test(value[i])) {
      name += value[i];
      i++;
    }

    // Handle array subscript
    if (value[i] === "[") {
      const closeIdx = this.findMatchingBracket(value, i, "[", "]");
      name += value.slice(i, closeIdx + 1);
      i = closeIdx + 1;
    }

    let operation: ParameterOperation | null = null;

    if (indirection) {
      operation = { type: "Indirection" };
    } else if (lengthOp) {
      operation = { type: "Length" };
    }

    // Parse operation
    if (!operation && i < value.length && value[i] !== "}") {
      const opResult = this.parseParameterOperation(value, i, name);
      operation = opResult.operation;
      i = opResult.endIndex;
    }

    // Find closing }
    while (i < value.length && value[i] !== "}") {
      i++;
    }

    return {
      part: AST.parameterExpansion(name, operation),
      endIndex: i + 1,
    };
  }

  private parseParameterOperation(
    value: string,
    start: number,
    _paramName: string,
  ): { operation: ParameterOperation | null; endIndex: number } {
    let i = start;
    const char = value[i];
    const nextChar = value[i + 1] || "";

    // :- := :? :+
    if (char === ":") {
      const op = nextChar;
      const checkEmpty = true;
      i += 2;

      const wordEnd = this.findParameterOperationEnd(value, i);
      const wordStr = value.slice(i, wordEnd);
      const word = AST.word([AST.literal(wordStr)]);

      if (op === "-") {
        return {
          operation: { type: "DefaultValue", word, checkEmpty },
          endIndex: wordEnd,
        };
      }
      if (op === "=") {
        return {
          operation: { type: "AssignDefault", word, checkEmpty },
          endIndex: wordEnd,
        };
      }
      if (op === "?") {
        return {
          operation: { type: "ErrorIfUnset", word, checkEmpty },
          endIndex: wordEnd,
        };
      }
      if (op === "+") {
        return {
          operation: { type: "UseAlternative", word, checkEmpty },
          endIndex: wordEnd,
        };
      }

      // Substring: ${var:offset} or ${var:offset:length}
      const colonIdx = wordStr.indexOf(":");
      if (colonIdx >= 0 || /^-?\d+$/.test(wordStr)) {
        const offsetStr = colonIdx >= 0 ? wordStr.slice(0, colonIdx) : wordStr;
        const lengthStr = colonIdx >= 0 ? wordStr.slice(colonIdx + 1) : null;
        return {
          operation: {
            type: "Substring",
            offset: this.parseArithExprFromString(offsetStr),
            length: lengthStr ? this.parseArithExprFromString(lengthStr) : null,
          },
          endIndex: wordEnd,
        };
      }
    }

    // - = ? + (without colon)
    if ("-=?+".includes(char)) {
      i++;
      const wordEnd = this.findParameterOperationEnd(value, i);
      const wordStr = value.slice(i, wordEnd);
      const word = AST.word([AST.literal(wordStr)]);

      if (char === "-") {
        return {
          operation: { type: "DefaultValue", word, checkEmpty: false },
          endIndex: wordEnd,
        };
      }
      if (char === "=") {
        return {
          operation: { type: "AssignDefault", word, checkEmpty: false },
          endIndex: wordEnd,
        };
      }
      if (char === "?") {
        return {
          operation: {
            type: "ErrorIfUnset",
            word: wordStr ? word : null,
            checkEmpty: false,
          },
          endIndex: wordEnd,
        };
      }
      if (char === "+") {
        return {
          operation: { type: "UseAlternative", word, checkEmpty: false },
          endIndex: wordEnd,
        };
      }
    }

    // ## # %% % pattern removal
    if (char === "#" || char === "%") {
      const greedy = nextChar === char;
      const side = char === "#" ? "prefix" : "suffix";
      i += greedy ? 2 : 1;

      const patternEnd = this.findParameterOperationEnd(value, i);
      const patternStr = value.slice(i, patternEnd);
      const pattern = AST.word([AST.literal(patternStr)]);

      return {
        operation: { type: "PatternRemoval", pattern, side, greedy },
        endIndex: patternEnd,
      };
    }

    // / // pattern replacement
    if (char === "/") {
      const all = nextChar === "/";
      i += all ? 2 : 1;

      // Check for anchor
      let anchor: "start" | "end" | null = null;
      if (value[i] === "#") {
        anchor = "start";
        i++;
      } else if (value[i] === "%") {
        anchor = "end";
        i++;
      }

      // Find pattern/replacement separator
      const patternEnd = this.findPatternEnd(value, i);
      const patternStr = value.slice(i, patternEnd);
      const pattern = AST.word([AST.literal(patternStr)]);

      let replacement: WordNode | null = null;
      let endIdx = patternEnd;

      if (value[patternEnd] === "/") {
        const replaceStart = patternEnd + 1;
        const replaceEnd = this.findParameterOperationEnd(value, replaceStart);
        const replaceStr = value.slice(replaceStart, replaceEnd);
        replacement = AST.word([AST.literal(replaceStr)]);
        endIdx = replaceEnd;
      }

      return {
        operation: {
          type: "PatternReplacement",
          pattern,
          replacement,
          all,
          anchor,
        },
        endIndex: endIdx,
      };
    }

    // ^ ^^ , ,, case modification
    if (char === "^" || char === ",") {
      const all = nextChar === char;
      const direction = char === "^" ? "upper" : "lower";
      i += all ? 2 : 1;

      const patternEnd = this.findParameterOperationEnd(value, i);
      const patternStr = value.slice(i, patternEnd);
      const pattern = patternStr ? AST.word([AST.literal(patternStr)]) : null;

      return {
        operation: {
          type: "CaseModification",
          direction,
          all,
          pattern,
        } as const,
        endIndex: patternEnd,
      };
    }

    return { operation: null, endIndex: i };
  }

  private findParameterOperationEnd(value: string, start: number): number {
    let i = start;
    let depth = 1;

    while (i < value.length && depth > 0) {
      const char = value[i];
      if (char === "{") depth++;
      else if (char === "}") depth--;
      if (depth > 0) i++;
    }

    return i;
  }

  private findPatternEnd(value: string, start: number): number {
    let i = start;

    while (i < value.length) {
      const char = value[i];
      if (char === "/" || char === "}") break;
      if (char === "\\") i += 2;
      else i++;
    }

    return i;
  }

  private parseArithExprFromString(str: string): ArithmeticExpressionNode {
    // Simple arithmetic expression parser
    // For now, just wrap in a node - full parsing happens during interpretation
    return {
      type: "ArithmeticExpression",
      expression: { type: "ArithNumber", value: Number.parseInt(str, 10) || 0 },
    };
  }

  private parseCommandSubstitution(
    value: string,
    start: number,
  ): { part: CommandSubstitutionPart; endIndex: number } {
    // Skip $(
    const cmdStart = start + 2;
    let depth = 1;
    let i = cmdStart;

    while (i < value.length && depth > 0) {
      if (value[i] === "(") depth++;
      else if (value[i] === ")") depth--;
      if (depth > 0) i++;
    }

    const cmdStr = value.slice(cmdStart, i);
    // Use a new Parser instance to avoid overwriting this parser's tokens
    const nestedParser = new Parser();
    const body = nestedParser.parse(cmdStr);

    return {
      part: AST.commandSubstitution(body, false),
      endIndex: i + 1,
    };
  }

  private parseBacktickSubstitution(
    value: string,
    start: number,
  ): { part: CommandSubstitutionPart; endIndex: number } {
    const cmdStart = start + 1;
    let i = cmdStart;

    while (i < value.length && value[i] !== "`") {
      if (value[i] === "\\") i += 2;
      else i++;
    }

    const cmdStr = value.slice(cmdStart, i);
    // Use a new Parser instance to avoid overwriting this parser's tokens
    const nestedParser = new Parser();
    const body = nestedParser.parse(cmdStr);

    return {
      part: AST.commandSubstitution(body, true),
      endIndex: i + 1,
    };
  }

  private parseArithmeticExpansion(
    value: string,
    start: number,
  ): { part: ArithmeticExpansionPart; endIndex: number } {
    // Skip $((
    const exprStart = start + 3;
    let depth = 1;
    let i = exprStart;

    while (i < value.length - 1 && depth > 0) {
      if (value[i] === "(" && value[i + 1] === "(") {
        depth++;
        i += 2;
      } else if (value[i] === ")" && value[i + 1] === ")") {
        depth--;
        if (depth > 0) i += 2;
      } else {
        i++;
      }
    }

    const exprStr = value.slice(exprStart, i);
    const expression = this.parseArithmeticExpression(exprStr);

    return {
      part: AST.arithmeticExpansion(expression),
      endIndex: i + 2,
    };
  }

  private findTildeEnd(value: string, start: number): number {
    let i = start + 1;
    while (i < value.length && /[a-zA-Z0-9_-]/.test(value[i])) {
      i++;
    }
    return i;
  }

  private parseGlobPattern(
    value: string,
    start: number,
  ): { pattern: string; endIndex: number } {
    let i = start;
    let pattern = "";

    while (i < value.length) {
      const char = value[i];

      if (char === "*" || char === "?") {
        pattern += char;
        i++;
      } else if (char === "[") {
        // Character class
        const closeIdx = value.indexOf("]", i + 1);
        if (closeIdx === -1) {
          pattern += char;
          i++;
        } else {
          pattern += value.slice(i, closeIdx + 1);
          i = closeIdx + 1;
        }
      } else {
        break;
      }
    }

    return { pattern, endIndex: i };
  }

  private tryParseBraceExpansion(
    value: string,
    start: number,
  ): { part: WordPart; endIndex: number } | null {
    // Find matching }
    const closeIdx = this.findMatchingBracket(value, start, "{", "}");
    if (closeIdx === -1) return null;

    const inner = value.slice(start + 1, closeIdx);

    // Check for range: {a..z} or {1..10}
    const rangeMatch = inner.match(/^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/);
    if (rangeMatch) {
      return {
        part: {
          type: "BraceExpansion",
          items: [
            {
              type: "Range",
              start: Number.parseInt(rangeMatch[1], 10),
              end: Number.parseInt(rangeMatch[2], 10),
              step: rangeMatch[3]
                ? Number.parseInt(rangeMatch[3], 10)
                : undefined,
            },
          ],
        },
        endIndex: closeIdx + 1,
      };
    }

    const charRangeMatch = inner.match(/^([a-zA-Z])\.\.([a-zA-Z])$/);
    if (charRangeMatch) {
      return {
        part: {
          type: "BraceExpansion",
          items: [
            {
              type: "Range",
              start: charRangeMatch[1],
              end: charRangeMatch[2],
            },
          ],
        },
        endIndex: closeIdx + 1,
      };
    }

    // Check for comma-separated list: {a,b,c}
    if (inner.includes(",")) {
      const items = inner.split(",").map((s) => ({
        type: "Word" as const,
        word: AST.word([AST.literal(s)]),
      }));
      return {
        part: { type: "BraceExpansion", items },
        endIndex: closeIdx + 1,
      };
    }

    return null;
  }

  private findMatchingBracket(
    value: string,
    start: number,
    open: string,
    close: string,
  ): number {
    let depth = 1;
    let i = start + 1;

    while (i < value.length && depth > 0) {
      if (value[i] === open) depth++;
      else if (value[i] === close) depth--;
      if (depth > 0) i++;
    }

    return depth === 0 ? i : -1;
  }

  // ===========================================================================
  // REDIRECTION PARSING
  // ===========================================================================

  private isRedirection(): boolean {
    const currentToken = this.tokens[this.pos];
    const t = currentToken.type;

    // Check for number followed by redirection operator
    // Only treat as fd redirection if the number is immediately adjacent to the operator
    // e.g., "2>" is a redirection but "2 >" (with space) is an argument followed by redirection
    if (t === TokenType.NUMBER) {
      const nextToken = this.tokens[this.pos + 1];
      // Check if tokens are adjacent (no space between them)
      if (currentToken.end !== nextToken.start) {
        return false;
      }
      return REDIRECTION_AFTER_NUMBER.has(nextToken.type);
    }

    return REDIRECTION_TOKENS.has(t);
  }

  private parseRedirection(): RedirectionNode {
    let fd: number | null = null;

    // Parse optional file descriptor
    if (this.check(TokenType.NUMBER)) {
      fd = Number.parseInt(this.advance().value, 10);
    }

    // Parse operator
    const opToken = this.advance();
    const operator = this.tokenToRedirectOp(opToken.type);

    // Handle here-documents
    if (
      opToken.type === TokenType.DLESS ||
      opToken.type === TokenType.DLESSDASH
    ) {
      return this.parseHeredocStart(
        operator,
        fd,
        opToken.type === TokenType.DLESSDASH,
      );
    }

    // Parse target
    if (!this.isWord()) {
      this.error("Expected redirection target");
    }

    const target = this.parseWord();
    return AST.redirection(operator, target, fd);
  }

  private tokenToRedirectOp(type: TokenType): RedirectionOperator {
    const map: Partial<Record<TokenType, RedirectionOperator>> = {
      [TokenType.LESS]: "<",
      [TokenType.GREAT]: ">",
      [TokenType.DGREAT]: ">>",
      [TokenType.LESSAND]: "<&",
      [TokenType.GREATAND]: ">&",
      [TokenType.LESSGREAT]: "<>",
      [TokenType.CLOBBER]: ">|",
      [TokenType.TLESS]: "<<<",
      [TokenType.AND_GREAT]: "&>",
      [TokenType.AND_DGREAT]: "&>>",
      [TokenType.DLESS]: "<", // Here-doc operator is <
      [TokenType.DLESSDASH]: "<",
    };
    return map[type] || ">";
  }

  private parseHeredocStart(
    _operator: RedirectionOperator,
    fd: number | null,
    stripTabs: boolean,
  ): RedirectionNode {
    // Parse delimiter
    if (!this.isWord()) {
      this.error("Expected here-document delimiter");
    }

    const delimToken = this.advance();
    let delimiter = delimToken.value;
    const quoted = delimToken.quoted || false;

    // Remove quotes from delimiter
    if (delimiter.startsWith("'") && delimiter.endsWith("'")) {
      delimiter = delimiter.slice(1, -1);
    } else if (delimiter.startsWith('"') && delimiter.endsWith('"')) {
      delimiter = delimiter.slice(1, -1);
    }

    // Create placeholder redirection
    const redirect = AST.redirection(
      stripTabs ? "<<-" : "<<", // Use proper here-doc operator
      AST.hereDoc(delimiter, AST.word([]), stripTabs, quoted),
      fd,
    );

    // Register pending here-document
    this.pendingHeredocs.push({
      redirect,
      delimiter,
      stripTabs,
      quoted,
    });

    return redirect;
  }

  // ===========================================================================
  // COMPOUND COMMAND PARSING
  // ===========================================================================

  private parseIf(): IfNode {
    this.expect(TokenType.IF);
    const clauses: IfClause[] = [];

    // Parse if condition
    const condition = this.parseCompoundList();
    this.expect(TokenType.THEN);
    const body = this.parseCompoundList();
    clauses.push({ condition, body });

    // Parse elif clauses
    while (this.check(TokenType.ELIF)) {
      this.advance();
      const elifCondition = this.parseCompoundList();
      this.expect(TokenType.THEN);
      const elifBody = this.parseCompoundList();
      clauses.push({ condition: elifCondition, body: elifBody });
    }

    // Parse else clause
    let elseBody: StatementNode[] | null = null;
    if (this.check(TokenType.ELSE)) {
      this.advance();
      elseBody = this.parseCompoundList();
    }

    this.expect(TokenType.FI);

    // Parse optional redirections
    const redirections = this.parseOptionalRedirections();

    return AST.ifNode(clauses, elseBody, redirections);
  }

  private parseFor(): ForNode | CStyleForNode {
    this.expect(TokenType.FOR);

    // Check for C-style for: for (( ... ))
    if (this.check(TokenType.DPAREN_START)) {
      return this.parseCStyleFor();
    }

    // Regular for: for VAR in WORDS
    const varToken = this.expect(
      TokenType.NAME,
      "Expected variable name in for loop",
    );
    const variable = varToken.value;

    let words: WordNode[] | null = null;

    // Check for 'in' keyword
    this.skipNewlines();
    if (this.check(TokenType.IN)) {
      this.advance();
      words = [];

      // Parse words until ; or newline
      while (
        !this.check(
          TokenType.SEMICOLON,
          TokenType.NEWLINE,
          TokenType.DO,
          TokenType.EOF,
        )
      ) {
        if (this.isWord()) {
          words.push(this.parseWord());
        } else {
          break;
        }
      }
    }

    // Skip separator
    if (this.check(TokenType.SEMICOLON)) {
      this.advance();
    }
    this.skipNewlines();

    this.expect(TokenType.DO);
    const body = this.parseCompoundList();
    this.expect(TokenType.DONE);

    const redirections = this.parseOptionalRedirections();

    return AST.forNode(variable, words, body, redirections);
  }

  private parseCStyleFor(): CStyleForNode {
    this.expect(TokenType.DPAREN_START);

    // Parse init; cond; step
    // This is a simplified parser - we read until ; or ))
    let init: ArithmeticExpressionNode | null = null;
    let condition: ArithmeticExpressionNode | null = null;
    let update: ArithmeticExpressionNode | null = null;

    const parts: string[] = ["", "", ""];
    let partIdx = 0;
    let depth = 0;

    // Read until ))
    while (!this.check(TokenType.DPAREN_END, TokenType.EOF)) {
      const token = this.advance();
      if (token.type === TokenType.SEMICOLON && depth === 0) {
        partIdx++;
        if (partIdx > 2) break;
      } else {
        if (token.value === "(") depth++;
        if (token.value === ")") depth--;
        parts[partIdx] += token.value;
      }
    }

    this.expect(TokenType.DPAREN_END);

    if (parts[0].trim()) {
      init = this.parseArithmeticExpression(parts[0].trim());
    }
    if (parts[1].trim()) {
      condition = this.parseArithmeticExpression(parts[1].trim());
    }
    if (parts[2].trim()) {
      update = this.parseArithmeticExpression(parts[2].trim());
    }

    this.skipNewlines();
    if (this.check(TokenType.SEMICOLON)) {
      this.advance();
    }
    this.skipNewlines();

    this.expect(TokenType.DO);
    const body = this.parseCompoundList();
    this.expect(TokenType.DONE);

    const redirections = this.parseOptionalRedirections();

    return {
      type: "CStyleFor",
      init,
      condition,
      update,
      body,
      redirections,
    };
  }

  private parseWhile(): WhileNode {
    this.expect(TokenType.WHILE);
    const condition = this.parseCompoundList();
    this.expect(TokenType.DO);
    const body = this.parseCompoundList();
    this.expect(TokenType.DONE);

    const redirections = this.parseOptionalRedirections();

    return AST.whileNode(condition, body, redirections);
  }

  private parseUntil(): UntilNode {
    this.expect(TokenType.UNTIL);
    const condition = this.parseCompoundList();
    this.expect(TokenType.DO);
    const body = this.parseCompoundList();
    this.expect(TokenType.DONE);

    const redirections = this.parseOptionalRedirections();

    return AST.untilNode(condition, body, redirections);
  }

  private parseCase(): CaseNode {
    this.expect(TokenType.CASE);

    if (!this.isWord()) {
      this.error("Expected word after 'case'");
    }
    const word = this.parseWord();

    this.skipNewlines();
    this.expect(TokenType.IN);
    this.skipNewlines();

    const items: CaseItemNode[] = [];

    // Parse case items
    while (!this.check(TokenType.ESAC, TokenType.EOF)) {
      const item = this.parseCaseItem();
      if (item) {
        items.push(item);
      }
      this.skipNewlines();
    }

    this.expect(TokenType.ESAC);

    const redirections = this.parseOptionalRedirections();

    return AST.caseNode(word, items, redirections);
  }

  private parseCaseItem(): CaseItemNode | null {
    // Skip optional (
    if (this.check(TokenType.LPAREN)) {
      this.advance();
    }

    const patterns: WordNode[] = [];

    // Parse patterns separated by |
    while (this.isWord()) {
      patterns.push(this.parseWord());

      if (this.check(TokenType.PIPE)) {
        this.advance();
      } else {
        break;
      }
    }

    if (patterns.length === 0) {
      return null;
    }

    // Expect )
    this.expect(TokenType.RPAREN);
    this.skipNewlines();

    // Parse body
    const body: StatementNode[] = [];
    while (
      !this.check(
        TokenType.DSEMI,
        TokenType.SEMI_AND,
        TokenType.SEMI_SEMI_AND,
        TokenType.ESAC,
        TokenType.EOF,
      )
    ) {
      const stmt = this.parseStatement();
      if (stmt) {
        body.push(stmt);
      }
      // Don't skip case terminators (;;, ;&, ;;&) - we need to see them
      this.skipSeparators(false);
    }

    // Parse terminator
    let terminator: ";;" | ";&" | ";;&" = ";;";
    if (this.check(TokenType.DSEMI)) {
      this.advance();
      terminator = ";;";
    } else if (this.check(TokenType.SEMI_AND)) {
      this.advance();
      terminator = ";&";
    } else if (this.check(TokenType.SEMI_SEMI_AND)) {
      this.advance();
      terminator = ";;&";
    }

    return AST.caseItem(patterns, body, terminator);
  }

  private parseSubshellOrArithmeticFor(): SubshellNode | CStyleForNode {
    // Check for (( which indicates C-style for
    if (this.peek(1).type === TokenType.LPAREN) {
      // This is (( - but we need to check context
      // For now, treat as subshell start
    }

    this.expect(TokenType.LPAREN);

    // Check if this is (( arithmetic
    if (this.check(TokenType.LPAREN)) {
      this.advance();
      // Parse arithmetic...
      // For now, treat as subshell
    }

    const body = this.parseCompoundList();
    this.expect(TokenType.RPAREN);

    const redirections = this.parseOptionalRedirections();

    return AST.subshell(body, redirections);
  }

  private parseGroup(): GroupNode {
    this.expect(TokenType.LBRACE);
    const body = this.parseCompoundList();
    this.expect(TokenType.RBRACE);

    const redirections = this.parseOptionalRedirections();

    return AST.group(body, redirections);
  }

  private parseArithmeticCommand(): ArithmeticCommandNode {
    this.expect(TokenType.DPAREN_START);

    // Read expression until ))
    let exprStr = "";
    let depth = 1;

    while (depth > 0 && !this.check(TokenType.EOF)) {
      if (this.check(TokenType.DPAREN_START)) {
        depth++;
        exprStr += "((";
        this.advance();
      } else if (this.check(TokenType.DPAREN_END)) {
        depth--;
        if (depth > 0) {
          exprStr += "))";
          this.advance();
        }
      } else {
        exprStr += this.current().value;
        this.advance();
      }
    }

    this.expect(TokenType.DPAREN_END);

    const expression = this.parseArithmeticExpression(exprStr.trim());
    const redirections = this.parseOptionalRedirections();

    return AST.arithmeticCommand(expression, redirections);
  }

  private parseConditionalCommand(): ConditionalCommandNode {
    this.expect(TokenType.DBRACK_START);

    const expression = this.parseConditionalExpression();

    this.expect(TokenType.DBRACK_END);

    const redirections = this.parseOptionalRedirections();

    return AST.conditionalCommand(expression, redirections);
  }

  private parseConditionalExpression(): ConditionalExpressionNode {
    return this.parseCondOr();
  }

  private parseCondOr(): ConditionalExpressionNode {
    let left = this.parseCondAnd();

    while (this.check(TokenType.OR_OR)) {
      this.advance();
      const right = this.parseCondAnd();
      left = { type: "CondOr", left, right };
    }

    return left;
  }

  private parseCondAnd(): ConditionalExpressionNode {
    let left = this.parseCondNot();

    while (this.check(TokenType.AND_AND)) {
      this.advance();
      const right = this.parseCondNot();
      left = { type: "CondAnd", left, right };
    }

    return left;
  }

  private parseCondNot(): ConditionalExpressionNode {
    if (this.check(TokenType.BANG)) {
      this.advance();
      const operand = this.parseCondNot();
      return { type: "CondNot", operand };
    }

    return this.parseCondPrimary();
  }

  private parseCondPrimary(): ConditionalExpressionNode {
    // Handle grouping: ( expr )
    if (this.check(TokenType.LPAREN)) {
      this.advance();
      const expression = this.parseConditionalExpression();
      this.expect(TokenType.RPAREN);
      return { type: "CondGroup", expression };
    }

    // Handle unary operators: -f file, -z string, etc.
    if (this.isWord()) {
      const first = this.current().value;

      // Check for unary operators
      const unaryOps = [
        "-a",
        "-b",
        "-c",
        "-d",
        "-e",
        "-f",
        "-g",
        "-h",
        "-k",
        "-p",
        "-r",
        "-s",
        "-t",
        "-u",
        "-w",
        "-x",
        "-G",
        "-L",
        "-N",
        "-O",
        "-S",
        "-z",
        "-n",
        "-o",
        "-v",
        "-R",
      ];

      if (unaryOps.includes(first)) {
        this.advance();
        if (this.isWord() || this.check(TokenType.DBRACK_END)) {
          const operand = this.check(TokenType.DBRACK_END)
            ? AST.word([AST.literal("")])
            : this.parseWord();
          return {
            type: "CondUnary",
            operator: first as CondUnaryOperator,
            operand,
          };
        }
      }

      // Parse as word, then check for binary operator
      const left = this.parseWord();

      // Check for binary operators
      const binaryOps = [
        "==",
        "!=",
        "=~",
        "<",
        ">",
        "-eq",
        "-ne",
        "-lt",
        "-le",
        "-gt",
        "-ge",
        "-nt",
        "-ot",
        "-ef",
      ];

      if (this.isWord() && binaryOps.includes(this.current().value)) {
        const operator = this.advance().value;
        const right = this.parseWord();
        return {
          type: "CondBinary",
          operator: operator as CondBinaryOperator,
          left,
          right,
        };
      }

      // Check for < and > which are tokenized as LESS and GREAT
      if (this.check(TokenType.LESS)) {
        this.advance();
        const right = this.parseWord();
        return {
          type: "CondBinary",
          operator: "<",
          left,
          right,
        };
      }
      if (this.check(TokenType.GREAT)) {
        this.advance();
        const right = this.parseWord();
        return {
          type: "CondBinary",
          operator: ">",
          left,
          right,
        };
      }

      // Check for = (assignment/equality in test)
      if (this.isWord() && this.current().value === "=") {
        this.advance();
        const right = this.parseWord();
        return {
          type: "CondBinary",
          operator: "==",
          left,
          right,
        };
      }

      // Just a word (non-empty string test)
      return { type: "CondWord", word: left };
    }

    this.error("Expected conditional expression");
  }

  private parseFunctionDef(): FunctionDefNode {
    let name: string;

    // function name { ... } or function name () { ... }
    if (this.check(TokenType.FUNCTION)) {
      this.advance();
      name = this.expect(TokenType.NAME, "Expected function name").value;

      // Optional ()
      if (this.check(TokenType.LPAREN)) {
        this.advance();
        this.expect(TokenType.RPAREN);
      }
    } else {
      // name () { ... }
      name = this.advance().value;
      this.expect(TokenType.LPAREN);
      this.expect(TokenType.RPAREN);
    }

    this.skipNewlines();

    // Parse body (must be compound command)
    const body = this.parseCompoundCommandBody();

    const redirections = this.parseOptionalRedirections();

    return AST.functionDef(name, body, redirections);
  }

  private parseCompoundCommandBody(): CompoundCommandNode {
    if (this.check(TokenType.LBRACE)) {
      return this.parseGroup();
    }
    if (this.check(TokenType.LPAREN)) {
      return this.parseSubshellOrArithmeticFor();
    }
    if (this.check(TokenType.IF)) {
      return this.parseIf();
    }
    if (this.check(TokenType.FOR)) {
      const result = this.parseFor();
      if (result.type === "CStyleFor") {
        return result;
      }
      return result;
    }
    if (this.check(TokenType.WHILE)) {
      return this.parseWhile();
    }
    if (this.check(TokenType.UNTIL)) {
      return this.parseUntil();
    }
    if (this.check(TokenType.CASE)) {
      return this.parseCase();
    }

    this.error("Expected compound command for function body");
  }

  // ===========================================================================
  // HELPER PARSING
  // ===========================================================================

  private parseCompoundList(): StatementNode[] {
    const statements: StatementNode[] = [];

    this.skipNewlines();

    while (
      !this.check(
        TokenType.EOF,
        TokenType.FI,
        TokenType.ELSE,
        TokenType.ELIF,
        TokenType.THEN,
        TokenType.DO,
        TokenType.DONE,
        TokenType.ESAC,
        TokenType.RPAREN,
        TokenType.RBRACE,
        TokenType.DSEMI,
        TokenType.SEMI_AND,
        TokenType.SEMI_SEMI_AND,
      ) &&
      this.isCommandStart()
    ) {
      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      }
      this.skipSeparators();
    }

    return statements;
  }

  private parseOptionalRedirections(): RedirectionNode[] {
    const redirections: RedirectionNode[] = [];

    while (this.isRedirection()) {
      redirections.push(this.parseRedirection());
    }

    return redirections;
  }

  // ===========================================================================
  // ARITHMETIC EXPRESSION PARSING
  // ===========================================================================

  private parseArithmeticExpression(input: string): ArithmeticExpressionNode {
    const expression = this.parseArithExpr(input, 0).expr;
    return { type: "ArithmeticExpression", expression };
  }

  private parseArithExpr(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    return this.parseArithTernary(input, pos);
  }

  private parseArithTernary(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let { expr: condition, pos: p } = this.parseArithLogicalOr(input, pos);

    p = this.skipArithWhitespace(input, p);
    if (input[p] === "?") {
      p++;
      const { expr: consequent, pos: p2 } = this.parseArithExpr(input, p);
      p = this.skipArithWhitespace(input, p2);
      if (input[p] === ":") {
        p++;
        const { expr: alternate, pos: p3 } = this.parseArithExpr(input, p);
        return {
          expr: { type: "ArithTernary", condition, consequent, alternate },
          pos: p3,
        };
      }
    }

    return { expr: condition, pos: p };
  }

  private parseArithLogicalOr(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let { expr: left, pos: p } = this.parseArithLogicalAnd(input, pos);

    while (true) {
      p = this.skipArithWhitespace(input, p);
      if (input.slice(p, p + 2) === "||") {
        p += 2;
        const { expr: right, pos: p2 } = this.parseArithLogicalAnd(input, p);
        left = { type: "ArithBinary", operator: "||", left, right };
        p = p2;
      } else {
        break;
      }
    }

    return { expr: left, pos: p };
  }

  private parseArithLogicalAnd(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let { expr: left, pos: p } = this.parseArithBitwiseOr(input, pos);

    while (true) {
      p = this.skipArithWhitespace(input, p);
      if (input.slice(p, p + 2) === "&&") {
        p += 2;
        const { expr: right, pos: p2 } = this.parseArithBitwiseOr(input, p);
        left = { type: "ArithBinary", operator: "&&", left, right };
        p = p2;
      } else {
        break;
      }
    }

    return { expr: left, pos: p };
  }

  private parseArithBitwiseOr(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let { expr: left, pos: p } = this.parseArithBitwiseXor(input, pos);

    while (true) {
      p = this.skipArithWhitespace(input, p);
      if (input[p] === "|" && input[p + 1] !== "|") {
        p++;
        const { expr: right, pos: p2 } = this.parseArithBitwiseXor(input, p);
        left = { type: "ArithBinary", operator: "|", left, right };
        p = p2;
      } else {
        break;
      }
    }

    return { expr: left, pos: p };
  }

  private parseArithBitwiseXor(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let { expr: left, pos: p } = this.parseArithBitwiseAnd(input, pos);

    while (true) {
      p = this.skipArithWhitespace(input, p);
      if (input[p] === "^") {
        p++;
        const { expr: right, pos: p2 } = this.parseArithBitwiseAnd(input, p);
        left = { type: "ArithBinary", operator: "^", left, right };
        p = p2;
      } else {
        break;
      }
    }

    return { expr: left, pos: p };
  }

  private parseArithBitwiseAnd(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let { expr: left, pos: p } = this.parseArithEquality(input, pos);

    while (true) {
      p = this.skipArithWhitespace(input, p);
      if (input[p] === "&" && input[p + 1] !== "&") {
        p++;
        const { expr: right, pos: p2 } = this.parseArithEquality(input, p);
        left = { type: "ArithBinary", operator: "&", left, right };
        p = p2;
      } else {
        break;
      }
    }

    return { expr: left, pos: p };
  }

  private parseArithEquality(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let { expr: left, pos: p } = this.parseArithRelational(input, pos);

    while (true) {
      p = this.skipArithWhitespace(input, p);
      if (input.slice(p, p + 2) === "==" || input.slice(p, p + 2) === "!=") {
        const op = input.slice(p, p + 2) as "==" | "!=";
        p += 2;
        const { expr: right, pos: p2 } = this.parseArithRelational(input, p);
        left = { type: "ArithBinary", operator: op, left, right };
        p = p2;
      } else {
        break;
      }
    }

    return { expr: left, pos: p };
  }

  private parseArithRelational(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let { expr: left, pos: p } = this.parseArithShift(input, pos);

    while (true) {
      p = this.skipArithWhitespace(input, p);
      if (input.slice(p, p + 2) === "<=" || input.slice(p, p + 2) === ">=") {
        const op = input.slice(p, p + 2) as "<=" | ">=";
        p += 2;
        const { expr: right, pos: p2 } = this.parseArithShift(input, p);
        left = { type: "ArithBinary", operator: op, left, right };
        p = p2;
      } else if (input[p] === "<" || input[p] === ">") {
        const op = input[p] as "<" | ">";
        p++;
        const { expr: right, pos: p2 } = this.parseArithShift(input, p);
        left = { type: "ArithBinary", operator: op, left, right };
        p = p2;
      } else {
        break;
      }
    }

    return { expr: left, pos: p };
  }

  private parseArithShift(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let { expr: left, pos: p } = this.parseArithAdditive(input, pos);

    while (true) {
      p = this.skipArithWhitespace(input, p);
      if (input.slice(p, p + 2) === "<<" || input.slice(p, p + 2) === ">>") {
        const op = input.slice(p, p + 2) as "<<" | ">>";
        p += 2;
        const { expr: right, pos: p2 } = this.parseArithAdditive(input, p);
        left = { type: "ArithBinary", operator: op, left, right };
        p = p2;
      } else {
        break;
      }
    }

    return { expr: left, pos: p };
  }

  private parseArithAdditive(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let { expr: left, pos: p } = this.parseArithMultiplicative(input, pos);

    while (true) {
      p = this.skipArithWhitespace(input, p);
      if ((input[p] === "+" || input[p] === "-") && input[p + 1] !== input[p]) {
        const op = input[p] as "+" | "-";
        p++;
        const { expr: right, pos: p2 } = this.parseArithMultiplicative(
          input,
          p,
        );
        left = { type: "ArithBinary", operator: op, left, right };
        p = p2;
      } else {
        break;
      }
    }

    return { expr: left, pos: p };
  }

  private parseArithMultiplicative(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let { expr: left, pos: p } = this.parseArithPower(input, pos);

    while (true) {
      p = this.skipArithWhitespace(input, p);
      if (input[p] === "*" && input[p + 1] !== "*") {
        p++;
        const { expr: right, pos: p2 } = this.parseArithPower(input, p);
        left = { type: "ArithBinary", operator: "*", left, right };
        p = p2;
      } else if (input[p] === "/" || input[p] === "%") {
        const op = input[p] as "/" | "%";
        p++;
        const { expr: right, pos: p2 } = this.parseArithPower(input, p);
        left = { type: "ArithBinary", operator: op, left, right };
        p = p2;
      } else {
        break;
      }
    }

    return { expr: left, pos: p };
  }

  private parseArithPower(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    const { expr: base, pos: p } = this.parseArithUnary(input, pos);
    let p2 = this.skipArithWhitespace(input, p);

    if (input.slice(p2, p2 + 2) === "**") {
      p2 += 2;
      const { expr: exponent, pos: p3 } = this.parseArithPower(input, p2); // Right associative
      return {
        expr: {
          type: "ArithBinary",
          operator: "**",
          left: base,
          right: exponent,
        },
        pos: p3,
      };
    }

    return { expr: base, pos: p };
  }

  private parseArithUnary(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let p = this.skipArithWhitespace(input, pos);

    // Prefix operators: ++ -- + - ! ~
    if (input.slice(p, p + 2) === "++" || input.slice(p, p + 2) === "--") {
      const op = input.slice(p, p + 2) as "++" | "--";
      p += 2;
      const { expr: operand, pos: p2 } = this.parseArithUnary(input, p);
      return {
        expr: { type: "ArithUnary", operator: op, operand, prefix: true },
        pos: p2,
      };
    }

    if (
      input[p] === "+" ||
      input[p] === "-" ||
      input[p] === "!" ||
      input[p] === "~"
    ) {
      const op = input[p] as "+" | "-" | "!" | "~";
      p++;
      const { expr: operand, pos: p2 } = this.parseArithUnary(input, p);
      return {
        expr: { type: "ArithUnary", operator: op, operand, prefix: true },
        pos: p2,
      };
    }

    return this.parseArithPostfix(input, p);
  }

  private parseArithPostfix(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let { expr, pos: p } = this.parseArithPrimary(input, pos);

    p = this.skipArithWhitespace(input, p);

    // Postfix operators: ++ --
    if (input.slice(p, p + 2) === "++" || input.slice(p, p + 2) === "--") {
      const op = input.slice(p, p + 2) as "++" | "--";
      p += 2;
      return {
        expr: {
          type: "ArithUnary",
          operator: op,
          operand: expr,
          prefix: false,
        },
        pos: p,
      };
    }

    return { expr, pos: p };
  }

  private parseArithPrimary(
    input: string,
    pos: number,
  ): { expr: ArithExpr; pos: number } {
    let p = this.skipArithWhitespace(input, pos);

    // Grouped expression
    if (input[p] === "(") {
      p++;
      const { expr, pos: p2 } = this.parseArithExpr(input, p);
      p = this.skipArithWhitespace(input, p2);
      if (input[p] === ")") p++;
      return { expr: { type: "ArithGroup", expression: expr }, pos: p };
    }

    // Number
    if (/[0-9]/.test(input[p])) {
      let numStr = "";
      // Handle different bases: 0x, 0, base#num
      while (p < input.length && /[0-9a-fA-FxX#]/.test(input[p])) {
        numStr += input[p];
        p++;
      }
      const value = this.parseArithNumber(numStr);
      return { expr: { type: "ArithNumber", value }, pos: p };
    }

    // Variable (optionally with $ prefix)
    // Handle $1, $2, etc. (positional parameters)
    if (
      input[p] === "$" &&
      p + 1 < input.length &&
      /[0-9]/.test(input[p + 1])
    ) {
      p++; // Skip the $
      let name = "";
      while (p < input.length && /[0-9]/.test(input[p])) {
        name += input[p];
        p++;
      }
      return { expr: { type: "ArithVariable", name }, pos: p };
    }
    // Handle $name (regular variables with $ prefix)
    if (
      input[p] === "$" &&
      p + 1 < input.length &&
      /[a-zA-Z_]/.test(input[p + 1])
    ) {
      p++; // Skip the $ prefix
    }
    if (/[a-zA-Z_]/.test(input[p])) {
      let name = "";
      while (p < input.length && /[a-zA-Z0-9_]/.test(input[p])) {
        name += input[p];
        p++;
      }

      p = this.skipArithWhitespace(input, p);

      // Check for assignment operators
      const assignOps = [
        "=",
        "+=",
        "-=",
        "*=",
        "/=",
        "%=",
        "<<=",
        ">>=",
        "&=",
        "|=",
        "^=",
      ];
      for (const op of assignOps) {
        if (
          input.slice(p, p + op.length) === op &&
          input.slice(p, p + op.length + 1) !== "=="
        ) {
          p += op.length;
          const { expr: value, pos: p2 } = this.parseArithExpr(input, p);
          return {
            expr: {
              type: "ArithAssignment",
              operator: op as ArithAssignmentOperator,
              variable: name,
              value,
            },
            pos: p2,
          };
        }
      }

      return { expr: { type: "ArithVariable", name }, pos: p };
    }

    // Default: 0
    return { expr: { type: "ArithNumber", value: 0 }, pos: p };
  }

  private parseArithNumber(str: string): number {
    // Handle base#num format
    if (str.includes("#")) {
      const [baseStr, numStr] = str.split("#");
      const base = Number.parseInt(baseStr, 10);
      return Number.parseInt(numStr, base);
    }

    // Handle hex
    if (str.startsWith("0x") || str.startsWith("0X")) {
      return Number.parseInt(str.slice(2), 16);
    }

    // Handle octal
    if (str.startsWith("0") && str.length > 1 && !/[89]/.test(str)) {
      return Number.parseInt(str, 8);
    }

    return Number.parseInt(str, 10);
  }

  private skipArithWhitespace(input: string, pos: number): number {
    while (pos < input.length && /\s/.test(input[pos])) {
      pos++;
    }
    return pos;
  }
}

/**
 * Convenience function to parse a bash script
 */
export function parse(input: string): ScriptNode {
  const parser = new Parser();
  return parser.parse(input);
}
