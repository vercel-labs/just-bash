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
export { handleCompgen } from "./compgen.js";
export { handleComplete } from "./complete.js";
export { handleCompopt } from "./compopt.js";
export { handleContinue } from "./continue.js";
export {
  applyCaseTransform,
  handleDeclare,
  handleReadonly,
  isInteger,
} from "./declare.js";
export { handleDirs, handlePopd, handlePushd } from "./dirs.js";
export { handleEval } from "./eval.js";
export { handleExit } from "./exit.js";
export { handleExport } from "./export.js";
export { handleGetopts } from "./getopts.js";
export { handleHash } from "./hash.js";
export { handleHelp } from "./help.js";
export { handleLet } from "./let.js";
export { handleLocal } from "./local.js";
export { handleMapfile } from "./mapfile.js";
export { handleRead } from "./read.js";
export { handleReturn } from "./return.js";
export { handleSet } from "./set.js";
export { handleShift } from "./shift.js";
export { handleSource } from "./source.js";
export { handleUnset } from "./unset.js";
export { getLocalVarDepth } from "./variable-helpers.js";
