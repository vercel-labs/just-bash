import { ExecutionLimitError } from "./errors.js";
import { cloneArray } from "./helpers/array.js";
import type { InterpreterContext, TemporaryBinding } from "./types.js";

/** Child scopes may remove bindings independently; saved arrays stay borrowed until release. */
export function cloneTemporaryBindings(
  ctx: InterpreterContext,
): Map<string, TemporaryBinding>[] | undefined {
  return ctx.state.tempEnvBindings?.map((bindings) => {
    ctx.executionScope.consumeWork(bindings.size, "temporary binding copy");
    return new Map(bindings);
  });
}

/** Restore a released binding in the current shell, including its array metadata. */
export function restoreTemporaryBinding(
  ctx: InterpreterContext,
  name: string,
  binding: TemporaryBinding,
  copyArray = false,
): void {
  let array = binding.array;
  if (array && copyArray) {
    ctx.executionScope.consumeWork(array.elements.size, "prefix array release");
    array = cloneArray(array);
  }
  if (binding.scalar === undefined) ctx.state.env.delete(name);
  else ctx.state.env.set(name, binding.scalar);
  if (array) {
    ctx.state.arrays ??= new Map();
    ctx.state.arrays.set(name, array);
  } else ctx.state.arrays?.delete(name);
  if (binding.associative) {
    ctx.state.associativeArrays ??= new Set();
    ctx.state.associativeArrays.add(name);
  } else ctx.state.associativeArrays?.delete(name);
}

/** One command's persistent expansion effects and separate temporary bindings. */
export class PrefixBindings {
  readonly records: Map<string, TemporaryBinding> = new Map();
  private finishExpansion: ((commitEffects: boolean) => void) | undefined;
  private published = false;
  dispatched: boolean = false;

  constructor(private readonly ctx: InterpreterContext) {}

  private snapshot(name: string): TemporaryBinding {
    const array = this.ctx.state.arrays?.get(name);
    if (array)
      this.ctx.executionScope.consumeWork(
        array.elements.size,
        "prefix array snapshot",
      );
    return {
      scalar: this.ctx.state.env.get(name),
      array: array ? cloneArray(array) : undefined,
      associative: this.ctx.state.associativeArrays?.has(name) ?? false,
    };
  }

  /** Journal actual assignments, not incidental map writes or snapshot restoration. */
  beginExpansion(deferEffects = false): void {
    this.endExpansion();
    const env = this.ctx.state.env;
    const previous = this.ctx.onExpansionAssignment;
    const pending = new Map<string, Map<string | undefined, string>>();
    const recordAssignment = (
      name: string,
      value: string,
      key?: string,
    ): void => {
      previous?.(name, value, key);
      const underlying = this.records.get(name);
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
    };
    this.ctx.onExpansionAssignment = (name, value, key) => {
      // Substitutions execute on child maps. Their assignments belong to that
      // child even when the surrounding RHS shares this interpreter context.
      if (this.ctx.state.env !== env) return;
      if (!deferEffects) return recordAssignment(name, value, key);
      if (!this.records.has(name)) return;
      let writes = pending.get(name);
      if (!writes) {
        writes = new Map();
        pending.set(name, writes);
      }
      writes.set(key, value);
    };
    this.finishExpansion = (commitEffects) => {
      this.ctx.onExpansionAssignment = previous;
      if (commitEffects)
        for (const [name, writes] of pending)
          for (const [key, value] of writes) recordAssignment(name, value, key);
    };
  }

  endExpansion(commitEffects = true): void {
    const finish = this.finishExpansion;
    this.finishExpansion = undefined;
    finish?.(commitEffects);
  }

  /** Capture persistent state after the RHS and before installing its binding. */
  capture(name: string): void {
    this.endExpansion();
    if (!this.records.has(name)) {
      const snapshot = this.snapshot(name);
      this.records.set(name, snapshot);
    }
  }

  /** Assignment-only installation succeeded, so no restoration is pending. */
  retain(name: string): void {
    this.records.delete(name);
  }

  beginDispatch(): void {
    // unset uses this stack to reveal the variable beneath a command's prefix.
    if (this.records.size > 0) {
      this.ctx.state.tempEnvBindings ??= [];
      this.ctx.state.tempEnvBindings.push(this.records);
      this.published = true;
    }
    this.dispatched = true;
  }

  finish(policy: "retain" | "restore"): void {
    this.endExpansion();
    if (policy === "restore") {
      for (const [name, snapshot] of this.records) {
        if (this.dispatched && this.ctx.state.fullyUnsetLocals?.has(name))
          continue;
        restoreTemporaryBinding(this.ctx, name, snapshot);
      }
    }
    for (const name of this.records.keys())
      this.ctx.state.tempExportedVars?.delete(name);
    if (this.published) this.ctx.state.tempEnvBindings?.pop();
  }
}
