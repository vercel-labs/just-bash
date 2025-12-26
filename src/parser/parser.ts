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
  type ArithmeticCommandNode,
  type ArithmeticExpansionPart,
  type ArithmeticExpressionNode,
  AST,
  type CommandNode,
  type CommandSubstitutionPart,
  type CompoundCommandNode,
  type ConditionalCommandNode,
  type FunctionDefNode,
  type PipelineNode,
  type RedirectionNode,
  type ScriptNode,
  type StatementNode,
  type WordNode,
} from "../ast/types.js";
import * as ArithParser from "./arithmetic-parser.js";
import * as CmdParser from "./command-parser.js";
import * as CompoundParser from "./compound-parser.js";
import * as CondParser from "./conditional-parser.js";
import * as ExpParser from "./expansion-parser.js";
import { Lexer, type Token, TokenType } from "./lexer.js";
import {
  MAX_INPUT_SIZE,
  MAX_PARSE_ITERATIONS,
  MAX_TOKENS,
  ParseException,
} from "./types.js";

export type { ParseError } from "./types.js";
// Re-export for backwards compatibility
export { ParseException } from "./types.js";

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
  private parseIterations = 0;

  /**
   * Check parse iteration limit to prevent infinite loops
   */
  checkIterationLimit(): void {
    this.parseIterations++;
    if (this.parseIterations > MAX_PARSE_ITERATIONS) {
      throw new ParseException(
        "Maximum parse iterations exceeded (possible infinite loop)",
        this.current().line,
        this.current().column,
      );
    }
  }

  /**
   * Parse a bash script string
   */
  parse(input: string): ScriptNode {
    // Check input size limit
    if (input.length > MAX_INPUT_SIZE) {
      throw new ParseException(
        `Input too large: ${input.length} bytes exceeds limit of ${MAX_INPUT_SIZE}`,
        1,
        1,
      );
    }

    const lexer = new Lexer(input);
    this.tokens = lexer.tokenize();

    // Check token count limit
    if (this.tokens.length > MAX_TOKENS) {
      throw new ParseException(
        `Too many tokens: ${this.tokens.length} exceeds limit of ${MAX_TOKENS}`,
        1,
        1,
      );
    }

    this.pos = 0;
    this.pendingHeredocs = [];
    this.parseIterations = 0;
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

  current(): Token {
    return this.tokens[this.pos] || this.tokens[this.tokens.length - 1];
  }

  peek(offset = 0): Token {
    return (
      this.tokens[this.pos + offset] || this.tokens[this.tokens.length - 1]
    );
  }

  advance(): Token {
    const token = this.current();
    if (this.pos < this.tokens.length - 1) {
      this.pos++;
    }
    return token;
  }

  getPos(): number {
    return this.pos;
  }

  /**
   * Check if current token matches any of the given types.
   * Optimized to avoid array allocation for common cases (1-4 args).
   */
  check(
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

  expect(type: TokenType, message?: string): Token {
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

  error(message: string): never {
    const token = this.current();
    throw new ParseException(message, token.line, token.column, token);
  }

  skipNewlines(): void {
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

  skipSeparators(includeCaseTerminators = true): void {
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

  addPendingHeredoc(
    redirect: RedirectionNode,
    delimiter: string,
    stripTabs: boolean,
    quoted: boolean,
  ): void {
    this.pendingHeredocs.push({ redirect, delimiter, stripTabs, quoted });
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
          // Use hereDoc=true for proper escape handling (\" is not an escape in here-docs)
          contentWord = this.parseWordFromString(
            content.value,
            false,
            false,
            false,
            true,
          );
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

  isStatementEnd(): boolean {
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
      // 'in' can appear as a command name (e.g., 'in' is not reserved outside for/case)
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

      // Check for unexpected tokens at statement start
      this.checkUnexpectedToken();

      const posBefore = this.pos;
      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      }
      // Don't skip case terminators (;;, ;&, ;;&) at script level - they're syntax errors
      this.skipSeparators(false);

      // Check for case terminators at script level - these are syntax errors
      if (
        this.check(TokenType.DSEMI, TokenType.SEMI_AND, TokenType.SEMI_SEMI_AND)
      ) {
        this.error(
          `syntax error near unexpected token \`${this.current().value}'`,
        );
      }

      // Safety: if we didn't advance, force advance to prevent infinite loop
      if (this.pos === posBefore && !this.check(TokenType.EOF)) {
        this.advance();
      }
    }

    return AST.script(statements);
  }

  /**
   * Check for unexpected tokens that can't appear at statement start
   */
  private checkUnexpectedToken(): void {
    const t = this.current().type;
    const v = this.current().value;

    // Check for unexpected reserved words that can only appear inside specific constructs
    if (
      t === TokenType.DO ||
      t === TokenType.DONE ||
      t === TokenType.THEN ||
      t === TokenType.ELSE ||
      t === TokenType.ELIF ||
      t === TokenType.FI ||
      t === TokenType.ESAC
    ) {
      this.error(`syntax error near unexpected token \`${v}'`);
    }

    // Check for unexpected closing braces/parens
    if (t === TokenType.RBRACE || t === TokenType.RPAREN) {
      this.error(`syntax error near unexpected token \`${v}'`);
    }

    // Check for case terminators at statement start
    if (
      t === TokenType.DSEMI ||
      t === TokenType.SEMI_AND ||
      t === TokenType.SEMI_SEMI_AND
    ) {
      this.error(`syntax error near unexpected token \`${v}'`);
    }

    // Check for bare semicolon (with nothing before it)
    if (t === TokenType.SEMICOLON) {
      this.error(`syntax error near unexpected token \`${v}'`);
    }
  }

  // ===========================================================================
  // STATEMENT PARSING
  // ===========================================================================

  parseStatement(): StatementNode | null {
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
      return CompoundParser.parseIf(this);
    }
    if (this.check(TokenType.FOR)) {
      return CompoundParser.parseFor(this);
    }
    if (this.check(TokenType.WHILE)) {
      return CompoundParser.parseWhile(this);
    }
    if (this.check(TokenType.UNTIL)) {
      return CompoundParser.parseUntil(this);
    }
    if (this.check(TokenType.CASE)) {
      return CompoundParser.parseCase(this);
    }
    if (this.check(TokenType.LPAREN)) {
      return CompoundParser.parseSubshell(this);
    }
    if (this.check(TokenType.LBRACE)) {
      return CompoundParser.parseGroup(this);
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
    return CmdParser.parseSimpleCommand(this);
  }

  // ===========================================================================
  // WORD PARSING
  // ===========================================================================

  isWord(): boolean {
    const t = this.current().type;
    return (
      t === TokenType.WORD ||
      t === TokenType.NAME ||
      t === TokenType.NUMBER ||
      // Reserved words can be used as words in certain contexts (e.g., "echo if")
      t === TokenType.IF ||
      t === TokenType.FOR ||
      t === TokenType.WHILE ||
      t === TokenType.UNTIL ||
      t === TokenType.CASE ||
      t === TokenType.FUNCTION ||
      t === TokenType.ELSE ||
      t === TokenType.ELIF ||
      t === TokenType.FI ||
      t === TokenType.THEN ||
      t === TokenType.DO ||
      t === TokenType.DONE ||
      t === TokenType.ESAC ||
      t === TokenType.IN ||
      // Operators that can appear as words in command arguments (e.g., "[ ! -z foo ]")
      t === TokenType.BANG
    );
  }

  parseWord(): WordNode {
    const token = this.advance();
    return this.parseWordFromString(
      token.value,
      token.quoted,
      token.singleQuoted,
    );
  }

  parseWordFromString(
    value: string,
    quoted = false,
    singleQuoted = false,
    isAssignment = false,
    hereDoc = false,
  ): WordNode {
    const parts = ExpParser.parseWordParts(
      this,
      value,
      quoted,
      singleQuoted,
      isAssignment,
      hereDoc,
    );
    return AST.word(parts);
  }

  parseCommandSubstitution(
    value: string,
    start: number,
  ): { part: CommandSubstitutionPart; endIndex: number } {
    // Skip $(
    const cmdStart = start + 2;
    let depth = 1;
    let i = cmdStart;

    // Track context for case statements
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let caseDepth = 0;
    let inCasePattern = false;
    let wordBuffer = "";

    while (i < value.length && depth > 0) {
      const c = value[i];

      if (inSingleQuote) {
        if (c === "'") inSingleQuote = false;
      } else if (inDoubleQuote) {
        if (c === "\\" && i + 1 < value.length) {
          i++; // Skip escaped char
        } else if (c === '"') {
          inDoubleQuote = false;
        }
      } else {
        // Not in quotes
        if (c === "'") {
          inSingleQuote = true;
          wordBuffer = "";
        } else if (c === '"') {
          inDoubleQuote = true;
          wordBuffer = "";
        } else if (c === "\\" && i + 1 < value.length) {
          i++; // Skip escaped char
          wordBuffer = "";
        } else if (/[a-zA-Z_]/.test(c)) {
          wordBuffer += c;
        } else {
          // Check for keywords
          if (wordBuffer === "case") {
            caseDepth++;
            inCasePattern = false;
          } else if (wordBuffer === "in" && caseDepth > 0) {
            inCasePattern = true;
          } else if (wordBuffer === "esac" && caseDepth > 0) {
            caseDepth--;
            inCasePattern = false;
          }
          wordBuffer = "";

          if (c === "(") {
            // Check for $( which starts nested command substitution
            if (i > 0 && value[i - 1] === "$") {
              depth++;
            } else if (!inCasePattern) {
              depth++;
            }
          } else if (c === ")") {
            if (inCasePattern) {
              // ) ends the case pattern, doesn't affect depth
              inCasePattern = false;
            } else {
              depth--;
            }
          } else if (c === ";") {
            // ;; in case body means next pattern
            if (caseDepth > 0 && i + 1 < value.length && value[i + 1] === ";") {
              inCasePattern = true;
            }
          }
        }
      }

      if (depth > 0) i++;
    }

    // Check for unclosed command substitution
    if (depth > 0) {
      this.error("unexpected EOF while looking for matching `)'");
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

  parseBacktickSubstitution(
    value: string,
    start: number,
    /** Whether the backtick is inside double quotes */
    inDoubleQuotes = false,
  ): { part: CommandSubstitutionPart; endIndex: number } {
    const cmdStart = start + 1;
    let i = cmdStart;
    let cmdStr = "";

    // Process backtick escaping rules:
    // \$ \` \\ \<newline> have backslash removed
    // \" has backslash removed ONLY inside double quotes
    // \x for other chars keeps the backslash
    while (i < value.length && value[i] !== "`") {
      if (value[i] === "\\") {
        const next = value[i + 1];
        // In unquoted context: only \$ \` \\ \newline are special
        // In double-quoted context: also \" is special
        const isSpecial =
          next === "$" ||
          next === "`" ||
          next === "\\" ||
          next === "\n" ||
          (inDoubleQuotes && next === '"');
        if (isSpecial) {
          // Remove the backslash, keep the next char (or nothing for newline)
          if (next !== "\n") {
            cmdStr += next;
          }
          i += 2;
        } else {
          // Keep the backslash for other characters
          cmdStr += value[i];
          i++;
        }
      } else {
        cmdStr += value[i];
        i++;
      }
    }

    // Check for unclosed backtick substitution
    if (i >= value.length) {
      this.error("unexpected EOF while looking for matching ``'");
    }

    // Use a new Parser instance to avoid overwriting this parser's tokens
    const nestedParser = new Parser();
    const body = nestedParser.parse(cmdStr);

    return {
      part: AST.commandSubstitution(body, true),
      endIndex: i + 1,
    };
  }

  parseArithmeticExpansion(
    value: string,
    start: number,
  ): { part: ArithmeticExpansionPart; endIndex: number } {
    // Skip $((
    const exprStart = start + 3;
    let arithDepth = 1; // Tracks (( and ))
    let parenDepth = 0; // Tracks single ( and ) for command subs, groups
    let i = exprStart;

    while (i < value.length - 1 && arithDepth > 0) {
      // Check for $( command substitution
      if (value[i] === "$" && value[i + 1] === "(") {
        if (value[i + 2] === "(") {
          // Nested arithmetic $((
          arithDepth++;
          i += 3;
        } else {
          // Command substitution $(
          parenDepth++;
          i += 2;
        }
      } else if (value[i] === "(" && value[i + 1] === "(") {
        // Nested arithmetic ((
        arithDepth++;
        i += 2;
      } else if (value[i] === ")" && value[i + 1] === ")") {
        // Could be closing arithmetic )) or closing ) followed by something
        if (parenDepth > 0) {
          // The first ) closes a command sub
          parenDepth--;
          i++;
        } else {
          // Closing arithmetic ))
          arithDepth--;
          if (arithDepth > 0) i += 2;
        }
      } else if (value[i] === "(") {
        // Opening paren (group, subshell, etc.)
        parenDepth++;
        i++;
      } else if (value[i] === ")") {
        // Closing paren
        if (parenDepth > 0) {
          parenDepth--;
        }
        i++;
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

  private parseArithmeticCommand(): ArithmeticCommandNode {
    this.expect(TokenType.DPAREN_START);

    // Read expression until )) at paren depth 0
    // We need to track single paren depth to handle cases like ((a=1 + (2*3)))
    // where ))) should be parsed as ) + )) not )) + )
    let exprStr = "";
    let dparenDepth = 1;
    let parenDepth = 0;
    let pendingRparen = false; // Track if we have a "virtual" ) from splitting ))

    let foundClosing = false;
    while (dparenDepth > 0 && !this.check(TokenType.EOF)) {
      // First check if we have a pending ) from a previous )) split
      if (pendingRparen) {
        pendingRparen = false;
        if (parenDepth > 0) {
          parenDepth--;
          exprStr += ")";
          continue;
        }
        // parenDepth is 0, so this pending ) plus next ) closes the outer ((
        // Check if next token is also ) or ))
        if (this.check(TokenType.RPAREN)) {
          dparenDepth--;
          foundClosing = true;
          this.advance();
          continue;
        }
        if (this.check(TokenType.DPAREN_END)) {
          // The )) here is unexpected since we just had a pending ) - treat it as closing
          dparenDepth--;
          foundClosing = true;
          // Don't advance - the )) might be needed for another purpose
          continue;
        }
        // Otherwise just add the ) to exprStr (shouldn't happen in well-formed input)
        exprStr += ")";
        continue;
      }

      if (this.check(TokenType.DPAREN_START)) {
        dparenDepth++;
        exprStr += "((";
        this.advance();
      } else if (this.check(TokenType.DPAREN_END)) {
        // If we have unmatched single parens, the )) should close them first
        if (parenDepth >= 2) {
          // Need both ) from )) to close inner parens
          parenDepth -= 2;
          exprStr += "))";
          this.advance();
        } else if (parenDepth === 1) {
          // First ) closes inner paren, second ) creates pending
          parenDepth--;
          exprStr += ")";
          pendingRparen = true;
          this.advance();
        } else {
          // parenDepth is 0, this )) closes the outer arithmetic
          dparenDepth--;
          foundClosing = true;
          if (dparenDepth > 0) {
            exprStr += "))";
          }
          this.advance();
        }
      } else if (this.check(TokenType.LPAREN)) {
        parenDepth++;
        exprStr += "(";
        this.advance();
      } else if (this.check(TokenType.RPAREN)) {
        if (parenDepth > 0) {
          parenDepth--;
        }
        exprStr += ")";
        this.advance();
      } else {
        exprStr += this.current().value;
        this.advance();
      }
    }

    // Only expect DPAREN_END if we didn't already consume the closing via splitting
    if (!foundClosing) {
      this.expect(TokenType.DPAREN_END);
    }

    const expression = this.parseArithmeticExpression(exprStr.trim());
    const redirections = this.parseOptionalRedirections();

    return AST.arithmeticCommand(expression, redirections);
  }

  private parseConditionalCommand(): ConditionalCommandNode {
    this.expect(TokenType.DBRACK_START);

    const expression = CondParser.parseConditionalExpression(this);

    this.expect(TokenType.DBRACK_END);

    const redirections = this.parseOptionalRedirections();

    return AST.conditionalCommand(expression, redirections);
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
      return CompoundParser.parseGroup(this);
    }
    if (this.check(TokenType.LPAREN)) {
      return CompoundParser.parseSubshell(this);
    }
    if (this.check(TokenType.IF)) {
      return CompoundParser.parseIf(this);
    }
    if (this.check(TokenType.FOR)) {
      return CompoundParser.parseFor(this);
    }
    if (this.check(TokenType.WHILE)) {
      return CompoundParser.parseWhile(this);
    }
    if (this.check(TokenType.UNTIL)) {
      return CompoundParser.parseUntil(this);
    }
    if (this.check(TokenType.CASE)) {
      return CompoundParser.parseCase(this);
    }

    this.error("Expected compound command for function body");
  }

  // ===========================================================================
  // HELPER PARSING
  // ===========================================================================

  parseCompoundList(): StatementNode[] {
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
      this.checkIterationLimit();
      const posBefore = this.pos;

      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      }
      this.skipSeparators();

      // Safety: if we didn't advance and didn't get a statement, break
      if (this.pos === posBefore && !stmt) {
        break;
      }
    }

    return statements;
  }

  parseOptionalRedirections(): RedirectionNode[] {
    const redirections: RedirectionNode[] = [];

    while (CmdParser.isRedirection(this)) {
      this.checkIterationLimit();
      const posBefore = this.pos;

      redirections.push(CmdParser.parseRedirection(this));

      // Safety: if we didn't advance, break
      if (this.pos === posBefore) {
        break;
      }
    }

    return redirections;
  }

  // ===========================================================================
  // ARITHMETIC EXPRESSION PARSING
  // ===========================================================================

  parseArithmeticExpression(input: string): ArithmeticExpressionNode {
    return ArithParser.parseArithmeticExpression(this, input);
  }
}

/**
 * Convenience function to parse a bash script
 */
export function parse(input: string): ScriptNode {
  const parser = new Parser();
  return parser.parse(input);
}
