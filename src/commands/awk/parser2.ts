/**
 * AWK Parser
 *
 * Recursive descent parser that builds an AST from tokens.
 */

import type {
  AwkArrayAccess,
  AwkBlock,
  AwkExpr,
  AwkFieldRef,
  AwkFunctionDef,
  AwkPattern,
  AwkProgram,
  AwkRule,
  AwkStmt,
  AwkVariable,
} from "./ast.js";
import { AwkLexer, type Token, TokenType } from "./lexer.js";

export class AwkParser {
  private tokens: Token[] = [];
  private pos = 0;

  parse(input: string): AwkProgram {
    const lexer = new AwkLexer(input);
    this.tokens = lexer.tokenize();
    this.pos = 0;
    return this.parseProgram();
  }

  // ─── Helper methods ────────────────────────────────────────

  private current(): Token {
    return (
      this.tokens[this.pos] || {
        type: TokenType.EOF,
        value: "",
        line: 0,
        column: 0,
      }
    );
  }

  private advance(): Token {
    const token = this.current();
    if (this.pos < this.tokens.length) {
      this.pos++;
    }
    return token;
  }

  private match(...types: TokenType[]): boolean {
    return types.includes(this.current().type);
  }

  private check(type: TokenType): boolean {
    return this.current().type === type;
  }

  private expect(type: TokenType, message?: string): Token {
    if (!this.check(type)) {
      const tok = this.current();
      throw new Error(
        message ||
          `Expected ${type}, got ${tok.type} at line ${tok.line}:${tok.column}`,
      );
    }
    return this.advance();
  }

