/**
 * Conditional Expression Parser
 *
 * Handles parsing of [[ ... ]] conditional commands.
 */

import type {
  CondBinaryOperator,
  ConditionalExpressionNode,
  CondUnaryOperator,
} from "../ast/types.js";
import { TokenType } from "./lexer.js";
import type { Parser } from "./parser.js";

// Unary operators for conditional expressions
const UNARY_OPS = [
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

// Binary operators for conditional expressions
const BINARY_OPS = [
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

export function parseConditionalExpression(
  p: Parser,
): ConditionalExpressionNode {
  // Skip leading newlines inside [[ ]]
  p.skipNewlines();
  return parseCondOr(p);
}

function parseCondOr(p: Parser): ConditionalExpressionNode {
  let left = parseCondAnd(p);

  // Skip newlines before ||
  p.skipNewlines();
  while (p.check(TokenType.OR_OR)) {
    p.advance();
    // Skip newlines after ||
    p.skipNewlines();
    const right = parseCondAnd(p);
    left = { type: "CondOr", left, right };
    p.skipNewlines();
  }

  return left;
}

function parseCondAnd(p: Parser): ConditionalExpressionNode {
  let left = parseCondNot(p);

  // Skip newlines before &&
  p.skipNewlines();
  while (p.check(TokenType.AND_AND)) {
    p.advance();
    // Skip newlines after &&
    p.skipNewlines();
    const right = parseCondNot(p);
    left = { type: "CondAnd", left, right };
    p.skipNewlines();
  }

  return left;
}

function parseCondNot(p: Parser): ConditionalExpressionNode {
  p.skipNewlines();
  if (p.check(TokenType.BANG)) {
    p.advance();
    p.skipNewlines();
    const operand = parseCondNot(p);
    return { type: "CondNot", operand };
  }

  return parseCondPrimary(p);
}

function parseCondPrimary(p: Parser): ConditionalExpressionNode {
  // Handle grouping: ( expr )
  if (p.check(TokenType.LPAREN)) {
    p.advance();
    const expression = parseConditionalExpression(p);
    p.expect(TokenType.RPAREN);
    return { type: "CondGroup", expression };
  }

  // Handle unary operators: -f file, -z string, etc.
  if (p.isWord()) {
    const firstToken = p.current();
    const first = firstToken.value;

    // Check for unary operators - only if NOT quoted
    // Quoted '-f' etc. are string operands, not test operators
    if (UNARY_OPS.includes(first) && !firstToken.quoted) {
      p.advance();
      // Unary operators require an operand - syntax error if at end
      if (p.check(TokenType.DBRACK_END)) {
        p.error(`Expected operand after ${first}`);
      }
      if (p.isWord()) {
        const operand = p.parseWord();
        return {
          type: "CondUnary",
          operator: first as CondUnaryOperator,
          operand,
        };
      }
    }

    // Parse as word, then check for binary operator
    const left = p.parseWord();

    // Check for binary operators
    if (p.isWord() && BINARY_OPS.includes(p.current().value)) {
      const operator = p.advance().value;
      const right = p.parseWord();
      return {
        type: "CondBinary",
        operator: operator as CondBinaryOperator,
        left,
        right,
      };
    }

    // Check for < and > which are tokenized as LESS and GREAT
    if (p.check(TokenType.LESS)) {
      p.advance();
      const right = p.parseWord();
      return {
        type: "CondBinary",
        operator: "<",
        left,
        right,
      };
    }
    if (p.check(TokenType.GREAT)) {
      p.advance();
      const right = p.parseWord();
      return {
        type: "CondBinary",
        operator: ">",
        left,
        right,
      };
    }

    // Check for = (assignment/equality in test)
    if (p.isWord() && p.current().value === "=") {
      p.advance();
      const right = p.parseWord();
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

  p.error("Expected conditional expression");
}
