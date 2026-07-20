/**
 * Parser Types and Constants
 *
 * Shared types, interfaces, and constants used across parser modules.
 */

import { type Token, TokenType } from "./lexer.js";

// Parser limits to prevent hangs and resource exhaustion
export const MAX_INPUT_SIZE = 1_000_000; // 1MB max input
export const MAX_TOKENS = 100_000; // Max tokens to parse
const MAX_PARSE_ITERATIONS = 1_000_000; // Max iterations in parsing loops
export const MAX_PARSER_DEPTH = 200; // Max recursion depth for nested constructs

// Pre-computed Sets for fast redirection token lookup (avoids array allocation per call)
export const REDIRECTION_TOKENS: Set<TokenType> = new Set([
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

export const REDIRECTION_AFTER_NUMBER: Set<TokenType> = new Set([
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

// Redirect operators that can follow {varname} (FD variable syntax)
export const REDIRECTION_AFTER_FD_VARIABLE: Set<TokenType> = new Set([
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

/** Mutable limits shared by every parser created for one top-level source. */
export class ParseBudget {
  private iterations = 0;
  private tokens = 0;
  private depth = 0;

  reset(): void {
    this.iterations = 0;
    this.tokens = 0;
    this.depth = 0;
  }

  chargeIteration(line: number, column: number): void {
    this.iterations++;
    if (this.iterations > MAX_PARSE_ITERATIONS) {
      throw new ParseException(
        "Maximum parse iterations exceeded (possible infinite loop)",
        line,
        column,
      );
    }
  }

  chargeTokens(count: number, line = 1, column = 1): void {
    this.tokens += count;
    if (this.tokens > MAX_TOKENS) {
      throw new ParseException(
        `Too many tokens: cumulative count exceeds limit of ${MAX_TOKENS}`,
        line,
        column,
      );
    }
  }

  enter(line: number, column: number): () => void {
    this.depth++;
    if (this.depth > MAX_PARSER_DEPTH) {
      this.depth--;
      throw new ParseException(
        `Maximum parser nesting depth exceeded (${MAX_PARSER_DEPTH})`,
        line,
        column,
      );
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.depth--;
    };
  }
}