  private skipNewlines(): void {
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
    }
  }

  private skipTerminators(): void {
    while (this.check(TokenType.NEWLINE) || this.check(TokenType.SEMICOLON)) {
      this.advance();
    }
  }

  // ─── Program parsing ───────────────────────────────────────

  private parseProgram(): AwkProgram {
    const functions: AwkFunctionDef[] = [];
    const rules: AwkRule[] = [];

    this.skipNewlines();

    while (!this.check(TokenType.EOF)) {
      this.skipNewlines();

      if (this.check(TokenType.EOF)) break;

      if (this.check(TokenType.FUNCTION)) {
        functions.push(this.parseFunction());
      } else {
        rules.push(this.parseRule());
      }

      this.skipTerminators();
    }

    return { functions, rules };
  }

  private parseFunction(): AwkFunctionDef {
    this.expect(TokenType.FUNCTION);
    const name = this.expect(TokenType.IDENT).value as string;
    this.expect(TokenType.LPAREN);

    const params: string[] = [];
    if (!this.check(TokenType.RPAREN)) {
      params.push(this.expect(TokenType.IDENT).value as string);
      while (this.check(TokenType.COMMA)) {
        this.advance();
        params.push(this.expect(TokenType.IDENT).value as string);
      }
    }

    this.expect(TokenType.RPAREN);
    this.skipNewlines();
    const body = this.parseBlock();

    return { name, params, body };
  }

  private parseRule(): AwkRule {
    let pattern: AwkPattern | undefined;

    // Check for BEGIN/END
    if (this.check(TokenType.BEGIN)) {
      this.advance();
      pattern = { type: "begin" };
    } else if (this.check(TokenType.END)) {
      this.advance();
      pattern = { type: "end" };
    } else if (this.check(TokenType.LBRACE)) {
      // No pattern, just action
      pattern = undefined;
    } else if (this.check(TokenType.REGEX)) {
      // Regex pattern - but check if it's part of a larger expression
      const regexToken = this.advance();

      // Check if this regex is followed by && or || (compound pattern)
      if (this.check(TokenType.AND) || this.check(TokenType.OR)) {
        // Convert regex to $0 ~ /regex/ expression and parse as compound expression
        const regexExpr: AwkExpr = {
          type: "binary",
          operator: "~",
          left: { type: "field", index: { type: "number", value: 0 } },
          right: { type: "regex", pattern: regexToken.value as string },
        };
        // Parse the rest of the expression starting from the && or ||
        const fullExpr = this.parseLogicalOrRest(regexExpr);
        pattern = { type: "expr_pattern", expression: fullExpr };
      } else {
        const pat: AwkPattern = {
          type: "regex_pattern",
          pattern: regexToken.value as string,
        };

        // Check for range pattern
        if (this.check(TokenType.COMMA)) {
          this.advance();
          let endPattern: AwkPattern;
          if (this.check(TokenType.REGEX)) {
            const endRegex = this.advance();
            endPattern = {
              type: "regex_pattern",
              pattern: endRegex.value as string,
            };
          } else {
            endPattern = {
              type: "expr_pattern",
              expression: this.parseExpression(),
            };
          }
          pattern = { type: "range", start: pat, end: endPattern };
        } else {
          pattern = pat;
        }
      }
    } else {
      // Expression pattern
      const expr = this.parseExpression();
      const pat: AwkPattern = { type: "expr_pattern", expression: expr };

      // Check for range pattern
      if (this.check(TokenType.COMMA)) {
        this.advance();
        let endPattern: AwkPattern;
        if (this.check(TokenType.REGEX)) {
          const endRegex = this.advance();
          endPattern = {
            type: "regex_pattern",
            pattern: endRegex.value as string,
          };
        } else {
          endPattern = {
            type: "expr_pattern",
            expression: this.parseExpression(),
          };
        }
        pattern = { type: "range", start: pat, end: endPattern };
      } else {
        pattern = pat;
      }
    }

    this.skipNewlines();

    // Parse action block if present
    let action: AwkBlock;
    if (this.check(TokenType.LBRACE)) {
      action = this.parseBlock();
    } else {
      // Default action is print $0
      action = {
        type: "block",
        statements: [
          {
            type: "print",
            args: [{ type: "field", index: { type: "number", value: 0 } }],
          },
        ],
      };
    }

    return { pattern, action };
  }

  private parseBlock(): AwkBlock {
    this.expect(TokenType.LBRACE);
    this.skipNewlines();

    const statements: AwkStmt[] = [];

    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      statements.push(this.parseStatement());
      this.skipTerminators();
    }

    this.expect(TokenType.RBRACE);
    return { type: "block", statements };
  }

  // ─── Statement parsing ─────────────────────────────────────

  private parseStatement(): AwkStmt {
    // Block
    if (this.check(TokenType.LBRACE)) {
      return this.parseBlock();
    }

    // If statement
    if (this.check(TokenType.IF)) {
      return this.parseIf();
    }

    // While statement
    if (this.check(TokenType.WHILE)) {
      return this.parseWhile();
    }

    // Do-while statement
    if (this.check(TokenType.DO)) {
      return this.parseDoWhile();
    }

    // For statement
    if (this.check(TokenType.FOR)) {
      return this.parseFor();
    }

    // Break
    if (this.check(TokenType.BREAK)) {
      this.advance();
      return { type: "break" };
    }

    // Continue
    if (this.check(TokenType.CONTINUE)) {
      this.advance();
      return { type: "continue" };
    }

    // Next
    if (this.check(TokenType.NEXT)) {
      this.advance();
      return { type: "next" };
    }

    // Nextfile
    if (this.check(TokenType.NEXTFILE)) {
      this.advance();
      return { type: "nextfile" };
    }

    // Exit
    if (this.check(TokenType.EXIT)) {
      this.advance();
      let code: AwkExpr | undefined;
      if (
        !this.check(TokenType.NEWLINE) &&
        !this.check(TokenType.SEMICOLON) &&
        !this.check(TokenType.RBRACE) &&
        !this.check(TokenType.EOF)
      ) {
        code = this.parseExpression();
      }
      return { type: "exit", code };
    }

    // Return
    if (this.check(TokenType.RETURN)) {
      this.advance();
      let value: AwkExpr | undefined;
      if (
        !this.check(TokenType.NEWLINE) &&
        !this.check(TokenType.SEMICOLON) &&
        !this.check(TokenType.RBRACE) &&
        !this.check(TokenType.EOF)
      ) {
        value = this.parseExpression();
      }
      return { type: "return", value };
    }

    // Delete
    if (this.check(TokenType.DELETE)) {
      this.advance();
      const target = this.parsePrimary();
      if (target.type !== "array_access" && target.type !== "variable") {
        throw new Error("delete requires array element or array");
      }
      return { type: "delete", target: target as AwkArrayAccess | AwkVariable };
    }

    // Print
    if (this.check(TokenType.PRINT)) {
      return this.parsePrint();
    }

    // Printf
    if (this.check(TokenType.PRINTF)) {
      return this.parsePrintf();
    }

    // Expression statement
    const expr = this.parseExpression();
    return { type: "expr_stmt", expression: expr };
  }

  private parseIf(): AwkStmt {
    this.expect(TokenType.IF);
    this.expect(TokenType.LPAREN);
    const condition = this.parseExpression();
    this.expect(TokenType.RPAREN);
    this.skipNewlines();
    const consequent = this.parseStatement();
    // Skip semicolons and newlines before checking for else
    this.skipTerminators();

    let alternate: AwkStmt | undefined;
    if (this.check(TokenType.ELSE)) {
      this.advance();
      this.skipNewlines();
      alternate = this.parseStatement();
    }

    return { type: "if", condition, consequent, alternate };
  }

  private parseWhile(): AwkStmt {
    this.expect(TokenType.WHILE);
    this.expect(TokenType.LPAREN);
    const condition = this.parseExpression();
    this.expect(TokenType.RPAREN);
    this.skipNewlines();
    const body = this.parseStatement();

    return { type: "while", condition, body };
  }

  private parseDoWhile(): AwkStmt {
    this.expect(TokenType.DO);
    this.skipNewlines();
    const body = this.parseStatement();
    this.skipNewlines();
    this.expect(TokenType.WHILE);
    this.expect(TokenType.LPAREN);
    const condition = this.parseExpression();
    this.expect(TokenType.RPAREN);

    return { type: "do_while", body, condition };
  }

  private parseFor(): AwkStmt {
    this.expect(TokenType.FOR);
    this.expect(TokenType.LPAREN);

    // Check for for-in
    if (this.check(TokenType.IDENT)) {
      const varToken = this.advance();
      if (this.check(TokenType.IN)) {
        this.advance();
        const array = this.expect(TokenType.IDENT).value as string;
        this.expect(TokenType.RPAREN);
        this.skipNewlines();
        const body = this.parseStatement();
        return {
          type: "for_in",
          variable: varToken.value as string,
          array,
          body,
        };
      }
      // Not for-in, backtrack
      this.pos--;
    }

    // C-style for
    let init: AwkExpr | undefined;
    if (!this.check(TokenType.SEMICOLON)) {
      init = this.parseExpression();
    }
    this.expect(TokenType.SEMICOLON);

    let condition: AwkExpr | undefined;
    if (!this.check(TokenType.SEMICOLON)) {
      condition = this.parseExpression();
    }
    this.expect(TokenType.SEMICOLON);

    let update: AwkExpr | undefined;
    if (!this.check(TokenType.RPAREN)) {
      update = this.parseExpression();
    }
    this.expect(TokenType.RPAREN);
    this.skipNewlines();

    const body = this.parseStatement();
    return { type: "for", init, condition, update, body };
  }

  private parsePrint(): AwkStmt {
    this.expect(TokenType.PRINT);

    const args: AwkExpr[] = [];

    // Check for empty print (print $0)
    if (
      this.check(TokenType.NEWLINE) ||
      this.check(TokenType.SEMICOLON) ||
      this.check(TokenType.RBRACE) ||
      this.check(TokenType.PIPE) ||
      this.check(TokenType.GT) ||
      this.check(TokenType.APPEND)
    ) {
      args.push({ type: "field", index: { type: "number", value: 0 } });
    } else {
      // Parse print arguments - use parsePrintArg to stop before > and >>
      // In AWK, > and >> at print level are redirection, not comparison
      args.push(this.parsePrintArg());
      while (this.check(TokenType.COMMA)) {
        this.advance();
        args.push(this.parsePrintArg());
      }
    }

    // Check for output redirection
    let output: { redirect: ">" | ">>"; file: AwkExpr } | undefined;
    if (this.check(TokenType.GT)) {
      this.advance();
      output = { redirect: ">", file: this.parsePrimary() };
    } else if (this.check(TokenType.APPEND)) {
      this.advance();
      output = { redirect: ">>", file: this.parsePrimary() };
    }

    return { type: "print", args, output };
  }

  /**
   * Parse a print argument - same as ternary but treats > and >> at the TOP LEVEL
   * (not inside ternary) as redirection rather than comparison operators.
   */
  private parsePrintArg(): AwkExpr {
    // For ternary conditions, we need to allow > as comparison
    // Check if there's a ? ahead (indicating ternary) - if so, parse full comparison
    const hasTernary = this.lookAheadForTernary();

    if (hasTernary) {
      // Parse as full ternary with regular comparison (> allowed)
      return this.parseTernary();
    }

    // No ternary - parse without > to leave room for redirection
    return this.parsePrintOr();
  }

  /**
   * Look ahead to see if there's a ternary ? operator before the next statement terminator.
   * This tells us whether > is comparison (in ternary condition) or redirection.
   */
  private lookAheadForTernary(): boolean {
    let depth = 0;
    let i = this.pos;

    while (i < this.tokens.length) {
      const token = this.tokens[i];

      // Track parentheses depth
      if (token.type === TokenType.LPAREN) depth++;
      if (token.type === TokenType.RPAREN) depth--;

      // Found ? at top level - it's a ternary (even if > came before)
      if (token.type === TokenType.QUESTION && depth === 0) {
        return true;
      }

      // Statement terminators - stop looking (no ternary found)
      if (
        token.type === TokenType.NEWLINE ||
        token.type === TokenType.SEMICOLON ||
        token.type === TokenType.RBRACE ||
        token.type === TokenType.COMMA ||
        token.type === TokenType.PIPE
      ) {
        return false;
      }

      i++;
    }

    return false;
  }

  private parsePrintOr(): AwkExpr {
    let left = this.parsePrintAnd();
    while (this.check(TokenType.OR)) {
      this.advance();
      const right = this.parsePrintAnd();
      left = { type: "binary", operator: "||", left, right };
    }
    return left;
  }

  private parsePrintAnd(): AwkExpr {
    let left = this.parsePrintIn();
    while (this.check(TokenType.AND)) {
      this.advance();
      const right = this.parsePrintIn();
      left = { type: "binary", operator: "&&", left, right };
    }
    return left;
  }

  private parsePrintIn(): AwkExpr {
    const left = this.parsePrintMatch();

    if (this.check(TokenType.IN)) {
      this.advance();
      const arrayName = String(this.expect(TokenType.IDENT).value);
      return { type: "in", key: left, array: arrayName };
    }

    return left;
  }

  private parsePrintMatch(): AwkExpr {
    let left = this.parsePrintComparison();

    while (this.match(TokenType.MATCH, TokenType.NOT_MATCH)) {
      const op = this.advance().type === TokenType.MATCH ? "~" : "!~";
      const right = this.parsePrintComparison();
      left = { type: "binary", operator: op, left, right };
    }

    return left;
  }

  /**
   * Like parseComparison but doesn't consume > and >> (for print redirection)
   */
  private parsePrintComparison(): AwkExpr {
    let left = this.parseConcatenation();

    // Only handle <, <=, >=, ==, != - NOT > or >> (those are redirection)
    while (
      this.match(
        TokenType.LT,
        TokenType.LE,
        TokenType.GE,
        TokenType.EQ,
        TokenType.NE,
      )
    ) {
      const opToken = this.advance();
      const right = this.parseConcatenation();
      const opMap: Record<string, "<" | "<=" | ">=" | "==" | "!="> = {
        "<": "<",
        "<=": "<=",
        ">=": ">=",
        "==": "==",
        "!=": "!=",
      };
      left = {
        type: "binary",
        operator: opMap[opToken.value as string],
        left,
        right,
      };
    }

    return left;
  }

  private parsePrintf(): AwkStmt {
    this.expect(TokenType.PRINTF);

    // Use parsePrintArg to stop at > and >> (for redirection)
    const format = this.parsePrintArg();
    const args: AwkExpr[] = [];

    while (this.check(TokenType.COMMA)) {
      this.advance();
      args.push(this.parsePrintArg());
    }

    // Check for output redirection
    let output: { redirect: ">" | ">>"; file: AwkExpr } | undefined;
    if (this.check(TokenType.GT)) {
      this.advance();
      output = { redirect: ">", file: this.parsePrimary() };
    } else if (this.check(TokenType.APPEND)) {
      this.advance();
      output = { redirect: ">>", file: this.parsePrimary() };
    }

    return { type: "printf", format, args, output };
  }

  // ─── Expression parsing (precedence climbing) ──────────────

  private parseExpression(): AwkExpr {
    return this.parseAssignment();
  }

  private parseAssignment(): AwkExpr {
    const expr = this.parseTernary();

    if (
      this.match(
        TokenType.ASSIGN,
        TokenType.PLUS_ASSIGN,
        TokenType.MINUS_ASSIGN,
        TokenType.STAR_ASSIGN,
        TokenType.SLASH_ASSIGN,
        TokenType.PERCENT_ASSIGN,
        TokenType.CARET_ASSIGN,
      )
    ) {
      const opToken = this.advance();
      const value = this.parseAssignment();

      if (
        expr.type !== "variable" &&
        expr.type !== "field" &&
        expr.type !== "array_access"
      ) {
        throw new Error("Invalid assignment target");
      }

      const opMap: Record<
        string,
        "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "^="
      > = {
        "=": "=",
        "+=": "+=",
        "-=": "-=",
        "*=": "*=",
        "/=": "/=",
        "%=": "%=",
        "^=": "^=",
      };

      return {
        type: "assignment",
        operator: opMap[opToken.value as string],
        target: expr as AwkVariable | AwkFieldRef | AwkArrayAccess,
        value,
      };
    }

    return expr;
  }

  private parseTernary(): AwkExpr {
    let expr = this.parseOr();

    if (this.check(TokenType.QUESTION)) {
      this.advance();
      const consequent = this.parseExpression();
      this.expect(TokenType.COLON);
      const alternate = this.parseExpression();
      expr = { type: "ternary", condition: expr, consequent, alternate };
    }

    return expr;
  }

  private parseOr(): AwkExpr {
    let left = this.parseAnd();

    while (this.check(TokenType.OR)) {
      this.advance();
      const right = this.parseAnd();
      left = { type: "binary", operator: "||", left, right };
    }

    return left;
  }

  /**
   * Continue parsing a logical OR/AND expression from a given left-hand side.
   * Used when we've already parsed part of an expression (e.g., a regex in pattern context).
   */
  private parseLogicalOrRest(left: AwkExpr): AwkExpr {
    // First handle AND at the same precedence level as the left operand
    left = this.parseLogicalAndRest(left);

    // Then handle OR
    while (this.check(TokenType.OR)) {
      this.advance();
      const right = this.parseAnd();
      left = { type: "binary", operator: "||", left, right };
    }

    return left;
  }

  /**
   * Continue parsing a logical AND expression from a given left-hand side.
   */
  private parseLogicalAndRest(left: AwkExpr): AwkExpr {
    while (this.check(TokenType.AND)) {
      this.advance();
      const right = this.parseIn();
      left = { type: "binary", operator: "&&", left, right };
    }

    return left;
  }

  private parseAnd(): AwkExpr {
    let left = this.parseIn();

    while (this.check(TokenType.AND)) {
      this.advance();
      const right = this.parseIn();
      left = { type: "binary", operator: "&&", left, right };
    }

    return left;
  }

  private parseIn(): AwkExpr {
    const left = this.parseMatch();

    if (this.check(TokenType.IN)) {
      this.advance();
      const array = this.expect(TokenType.IDENT).value as string;
      return { type: "in", key: left, array };
    }

    return left;
  }

  private parseMatch(): AwkExpr {
    let left = this.parseComparison();

    while (this.match(TokenType.MATCH, TokenType.NOT_MATCH)) {
      const op = this.advance().type === TokenType.MATCH ? "~" : "!~";
      const right = this.parseComparison();
      left = { type: "binary", operator: op, left, right };
    }

    return left;
  }

  private parseComparison(): AwkExpr {
    let left = this.parseConcatenation();

    while (
      this.match(
        TokenType.LT,
        TokenType.LE,
        TokenType.GT,
        TokenType.GE,
        TokenType.EQ,
        TokenType.NE,
      )
    ) {
      const opToken = this.advance();
      const right = this.parseConcatenation();
      const opMap: Record<string, "<" | "<=" | ">" | ">=" | "==" | "!="> = {
        "<": "<",
        "<=": "<=",
        ">": ">",
        ">=": ">=",
        "==": "==",
        "!=": "!=",
      };
      left = {
        type: "binary",
        operator: opMap[opToken.value as string],
        left,
        right,
      };
    }

    return left;
  }

  private parseConcatenation(): AwkExpr {
    let left = this.parseAddSub();

    // Concatenation is implicit - consecutive expressions without operators
    while (this.canStartExpression() && !this.isComparisonOrHigherOp()) {
      const right = this.parseAddSub();
      left = { type: "binary", operator: " ", left, right };
    }

    return left;
  }

  private canStartExpression(): boolean {
    return this.match(
      TokenType.NUMBER,
      TokenType.STRING,
      TokenType.IDENT,
      TokenType.DOLLAR,
      TokenType.LPAREN,
      TokenType.NOT,
      TokenType.MINUS,
      TokenType.PLUS,
      TokenType.INCREMENT,
      TokenType.DECREMENT,
    );
  }

  private isComparisonOrHigherOp(): boolean {
    return this.match(
      TokenType.LT,
      TokenType.LE,
      TokenType.GT,
      TokenType.GE,
      TokenType.EQ,
      TokenType.NE,
      TokenType.AND,
      TokenType.OR,
      TokenType.QUESTION,
      TokenType.MATCH,
      TokenType.NOT_MATCH,
      TokenType.ASSIGN,
      TokenType.PLUS_ASSIGN,
      TokenType.MINUS_ASSIGN,
      TokenType.STAR_ASSIGN,
      TokenType.SLASH_ASSIGN,
      TokenType.PERCENT_ASSIGN,
      TokenType.CARET_ASSIGN,
      TokenType.COMMA,
      TokenType.SEMICOLON,
      TokenType.NEWLINE,
      TokenType.RBRACE,
      TokenType.RPAREN,
      TokenType.RBRACKET,
      TokenType.COLON,
      TokenType.PIPE,
      TokenType.APPEND,
      TokenType.IN,
    );
  }

  private parseAddSub(): AwkExpr {
    let left = this.parseMulDiv();

    while (this.match(TokenType.PLUS, TokenType.MINUS)) {
      const op = this.advance().value as "+" | "-";
      const right = this.parseMulDiv();
      left = { type: "binary", operator: op, left, right };
    }

    return left;
  }

  private parseMulDiv(): AwkExpr {
    let left = this.parseUnary();

    while (this.match(TokenType.STAR, TokenType.SLASH, TokenType.PERCENT)) {
      const opToken = this.advance();
      const right = this.parseUnary();
      const opMap: Record<string, "*" | "/" | "%"> = {
        "*": "*",
        "/": "/",
        "%": "%",
      };
      left = {
        type: "binary",
        operator: opMap[opToken.value as string],
        left,
        right,
      };
    }

    return left;
  }

  private parseUnary(): AwkExpr {
    // Prefix increment/decrement
    if (this.check(TokenType.INCREMENT)) {
      this.advance();
      const operand = this.parseUnary();
      if (
        operand.type !== "variable" &&
        operand.type !== "field" &&
        operand.type !== "array_access"
      ) {
        // Not a valid increment target - treat as double unary plus
        // ++5 becomes +(+5) = 5
        return {
          type: "unary",
          operator: "+",
          operand: { type: "unary", operator: "+", operand },
        };
      }
      return {
        type: "pre_increment",
        operand: operand as AwkVariable | AwkArrayAccess | AwkFieldRef,
      };
    }

    if (this.check(TokenType.DECREMENT)) {
      this.advance();
      const operand = this.parseUnary();
      if (
        operand.type !== "variable" &&
        operand.type !== "field" &&
        operand.type !== "array_access"
      ) {
        // Not a valid decrement target - treat as double unary minus
        // --5 becomes -(-5) = 5
        return {
          type: "unary",
          operator: "-",
          operand: { type: "unary", operator: "-", operand },
        };
      }
      return {
        type: "pre_decrement",
        operand: operand as AwkVariable | AwkArrayAccess | AwkFieldRef,
      };
    }

    // Unary operators (-, +, !)
    // In AWK, -2^2 = -(2^2) = -4, so unary binds looser than exponent
    if (this.match(TokenType.NOT, TokenType.MINUS, TokenType.PLUS)) {
      const op = this.advance().value as "!" | "-" | "+";
      const operand = this.parseUnary();
      return { type: "unary", operator: op, operand };
    }

    return this.parsePower();
  }

  private parsePower(): AwkExpr {
    let left = this.parsePostfix();

    if (this.check(TokenType.CARET)) {
      this.advance();
      // Exponent is right-associative, and binds tighter than unary
      // So 2^3^2 = 2^(3^2) = 2^9 = 512
      // But -2^2 = -(2^2) = -4 (unary handled in parseUnary)
      const right = this.parsePower();
      left = { type: "binary", operator: "^", left, right };
    }

    return left;
  }

  private parsePostfix(): AwkExpr {
    const expr = this.parsePrimary();

    // Postfix increment/decrement
    if (this.check(TokenType.INCREMENT)) {
      this.advance();
      if (
        expr.type !== "variable" &&
        expr.type !== "field" &&
        expr.type !== "array_access"
      ) {
        throw new Error("Invalid increment operand");
      }
      return {
        type: "post_increment",
        operand: expr as AwkVariable | AwkArrayAccess | AwkFieldRef,
      };
    }

    if (this.check(TokenType.DECREMENT)) {
      this.advance();
      if (
        expr.type !== "variable" &&
        expr.type !== "field" &&
        expr.type !== "array_access"
      ) {
        throw new Error("Invalid decrement operand");
      }
      return {
        type: "post_decrement",
        operand: expr as AwkVariable | AwkArrayAccess | AwkFieldRef,
      };
    }

    return expr;
  }

  private parsePrimary(): AwkExpr {
    // Number literal
    if (this.check(TokenType.NUMBER)) {
      const value = this.advance().value as number;
      return { type: "number", value };
    }

    // String literal
    if (this.check(TokenType.STRING)) {
      const value = this.advance().value as string;
      return { type: "string", value };
    }

    // Regex literal
    if (this.check(TokenType.REGEX)) {
      const pattern = this.advance().value as string;
      return { type: "regex", pattern };
    }

    // Field reference
    if (this.check(TokenType.DOLLAR)) {
      this.advance();
      const index = this.parsePrimary();
      return { type: "field", index };
    }

    // Parenthesized expression or tuple (for multi-dimensional 'in' operator)
    if (this.check(TokenType.LPAREN)) {
      this.advance();
      const first = this.parseExpression();

      // Check for comma tuple: (expr, expr, ...)
      if (this.check(TokenType.COMMA)) {
        const elements: AwkExpr[] = [first];
        while (this.check(TokenType.COMMA)) {
          this.advance();
          elements.push(this.parseExpression());
        }
        this.expect(TokenType.RPAREN);
        return { type: "tuple", elements };
      }

      this.expect(TokenType.RPAREN);
      return first;
    }

    // Getline
    if (this.check(TokenType.GETLINE)) {
      this.advance();
      let variable: string | undefined;
      let file: AwkExpr | undefined;

      if (this.check(TokenType.IDENT)) {
        variable = this.advance().value as string;
      }

      if (this.check(TokenType.LT)) {
        this.advance();
        file = this.parsePrimary();
      }

      return { type: "getline", variable, file };
    }

    // Identifier (variable or function call)
    if (this.check(TokenType.IDENT)) {
      const name = this.advance().value as string;

      // Function call
      if (this.check(TokenType.LPAREN)) {
        this.advance();
        const args: AwkExpr[] = [];

        if (!this.check(TokenType.RPAREN)) {
          args.push(this.parseExpression());
          while (this.check(TokenType.COMMA)) {
            this.advance();
            args.push(this.parseExpression());
          }
        }

        this.expect(TokenType.RPAREN);
        return { type: "call", name, args };
      }

      // Array access
      if (this.check(TokenType.LBRACKET)) {
        this.advance();
        // Handle multi-dimensional array syntax: a[1,2,3] -> a[1 SUBSEP 2 SUBSEP 3]
        const keys: AwkExpr[] = [this.parseExpression()];
        while (this.check(TokenType.COMMA)) {
          this.advance();
          keys.push(this.parseExpression());
        }
        this.expect(TokenType.RBRACKET);

        // If multiple keys, concatenate with SUBSEP
        let key: AwkExpr;
        if (keys.length === 1) {
          key = keys[0];
        } else {
          // Build concatenation: key1 SUBSEP key2 SUBSEP key3 ...
          key = keys[0];
          for (let i = 1; i < keys.length; i++) {
            // Concatenate with SUBSEP
            key = {
              type: "binary",
              operator: " ",
              left: {
                type: "binary",
                operator: " ",
                left: key,
                right: { type: "variable", name: "SUBSEP" },
              },
              right: keys[i],
            };
          }
        }
        return { type: "array_access", array: name, key };
      }

      // Simple variable
      return { type: "variable", name };
    }

    throw new Error(
      `Unexpected token: ${this.current().type} at line ${this.current().line}:${this.current().column}`,
    );
  }
}
