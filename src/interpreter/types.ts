/**
 * Interpreter Types
 */

import type {
  CommandNode,
  FunctionDefNode,
  ScriptNode,
  StatementNode,
} from "../ast/types.js";
import type { IFileSystem } from "../fs/interface.js";
import type { ExecutionLimits } from "../limits.js";
import type { SecureFetch } from "../network/index.js";
import type { CommandRegistry, ExecResult, TraceCallback } from "../types.js";

/**
 * Completion specification for a command, set by the `complete` builtin.
 */
export interface CompletionSpec {
  /** Word list for -W option */
  wordlist?: string;
  /** Function name for -F option */
  function?: string;
  /** Command to run for -C option */
  command?: string;
  /** Completion options (nospace, filenames, etc.) */
  options?: string[];
  /** Actions to perform (from -A option) */
  actions?: string[];
  /** Whether this is a default completion (-D) */
  isDefault?: boolean;
}

export interface ShellOptions {
  /** set -e: Exit immediately if a command exits with non-zero status */
  errexit: boolean;
  /** set -o pipefail: Return the exit status of the last (rightmost) command in a pipeline that fails */
  pipefail: boolean;
  /** set -u: Treat unset variables as an error when substituting */
  nounset: boolean;
  /** set -x: Print commands and their arguments as they are executed */
  xtrace: boolean;
  /** set -v: Print shell input lines as they are read (verbose) */
  verbose: boolean;
  /** set -o posix: POSIX mode for stricter compliance */
  posix: boolean;
  /** set -a: Export all variables */
  allexport: boolean;
  /** set -C: Prevent overwriting files with redirection */
  noclobber: boolean;
  /** set -f: Disable filename expansion (globbing) */
  noglob: boolean;
  /** set -n: Read commands but do not execute them (syntax check mode) */
  noexec: boolean;
  /** set -o vi: Use vi-style line editing (mutually exclusive with emacs) */
  vi: boolean;
  /** set -o emacs: Use emacs-style line editing (mutually exclusive with vi) */
  emacs: boolean;
}

export interface ShoptOptions {
  /** shopt -s extglob: Enable extended globbing patterns @(), *(), +(), ?(), !() */
  extglob: boolean;
  /** shopt -s dotglob: Include dotfiles in glob expansion */
  dotglob: boolean;
  /** shopt -s nullglob: Return empty for non-matching globs instead of literal pattern */
  nullglob: boolean;
  /** shopt -s failglob: Fail if glob pattern has no matches */
  failglob: boolean;
  /** shopt -s globstar: Enable ** recursive glob patterns */
  globstar: boolean;
  /** shopt -s globskipdots: Skip . and .. in glob patterns (default: true in bash >=5.2) */
  globskipdots: boolean;
  /** shopt -s nocaseglob: Case-insensitive glob matching */
  nocaseglob: boolean;
  /** shopt -s nocasematch: Case-insensitive pattern matching in [[ ]] and case */
  nocasematch: boolean;
  /** shopt -s expand_aliases: Enable alias expansion */
  expand_aliases: boolean;
  /** shopt -s lastpipe: Run last command of pipeline in current shell context */
  lastpipe: boolean;
  /** shopt -s xpg_echo: Make echo interpret backslash escapes by default (like echo -e) */
  xpg_echo: boolean;
}

