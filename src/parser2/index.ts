/**
 * Parser Module
 *
 * Exports the lexer, parser, and related types for parsing bash scripts.
 */

export type { Token } from "./lexer.js";
export { Lexer, TokenType } from "./lexer.js";
export type { ParseError } from "./parser.js";
export { ParseException, Parser, parse } from "./parser.js";
