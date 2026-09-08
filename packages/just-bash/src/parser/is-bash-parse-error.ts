import { ArithmeticError } from "../interpreter/errors.js";
import { LexerError } from "./lexer.js";
import { ParseException } from "./types.js";

export const isBashParseError = (error: unknown): error is Error =>
  error instanceof ParseException ||
  error instanceof LexerError ||
  error instanceof ArithmeticError;
