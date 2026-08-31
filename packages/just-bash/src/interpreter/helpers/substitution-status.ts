/**
 * Exit-status bookkeeping for command substitutions.
 */

import type { RedirectionNode } from "../../ast/types.js";
import type { InterpreterState } from "../types.js";

/**
 * Record the exit status of a command substitution.
 *
 * `$?` and the "a substitution ran here" marker have to move together: a
 * command with no command word (`x=1`, `> file`, an expansion that came out
 * empty) reports the status of the last substitution that ran inside it, and
 * 0 when none did. Setting `lastExitCode` without the marker leaves such a
 * command reporting the *previous* command's status instead.
 */
export function recordSubstitutionExit(
  state: InterpreterState,
  exitCode: number,
): void {
  state.lastExitCode = exitCode;
  state.env.set("?", String(exitCode));
  state.lastSubstitutionExitCode = exitCode;
}

/** Does this redirection put something on fd 0? */
function redirectsStdin(redirection: RedirectionNode): boolean {
  switch (redirection.operator) {
    case "<":
    case "<&":
    case "<<":
    case "<<-":
    case "<<<":
    case "<>":
      // Input operators default to fd 0 when no fd is written.
      return redirection.fd === null || redirection.fd === 0;
    default:
      return false;
  }
}

/**
 * The status bash gives a command that has no command word.
 *
 * It is the status of the last command substitution performed while expanding
 * the command — assigned values and redirection words alike, in that order —
 * and 0 when no substitution ran. A bare `x=1` is therefore 0 rather than
 * whatever the previous command left in `$?`.
 *
 * A redirection onto fd 0 overrides all of that with 0. bash performs the
 * redirections of a null command in a forked child when one of them reads
 * stdin (`execute_null_command`'s `forcefork`), so the shell reports the
 * child's status and any substitution in the words is discarded:
 * `x=$(exit 7) < /dev/null` is 0, while `x=$(exit 7) 3< /dev/null` is 7.
 *
 * Verified against GNU bash 5.3. bash 3.2 predates the fork and reports 7 for
 * both; this follows 5.x, which is what the comparison fixtures are recorded
 * against.
 */
export function nullCommandExitStatus(
  state: InterpreterState,
  redirections: readonly RedirectionNode[],
): number {
  if (redirections.some(redirectsStdin)) {
    return 0;
  }
  return state.lastSubstitutionExitCode ?? 0;
}
