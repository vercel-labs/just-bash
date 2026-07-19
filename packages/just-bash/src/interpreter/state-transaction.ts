import { cloneArrays } from "./helpers/array.js";
import type { CompletionSpec, InterpreterState, ShellArray } from "./types.js";

function cloneCompletionSpec(
  spec: CompletionSpec | undefined,
): CompletionSpec | undefined {
  return spec
    ? {
        ...spec,
        options: spec.options ? [...spec.options] : undefined,
        actions: spec.actions ? [...spec.actions] : undefined,
      }
    : undefined;
}

function cloneCompletionSpecs(
  specs: Map<string, CompletionSpec> | undefined,
): Map<string, CompletionSpec> | undefined {
  return specs
    ? new Map(
        Array.from(specs, ([name, spec]) => [
          name,
          cloneCompletionSpec(spec) as CompletionSpec,
        ]),
      )
    : undefined;
}

function cloneLocalArrayScopes(
  scopes: Map<string, ShellArray | undefined>[] | undefined,
): Map<string, ShellArray | undefined>[] | undefined {
  return scopes?.map(
    (scope) =>
      new Map(
        Array.from(scope, ([name, array]) => [
          name,
          array
            ? { kind: array.kind, elements: new Map(array.elements) }
            : undefined,
        ]),
      ),
  );
}

function cloneLocalVarStack(
  stack:
    | Map<string, Array<{ value: string | undefined; scopeIndex: number }>>
    | undefined,
): typeof stack {
  return stack
    ? new Map(
        Array.from(stack, ([name, entries]) => [
          name,
          entries.map((entry) => ({ ...entry })),
        ]),
      )
    : undefined;
}

/**
 * Install an isolated copy of mutable shell namespace state and return an
 * idempotent rollback. Process-wide accounting and PID allocation deliberately
 * remain shared with the parent execution.
 */
export function beginIsolatedShellState(state: InterpreterState): () => void {
  const saved = {
    env: state.env,
    arrays: state.arrays,
    cwd: state.cwd,
    previousDir: state.previousDir,
    lastExitCode: state.lastExitCode,
    lastArg: state.lastArg,
    currentLine: state.currentLine,
    options: state.options,
    shoptOptions: state.shoptOptions,
    fileDescriptors: state.fileDescriptors,
    nextFd: state.nextFd,
    readonlyVars: state.readonlyVars,
    associativeArrays: state.associativeArrays,
    namerefs: state.namerefs,
    boundNamerefs: state.boundNamerefs,
    invalidNamerefs: state.invalidNamerefs,
    integerVars: state.integerVars,
    lowercaseVars: state.lowercaseVars,
    uppercaseVars: state.uppercaseVars,
    exportedVars: state.exportedVars,
    tempExportedVars: state.tempExportedVars,
    localExportedVars: state.localExportedVars,
    declaredVars: state.declaredVars,
    localScopes: state.localScopes,
    localArrayScopes: state.localArrayScopes,
    localVarDepth: state.localVarDepth,
    localVarStack: state.localVarStack,
    fullyUnsetLocals: state.fullyUnsetLocals,
    tempEnvBindings: state.tempEnvBindings,
    mutatedTempEnvVars: state.mutatedTempEnvVars,
    accessedTempEnvVars: state.accessedTempEnvVars,
    functions: state.functions,
    callDepth: state.callDepth,
    sourceDepth: state.sourceDepth,
    callLineStack: state.callLineStack,
    funcNameStack: state.funcNameStack,
    sourceStack: state.sourceStack,
    currentSource: state.currentSource,
    inCondition: state.inCondition,
    loopDepth: state.loopDepth,
    parentHasLoopContext: state.parentHasLoopContext,
    errexitSafe: state.errexitSafe,
    directoryStack: state.directoryStack,
    hashTable: state.hashTable,
    completionSpecs: state.completionSpecs,
    defaultCompletionSpec: state.defaultCompletionSpec,
    emptyCompletionSpec: state.emptyCompletionSpec,
    groupStdin: state.groupStdin,
    bashPid: state.bashPid,
    expansionExitCode: state.expansionExitCode,
    expansionStderr: state.expansionStderr,
  };

  state.env = new Map(state.env);
  state.arrays = cloneArrays(state.arrays);
  state.options = { ...state.options };
  state.shoptOptions = { ...state.shoptOptions };
  state.fileDescriptors = state.fileDescriptors
    ? new Map(state.fileDescriptors)
    : undefined;
  state.readonlyVars = new Set(state.readonlyVars);
  state.associativeArrays = new Set(state.associativeArrays);
  state.namerefs = new Set(state.namerefs);
  state.boundNamerefs = new Set(state.boundNamerefs);
  state.invalidNamerefs = new Set(state.invalidNamerefs);
  state.integerVars = new Set(state.integerVars);
  state.lowercaseVars = new Set(state.lowercaseVars);
  state.uppercaseVars = new Set(state.uppercaseVars);
  state.exportedVars = new Set(state.exportedVars);
  state.tempExportedVars = new Set(state.tempExportedVars);
  state.localExportedVars = state.localExportedVars?.map(
    (vars) => new Set(vars),
  );
  state.declaredVars = new Set(state.declaredVars);
  state.localScopes = state.localScopes.map((scope) => new Map(scope));
  state.localArrayScopes = cloneLocalArrayScopes(state.localArrayScopes);
  state.localVarDepth = state.localVarDepth
    ? new Map(state.localVarDepth)
    : undefined;
  state.localVarStack = cloneLocalVarStack(state.localVarStack);
  state.fullyUnsetLocals = state.fullyUnsetLocals
    ? new Map(state.fullyUnsetLocals)
    : undefined;
  state.tempEnvBindings = state.tempEnvBindings?.map(
    (bindings) => new Map(bindings),
  );
  state.mutatedTempEnvVars = state.mutatedTempEnvVars
    ? new Set(state.mutatedTempEnvVars)
    : undefined;
  state.accessedTempEnvVars = state.accessedTempEnvVars
    ? new Set(state.accessedTempEnvVars)
    : undefined;
  state.functions = new Map(state.functions);
  state.callLineStack = state.callLineStack
    ? [...state.callLineStack]
    : undefined;
  state.funcNameStack = state.funcNameStack
    ? [...state.funcNameStack]
    : undefined;
  state.sourceStack = state.sourceStack ? [...state.sourceStack] : undefined;
  state.directoryStack = state.directoryStack
    ? [...state.directoryStack]
    : undefined;
  state.hashTable = state.hashTable ? new Map(state.hashTable) : undefined;
  state.completionSpecs = cloneCompletionSpecs(state.completionSpecs);
  state.defaultCompletionSpec = cloneCompletionSpec(
    state.defaultCompletionSpec,
  );
  state.emptyCompletionSpec = cloneCompletionSpec(state.emptyCompletionSpec);

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    Object.assign(state, saved);
  };
}
