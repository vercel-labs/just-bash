/**
 * Built-in Command Handlers
 *
 * Shell built-in commands that modify interpreter state:
 * - cd: Change directory
 * - export: Set environment variables
 * - unset: Remove variables/functions
 * - exit: Exit shell
 * - local: Declare local variables in functions
 * - set: Set/unset shell options
 * - break: Exit from loops
 * - continue: Skip to next loop iteration
 * - read: Read a line of input
 * - source/.: Execute commands from a file in current environment
 */

export { handleBreak } from "./break.js";
export { handleCd } from "./cd.js";
export { handleContinue } from "./continue.js";
export { handleExit } from "./exit.js";
export { handleExport } from "./export.js";
export { handleLocal } from "./local.js";
export { handleRead } from "./read.js";
export { handleSet } from "./set.js";
export { handleSource } from "./source.js";
export { handleUnset } from "./unset.js";