export interface InterpreterState {
  env: Record<string, string>;
  cwd: string;
  previousDir: string;
  functions: Map<string, FunctionDefNode>;
  localScopes: Map<string, string | undefined>[];
  callDepth: number;
  /** Current source script nesting depth (for return in sourced scripts) */
  sourceDepth: number;
  commandCount: number;
  lastExitCode: number;
  /** Last argument of previous command, for $_ expansion */
  lastArg: string;
  /** Time when shell started (for $SECONDS) */
  startTime: number;
  /** PID of last background job (for $!) */
  lastBackgroundPid: number;
  /** Current BASHPID (changes in subshells, unlike $$) */
  bashPid: number;
  /** Counter for generating unique virtual PIDs for subshells */
  nextVirtualPid: number;
  /** Current line number being executed (for $LINENO) */
  currentLine: number;
  /** Shell options (set -e, etc.) */
  options: ShellOptions;
  /** Shopt options (shopt -s, etc.) */
  shoptOptions: ShoptOptions;
  /** True when executing condition for if/while/until (errexit doesn't apply) */
  inCondition: boolean;
  /** Current loop nesting depth (for break/continue) */
  loopDepth: number;
  /** True if this subshell was spawned from within a loop context (for break/continue to exit subshell) */
  parentHasLoopContext?: boolean;
  /** Stdin available for commands in compound commands (groups, subshells, while loops with piped input) */
  groupStdin?: string;
  /** Completion specifications set by the `complete` builtin */
  completionSpecs?: Map<string, CompletionSpec>;
  /** Set of variable names that are readonly */
  readonlyVars?: Set<string>;
  /** Exit code from expansion errors (arithmetic, etc.) - overrides command exit code */
  expansionExitCode?: number;
  /** Stderr from expansion errors */
  expansionStderr?: string;
  /** Set of variable names that are associative arrays */
  associativeArrays?: Set<string>;
  /** Directory stack for pushd/popd/dirs */
  directoryStack?: string[];
  /** Set of variable names that are namerefs (declare -n) */
  namerefs?: Set<string>;
  /**
   * Set of nameref variable names that were "bound" to valid targets at creation time.
   * A bound nameref will always resolve through to its target, even if the target
   * is later unset. An unbound nameref (target didn't exist at creation) acts like
   * a regular variable, returning its raw value.
   */
  boundNamerefs?: Set<string>;
  /**
   * Set of nameref variable names that were created with an invalid target.
   * Invalid namerefs always read/write their value directly, never resolving.
   * For example, after `ref=1; typeset -n ref`, ref has an invalid target "1".
   */
  invalidNamerefs?: Set<string>;
  /** Set of variable names that have integer attribute (declare -i) */
  integerVars?: Set<string>;
  /** Set of variable names that have lowercase attribute (declare -l) */
  lowercaseVars?: Set<string>;
  /** Set of variable names that have uppercase attribute (declare -u) */
  uppercaseVars?: Set<string>;
  /** Hash table for PATH command lookup caching */
  hashTable?: Map<string, string>;
  /** Set of exported variable names */
  exportedVars?: Set<string>;
  /** Set of temporarily exported variable names (for prefix assignments like FOO=bar cmd) */
  tempExportedVars?: Set<string>;
  /**
   * Stack of sets tracking variables exported within each local scope.
   * When a function returns and a local scope is popped, if a variable was
   * exported only in that scope (not before entering), the export attribute
   * should be removed. This enables bash's scoped export behavior where
   * `local V=x; export V` only exports the local, not the global.
   */
  localExportedVars?: Set<string>[];
  /** Set of variable names that have been declared but not assigned a value */
  declaredVars?: Set<string>;
  /** Stack of call line numbers for BASH_LINENO */
  callLineStack?: number[];
  /** Stack of function names for FUNCNAME */
  funcNameStack?: string[];
  /** Stack of source files for BASH_SOURCE (tracks where functions were defined) */
  sourceStack?: string[];
  /** Current source file context (for function definitions) */
  currentSource?: string;
  /** File descriptors for process substitution and here-docs */
  fileDescriptors?: Map<number, string>;
  /** Next available file descriptor for {varname}>file allocation (starts at 10) */
  nextFd?: number;
  /** True when the last executed statement's exit code is "safe" for errexit purposes
   *  (e.g., from a &&/|| chain where the failure wasn't the final command) */
  errexitSafe?: boolean;
  /**
   * Tracks at which call depth each local variable was declared.
   * Used for bash-specific unset scoping behavior:
   * - local-unset (same scope): value-unset (clears value, keeps local cell)
   * - dynamic-unset (different scope): cell-unset (removes local cell, exposes outer value)
   */
  localVarDepth?: Map<string, number>;
  /**
   * Stack of saved values for each local variable, supporting bash's localvar-nest behavior.
   * Each entry contains the saved (outer) value and the scope index where it was saved.
   * This allows multiple nested `local` declarations of the same variable (e.g., in nested evals)
   * to each have their own cell that can be unset independently.
   */
  localVarStack?: Map<
    string,
    Array<{ value: string | undefined; scopeIndex: number }>
  >;
  /**
   * Map of variable names to scope index where they were fully unset.
   * Used to prevent tempenv restoration after all local cells are removed.
   * Entries are cleared when their scope returns.
   */
  fullyUnsetLocals?: Map<string, number>;
  /**
   * Stack of temporary environment bindings from prefix assignments (e.g., FOO=bar cmd).
   * Each entry maps variable names to their saved (underlying) values.
   * Used for bash-specific unset behavior: when unsetting a variable that has a
   * tempenv binding, the unset should reveal the underlying value, not completely
   * remove the variable.
   */
  tempEnvBindings?: Map<string, string | undefined>[];
  /**
   * Set of tempenv variable names that have been explicitly written to within
   * the current function context (after the prefix assignment, before local).
   * Used to distinguish between "fresh" tempenvs (local-unset = value-unset)
   * and "mutated" tempenvs (local-unset reveals the mutated value).
   */
  mutatedTempEnvVars?: Set<string>;
  /**
   * Set of tempenv variable names that have been accessed (read or written)
   * within the current function context. Used to determine if a tempenv was
   * "observed" before a local declaration.
   */
  accessedTempEnvVars?: Set<string>;
  /**
   * Suppress verbose mode output (set -v) when inside command substitutions.
   * bash only prints verbose output for the main script, not for commands
   * inside $(...) or backticks.
   */
  suppressVerbose?: boolean;
}

export interface InterpreterContext {
  state: InterpreterState;
  fs: IFileSystem;
  commands: CommandRegistry;
  /** Execution limits configuration */
  limits: Required<ExecutionLimits>;
  execFn: (
    script: string,
    options?: { env?: Record<string, string>; cwd?: string },
  ) => Promise<ExecResult>;
  executeScript: (node: ScriptNode) => Promise<ExecResult>;
  executeStatement: (node: StatementNode) => Promise<ExecResult>;
  executeCommand: (node: CommandNode, stdin: string) => Promise<ExecResult>;
  /** Optional secure fetch function for network-enabled commands */
  fetch?: SecureFetch;
  /** Optional sleep function for testing with mock clocks */
  sleep?: (ms: number) => Promise<void>;
  /** Optional trace callback for performance profiling */
  trace?: TraceCallback;
}
