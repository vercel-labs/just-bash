/**
 * AWK Interpreter Module
 *
 * Re-exports the public API for the AWK interpreter.
 */

export {
  type AwkRuntimeContext,
  type CreateContextOptions,
  createRuntimeContext,
} from "./context.js";
export { evalExpr } from "./expressions.js";
export {
  isTruthy,
  looksLikeNumber,
  matchRegex,
  toNumber,
  toString,
} from "./helpers.js";
export { AwkInterpreter } from "./interpreter.js";
export { executeBlock, executeStmt } from "./statements.js";
export type { AwkFileSystem, AwkValue } from "./types.js";
