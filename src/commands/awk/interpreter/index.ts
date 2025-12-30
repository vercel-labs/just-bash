/**
 * AWK Interpreter Module
 *
 * Re-exports the public API for the AWK interpreter.
 */

export { AwkInterpreter } from "./interpreter.js";
export {
  createRuntimeContext,
  type AwkRuntimeContext,
  type CreateContextOptions,
} from "./context.js";
export { type AwkFileSystem, type AwkValue } from "./types.js";
export { evalExpr } from "./expressions.js";
export { executeBlock, executeStmt } from "./statements.js";
export {
  isTruthy,
  toNumber,
  toString,
  looksLikeNumber,
  matchRegex,
} from "./helpers.js";
