/**
 * Built-in Command Handlers
 *
 * Shell built-in commands that modify interpreter state:
 * - cd: Change directory
 * - declare/typeset: Declare variables with attributes
 * - export: Set environment variables
 * - unset: Remove variables/functions
 * - exit: Exit shell
 * - local: Declare local variables in functions
 * - readonly: Declare readonly variables
 * - set: Set/unset shell options
 * - break: Exit from loops
 * - continue: Skip to next loop iteration
 * - return: Return from a function
 * - eval: Execute arguments as a shell command
 * - let: Evaluate arithmetic expressions
 * - shift: Shift positional parameters
 * - read: Read a line of input
 * - source/.: Execute commands from a file in current environment
 */

export { handleBreak } from "./break.js";
export { handleCd } from "./cd.js";
export { handleContinue } from "./continue.js";
export { handleDeclare, handleReadonly } from "./declare.js";
export { handleEval } from "./eval.js";
export { handleExit } from "./exit.js";
export { handleExport } from "./export.js";
export { handleLet } from "./let.js";
export { handleLocal } from "./local.js";
export { handleRead } from "./read.js";
export { handleReturn } from "./return.js";
export { handleSet } from "./set.js";
export { handleShift } from "./shift.js";
export { handleSource } from "./source.js";
export { handleUnset } from "./unset.js";
