/**
 * State Cloning Helper
 *
 * Extracts the state save/clone/restore pattern from subshell execution
 * into a reusable helper. Used by both subshells and background jobs.
 */

import type { InterpreterContext } from "./types.js";

/**
 * Save and clone interpreter state for isolated execution (subshells, background jobs).
 * Returns a restore function that reverts all cloned state to the original values.
 *
 * Clones: env, cwd, options, functions, localScopes, localVarStack,
 * localVarDepth, fullyUnsetLocals, loopDepth, parentHasLoopContext,
 * lastArg, groupStdin, bashPid.
 */
export function cloneStateForSubshell(
  ctx: InterpreterContext,
  stdin?: string,
): { restore: () => void } {
  const savedEnv = new Map(ctx.state.env);
  const savedCwd = ctx.state.cwd;
  const savedOptions = { ...ctx.state.options };
  const savedFunctions = new Map(ctx.state.functions);

  // Save local variable scoping state
  const savedLocalScopes = ctx.state.localScopes;
  const savedLocalVarStack = ctx.state.localVarStack;
  const savedLocalVarDepth = ctx.state.localVarDepth;
  const savedFullyUnsetLocals = ctx.state.fullyUnsetLocals;

  // Deep copy the local scoping structures
  ctx.state.localScopes = savedLocalScopes.map((scope) => new Map(scope));
  if (savedLocalVarStack) {
    ctx.state.localVarStack = new Map();
    for (const [name, stack] of savedLocalVarStack.entries()) {
      ctx.state.localVarStack.set(
        name,
        stack.map((entry) => ({ ...entry })),
      );
    }
  }
  if (savedLocalVarDepth) {
    ctx.state.localVarDepth = new Map(savedLocalVarDepth);
  }
  if (savedFullyUnsetLocals) {
    ctx.state.fullyUnsetLocals = new Map(savedFullyUnsetLocals);
  }

  // Reset loopDepth and track parent context
  const savedLoopDepth = ctx.state.loopDepth;
  const savedParentHasLoopContext = ctx.state.parentHasLoopContext;
  ctx.state.parentHasLoopContext = savedLoopDepth > 0;
  ctx.state.loopDepth = 0;

  // Save $_ (last argument)
  const savedLastArg = ctx.state.lastArg;

  // Subshells get a new BASHPID
  const savedBashPid = ctx.state.bashPid;
  ctx.state.bashPid = ctx.state.nextVirtualPid++;

  // Save and set groupStdin
  const savedGroupStdin = ctx.state.groupStdin;
  if (stdin) {
    ctx.state.groupStdin = stdin;
  }

  const restore = (): void => {
    ctx.state.env = savedEnv;
    ctx.state.cwd = savedCwd;
    ctx.state.options = savedOptions;
    ctx.state.functions = savedFunctions;
    ctx.state.localScopes = savedLocalScopes;
    ctx.state.localVarStack = savedLocalVarStack;
    ctx.state.localVarDepth = savedLocalVarDepth;
    ctx.state.fullyUnsetLocals = savedFullyUnsetLocals;
    ctx.state.loopDepth = savedLoopDepth;
    ctx.state.parentHasLoopContext = savedParentHasLoopContext;
    ctx.state.groupStdin = savedGroupStdin;
    ctx.state.bashPid = savedBashPid;
    ctx.state.lastArg = savedLastArg;
  };

  return { restore };
}

/**
 * Snapshot the current interpreter state into a standalone copy suitable for
 * a background job (which gets its own Interpreter instance).
 *
 * Unlike cloneStateForSubshell (which mutates in-place and returns a restore
 * function), this returns a fresh InterpreterState that shares no mutable
 * references with the parent.
 */
export function snapshotStateForBackground(
  ctx: InterpreterContext,
): typeof ctx.state {
  const state = ctx.state;

  // Deep-copy local scoping structures
  const localScopes = state.localScopes.map((scope) => new Map(scope));

  let localVarStack = state.localVarStack;
  if (localVarStack) {
    const newStack = new Map<
      string,
      Array<{ value: string | undefined; scopeIndex: number }>
    >();
    for (const [name, stack] of localVarStack.entries()) {
      newStack.set(
        name,
        stack.map((entry) => ({ ...entry })),
      );
    }
    localVarStack = newStack;
  }

  return {
    ...state,
    env: new Map(state.env),
    functions: new Map(state.functions),
    options: { ...state.options },
    shoptOptions: { ...state.shoptOptions },
    localScopes,
    localVarStack,
    localVarDepth: state.localVarDepth
      ? new Map(state.localVarDepth)
      : undefined,
    fullyUnsetLocals: state.fullyUnsetLocals
      ? new Map(state.fullyUnsetLocals)
      : undefined,
    // Reset loop depth — background job is not inside any loop
    loopDepth: 0,
    parentHasLoopContext: false,
    // New BASHPID for the background job
    bashPid: state.nextVirtualPid++,
    // Clear groupStdin — background job doesn't inherit piped stdin
    groupStdin: undefined,
    // File descriptors get their own copy
    fileDescriptors: state.fileDescriptors
      ? new Map(state.fileDescriptors)
      : undefined,
    // Hash table can be shared (read-only lookups)
    hashTable: state.hashTable ? new Map(state.hashTable) : undefined,
  };
}
