import type { CommandExecutionScope } from "./builtin-dispatch.js";
import { ExecutionLimitError } from "./errors.js";
import { cloneArray, cloneArrays } from "./helpers/array.js";
import type { InterpreterContext, ShellArray } from "./types.js";

type VariableSnapshot = {
  scalar: string | undefined;
  array: ShellArray | undefined;
  associative: boolean;
};

/** One command's persistent expansion effects and separate temporary bindings. */
export class PrefixBindings {
  readonly values: Map<string, string | undefined> = new Map();
  private readonly underlying = new Map<string, VariableSnapshot>();
  private finishExpansion: (() => void) | undefined;
  private restoreChildEnvironment: (() => void) | undefined;
  dispatched: boolean = false;

  constructor(
    private readonly ctx: InterpreterContext,
    private readonly scope: CommandExecutionScope,
  ) {}

  private snapshot(name: string): VariableSnapshot {
    const array = this.ctx.state.arrays?.get(name);
    return {
      scalar: this.ctx.state.env.get(name),
      array: array ? cloneArray(array) : undefined,
      associative: this.ctx.state.associativeArrays?.has(name) ?? false,
    };
  }

  private restore(name: string, snapshot: VariableSnapshot): void {
    if (snapshot.scalar === undefined) this.ctx.state.env.delete(name);
    else this.ctx.state.env.set(name, snapshot.scalar);
    if (snapshot.array) {
      this.ctx.state.arrays ??= new Map();
      this.ctx.state.arrays.set(name, cloneArray(snapshot.array));
    } else this.ctx.state.arrays?.delete(name);
    if (snapshot.associative) {
      this.ctx.state.associativeArrays ??= new Set();
      this.ctx.state.associativeArrays.add(name);
    } else this.ctx.state.associativeArrays?.delete(name);
  }

  /** Journal actual assignments, not incidental map writes or snapshot restoration. */
  beginExpansion(commandBindings?: Map<string, VariableSnapshot>): void {
    this.endExpansion();
    const env = this.ctx.state.env;
    const previous = this.ctx.onExpansionAssignment;
    this.ctx.onExpansionAssignment = (name, value, key) => {
      // Substitutions execute on child maps. Their assignments belong to that
      // child even when the surrounding RHS shares this interpreter context.
      if (this.ctx.state.env !== env) return;
      previous?.(name, value, key);
      const underlying = this.underlying.get(name);
      if (!underlying) return;
      if (key === undefined) underlying.scalar = value;
      else {
        underlying.array ??= {
          kind: this.ctx.state.arrays?.get(name)?.kind ?? "indexed",
          elements: new Map(),
        };
        // The temporary array can be smaller than the persistent array receiving
        // this effect. Enforce that owner's bound before adding a hidden key.
        if (
          !underlying.array.elements.has(key) &&
          underlying.array.elements.size >= this.ctx.limits.maxArrayElements
        )
          throw new ExecutionLimitError(
            `array element limit exceeded (${this.ctx.limits.maxArrayElements})`,
            "array_elements",
          );
        underlying.array.elements.set(key, value);
      }
      this.values.set(name, underlying.scalar);
      // A function receives redirection assignments in the same shell scope.
      // Builtins receive the independently staged prefix bindings instead.
      if (commandBindings?.has(name))
        commandBindings.set(name, this.snapshot(name));
    };
    this.finishExpansion = () => {
      this.ctx.onExpansionAssignment = previous;
    };
  }

  endExpansion(): void {
    const finish = this.finishExpansion;
    this.finishExpansion = undefined;
    finish?.();
  }

  /** Capture persistent state after the RHS and before installing its binding. */
  capture(name: string): void {
    this.endExpansion();
    if (!this.underlying.has(name)) {
      const snapshot = this.snapshot(name);
      this.underlying.set(name, snapshot);
      this.values.set(name, snapshot.scalar);
    }
  }

  /** Select redirection ownership before expanding any redirection target. */
  prepareRedirections(): () => void {
    this.endExpansion();
    const commandBindings = new Map<string, VariableSnapshot>();
    for (const [name, underlying] of this.underlying) {
      commandBindings.set(name, this.snapshot(name));
      this.restore(name, underlying);
    }
    if (this.scope === "external") {
      const env = this.ctx.state.env;
      const arrays = this.ctx.state.arrays;
      this.ctx.state.env = new Map(env);
      this.ctx.state.arrays = cloneArrays(arrays);
      const previousAssignmentScope = this.ctx.shellAssignmentScope;
      const assignmentState = { ...this.ctx.state, env, arrays };
      this.ctx.shellAssignmentScope = {
        env: this.ctx.state.env,
        state: assignmentState,
      };
      this.restoreChildEnvironment = () => {
        this.ctx.shellAssignmentScope = previousAssignmentScope;
        this.ctx.state.env = env;
        this.ctx.state.arrays = assignmentState.arrays;
      };
    } else if (commandBindings.size > 0) {
      this.beginExpansion(
        this.scope === "function" ? commandBindings : undefined,
      );
    }
    return () => {
      this.endExpansion();
      for (const [name, snapshot] of commandBindings)
        this.restore(name, snapshot);
    };
  }

  beginDispatch(): void {
    // unset uses this stack to reveal the variable beneath a command's prefix.
    if (this.values.size > 0) {
      this.ctx.state.tempEnvBindings ??= [];
      this.ctx.state.tempEnvBindings.push(new Map(this.values));
    }
    this.dispatched = true;
  }

  finish(policy: "retain" | "restore"): void {
    this.endExpansion();
    this.restoreChildEnvironment?.();
    if (policy === "restore") {
      for (const [name, snapshot] of this.underlying) {
        if (this.dispatched && this.ctx.state.fullyUnsetLocals?.has(name))
          continue;
        this.restore(name, snapshot);
      }
    }
    for (const name of this.values.keys())
      this.ctx.state.tempExportedVars?.delete(name);
    if (this.dispatched && this.values.size > 0)
      this.ctx.state.tempEnvBindings?.pop();
  }
}
