// Types

export type { BuiltinContext } from "./builtins.js";
// Builtin commands
export {
  handleCd,
  handleExit,
  handleExport,
  handleLocal,
  handleUnset,
  handleVariableAssignment,
} from "./builtins.js";
// Case statements
export {
  executeCaseStatement,
  matchCasePattern,
  parseCaseStatement,
} from "./case-statement.js";
// Control flow
export {
  executeForLoop,
  executeIfStatement,
  executeUntilLoop,
  executeWhileLoop,
  parseIfStatement,
} from "./control-flow.js";
export type { ExpansionContext } from "./expansion.js";
// Variable and arithmetic expansion
export {
  evalArithmeticExpr,
  evaluateArithmetic,
  expandVariablesAsync,
  expandVariablesSync,
  findMatchingDoubleParen,
  findMatchingParen,
} from "./expansion.js";
export type { HereDocContext } from "./here-document.js";

// Here documents
export { executeWithHereDoc } from "./here-document.js";
// Test expressions
export {
  evaluateBinaryTest,
  evaluateTestExpr,
  evaluateTopLevelTest,
  evaluateUnaryTest,
  handleTestExpression,
  matchPattern,
  tokenizeTestExpr,
} from "./test-expression.js";
export type { InterpreterContext } from "./types.js";
