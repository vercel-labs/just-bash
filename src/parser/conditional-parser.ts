/**
 * Conditional Expression Parser
 *
 * Handles parsing of [[ ... ]] conditional commands.
 */

import type {
  CondBinaryOperator,
  ConditionalExpressionNode,
  CondUnaryOperator,
  WordNode,
  WordPart,
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
        const operand = p.parseWordNoBraceExpansion();
        return {
          type: "CondUnary",
          operator: first as CondUnaryOperator,
          operand,
        };
      }
      // Unary operator followed by non-word token (like < > && ||) is a syntax error
      // bash: "unexpected argument `<' to conditional unary operator"
      const badToken = p.current();
      p.error(
        `unexpected argument \`${badToken.value}' to conditional unary operator`,
      );
    }

    // Parse as word, then check for binary operator
    const left = p.parseWordNoBraceExpansion();

    // Check for binary operators
    if (p.isWord() && BINARY_OPS.includes(p.current().value)) {
      const operator = p.advance().value;
      // For =~ operator, the RHS can include unquoted ( and ) for regex grouping
      // Parse until we hit ]], &&, ||, or newline
      const right =
        operator === "=~"
          ? parseRegexPattern(p)
          : p.parseWordNoBraceExpansion();
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
      const right = p.parseWordNoBraceExpansion();
      return {
        type: "CondBinary",
        operator: "<",
        left,
        right,
      };
    }
    if (p.check(TokenType.GREAT)) {
      p.advance();
      const right = p.parseWordNoBraceExpansion();
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
      const right = p.parseWordNoBraceExpansion();
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

/**
 * Parse a regex pattern for the =~ operator.
 * In bash, the RHS of =~ can include unquoted ( and ) for regex grouping.
 * We collect tokens until we hit ]], &&, ||, or newline.
 *
 * Important rules:
 * - Track parenthesis depth to distinguish between regex grouping and conditional grouping
 * - At the top level (parenDepth === 0), tokens must be adjacent (no spaces)
 * - Inside parentheses (parenDepth > 0), spaces are allowed
 * - This matches bash behavior: "[[ a =~ c a ]]" is a syntax error,
 *   but "[[ a =~ (c a) ]]" is valid
 */
function parseRegexPattern(p: Parser): WordNode {
  const parts: WordPart[] = [];
  let parenDepth = 0; // Track nested parens in the regex pattern
  let lastTokenEnd = -1; // Track end position of last consumed token

  // Helper to check if we're at a pattern terminator
  const isTerminator = () =>
    p.check(TokenType.DBRACK_END) ||
    p.check(TokenType.AND_AND) ||
    p.check(TokenType.OR_OR) ||
    p.check(TokenType.NEWLINE) ||
    p.check(TokenType.EOF);

  while (!isTerminator()) {
    const currentToken = p.current();
    const hasGap = lastTokenEnd >= 0 && currentToken.start > lastTokenEnd;

    // At top level (outside parens), tokens must be adjacent (no space gap)
    // Inside parens, spaces are allowed (regex groups can contain spaces)
    if (parenDepth === 0 && hasGap) {
      // There's a gap (whitespace) between the last token and this one
      // Stop parsing - remaining tokens will cause a syntax error
      break;
    }

    // Inside parens, preserve the space as a literal space in the pattern
    if (parenDepth > 0 && hasGap) {
      parts.push({ type: "Literal", value: " " });
    }

    if (p.isWord()) {
      // Parse word parts (this handles $var, etc.)
      const word = p.parseWordNoBraceExpansion();
      parts.push(...word.parts);
      // After parseWord, position has advanced - get the consumed token's end
      lastTokenEnd = p.peek(-1).end;
    } else if (p.check(TokenType.LPAREN)) {
      // Unquoted ( in regex pattern - part of regex grouping
      const token = p.advance();
      parts.push({ type: "Literal", value: "(" });
      parenDepth++;
      lastTokenEnd = token.end;
    } else if (p.check(TokenType.RPAREN)) {
      // Unquoted ) - could be regex grouping or conditional expression grouping
      if (parenDepth > 0) {
        // We have an open paren from the regex, this ) closes it
        const token = p.advance();
        parts.push({ type: "Literal", value: ")" });
        parenDepth--;
        lastTokenEnd = token.end;
      } else {
        // No open regex parens - this ) is part of the conditional expression
        // Stop parsing the regex pattern here
        break;
      }
    } else if (p.check(TokenType.PIPE)) {
      // Unquoted | in regex pattern - regex alternation (foo|bar)
      const token = p.advance();
      parts.push({ type: "Literal", value: "|" });
      lastTokenEnd = token.end;
    } else {
      // Unknown token, stop parsing
      break;
    }
  }

  if (parts.length === 0) {
    p.error("Expected regex pattern after =~");
  }

  return { type: "Word", parts };
}
