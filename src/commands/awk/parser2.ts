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
      // Regex pattern
      const regexToken = this.advance();
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
    this.skipNewlines();

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
      // Parse print arguments
      args.push(this.parseTernary());
      while (this.check(TokenType.COMMA)) {
        this.advance();
        args.push(this.parseTernary());
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

  private parsePrintf(): AwkStmt {
    this.expect(TokenType.PRINTF);

    const format = this.parseExpression();
    const args: AwkExpr[] = [];

    while (this.check(TokenType.COMMA)) {
      this.advance();
      args.push(this.parseExpression());
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
    let left = this.parsePower();

    while (this.match(TokenType.STAR, TokenType.SLASH, TokenType.PERCENT)) {
      const opToken = this.advance();
      const right = this.parsePower();
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

  private parsePower(): AwkExpr {
    let left = this.parseUnary();

    if (this.check(TokenType.CARET)) {
      this.advance();
      const right = this.parsePower(); // Right associative
      left = { type: "binary", operator: "^", left, right };
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
        throw new Error("Invalid increment operand");
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
        throw new Error("Invalid decrement operand");
      }
      return {
        type: "pre_decrement",
        operand: operand as AwkVariable | AwkArrayAccess | AwkFieldRef,
      };
    }

    // Unary operators
    if (this.match(TokenType.NOT, TokenType.MINUS, TokenType.PLUS)) {
      const op = this.advance().value as "!" | "-" | "+";
      const operand = this.parseUnary();
      return { type: "unary", operator: op, operand };
    }

    return this.parsePostfix();
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

    // Parenthesized expression
    if (this.check(TokenType.LPAREN)) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return expr;
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
        const key = this.parseExpression();
        this.expect(TokenType.RBRACKET);
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
