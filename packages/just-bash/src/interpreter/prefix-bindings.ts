import { _Proxy } from "../security/trusted-globals.js";
import type { CommandExecutionScope } from "./builtin-dispatch.js";
import { cloneArray, cloneArrays } from "./helpers/array.js";
import type { InterpreterContext, ShellArray } from "./types.js";

type VariableSnapshot = {
  scalar: string | undefined;
  array: ShellArray | undefined;
  associative: boolean;
};

/** One simple command's temporary bindings and the state underneath them. */
export class PrefixBindings {
  readonly values: Map<string, string | undefined> = new Map();
  private readonly underlying = new Map<string, VariableSnapshot>();
  private stopObserving: (() => void) | undefined;
  private restoreRedirectionScope: (() => void) | undefined;
  dispatched: boolean = false;

  constructor(private readonly ctx: InterpreterContext) {}

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

  /** Expose RHS effects during redirections, but install prefixes only on success. */
  stageForRedirections(scope: CommandExecutionScope): () => void {
    this.endExpansion();
    const staged = new Map<string, VariableSnapshot>();
    for (const [name, underlying] of this.underlying) {
      staged.set(name, this.snapshot(name));
      this.restore(name, underlying);
    }
    let mutated: Set<string> | undefined;
    if (scope === "external") {
      const env = this.ctx.state.env;
      const arrays = this.ctx.state.arrays;
      this.ctx.state.env = new Map(env);
      this.ctx.state.arrays = cloneArrays(arrays);
      this.restoreRedirectionScope = () => {
        this.ctx.state.env = env;
        this.ctx.state.arrays = arrays;
      };
    } else if (staged.size > 0) mutated = this.beginExpansion();
    return () => {
      this.endExpansion();
      for (const [name, snapshot] of staged) {
        // Functions execute in this shell and see its redirection mutations.
        // Builtins and external commands receive the staged prefix values.
        if (scope !== "function" || !mutated?.has(name))
          this.restore(name, snapshot);
      }
    };
  }

  /** Observe expansion writes, excluding temporary installation and restoration. */
  beginExpansion(): Set<string> {
    this.endExpansion();
    const mutated = new Set<string>();
    const scalarWrites = new Set<string>();
    const arrayWrites = new Set<string>();
    const elementWrites = new Map<string, Set<string>>();
    const env = this.ctx.state.env;
    const arrays = this.ctx.state.arrays;
    const observeMap = <K, V>(
      map: Map<K, V>,
      onWrite: (key: K) => void,
    ): Map<K, V> =>
      new _Proxy(map, {
        get(target, property) {
          if (property === "set")
            return (key: K, value: V) => {
              onWrite(key);
              target.set(key, value);
              return target;
            };
          if (property === "delete")
            return (key: K) => {
              onWrite(key);
              return target.delete(key);
            };
          // @banned-pattern-ignore: target is an internal Map; this observer preserves Map's own API, and command contexts apply their separate capability membrane.
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    this.ctx.state.env = observeMap(env, (key) => {
      mutated.add(key);
      scalarWrites.add(key);
    });
    // Array arithmetic writes elements directly. Observe those writes as well as
    // replacement of an entire array, without copying unrelated variables.
    const elementMaps = new Map<ShellArray, ShellArray["elements"]>();
    if (arrays) {
      const observedArrays = observeMap(arrays, (key) => {
        mutated.add(key);
        arrayWrites.add(key);
      });
      this.ctx.state.arrays = new _Proxy(observedArrays, {
        get(target, property) {
          if (property === "get")
            return (key: string) => {
              const array = arrays.get(key);
              if (array && !elementMaps.has(array)) {
                elementMaps.set(array, array.elements);
                array.elements = observeMap(array.elements, (element) => {
                  mutated.add(key);
                  let writes = elementWrites.get(key);
                  if (!writes) {
                    writes = new Set();
                    elementWrites.set(key, writes);
                  }
                  writes.add(element);
                });
              }
              return array;
            };
          // @banned-pattern-ignore: target is the internal array Map observer, not an object selected through a script-controlled property path.
          return Reflect.get(target, property, target);
        },
      });
    }
    this.stopObserving = () => {
      // Substitutions run on child copies and restore these parent observers
      // before returning. Only writes in this shell scope reach the journal.
      this.ctx.state.env = env;
      if (arrays) this.ctx.state.arrays = arrays;
      for (const [array, elements] of elementMaps) array.elements = elements;
      for (const key of mutated) {
        const underlying = this.underlying.get(key);
        if (underlying) {
          const snapshot = this.snapshot(key);
          if (!scalarWrites.has(key)) snapshot.scalar = underlying.scalar;
          if (!arrayWrites.has(key)) {
            const currentArray = snapshot.array;
            snapshot.array = underlying.array
              ? cloneArray(underlying.array)
              : undefined;
            snapshot.associative = underlying.associative;
            for (const element of elementWrites.get(key) ?? []) {
              const value = currentArray?.elements.get(element);
              if (value === undefined) snapshot.array?.elements.delete(element);
              else if (currentArray) {
                snapshot.array ??= {
                  kind: currentArray.kind,
                  elements: new Map(),
                };
                snapshot.array.elements.set(element, value);
              }
            }
          }
          this.underlying.set(key, snapshot);
          this.values.set(key, snapshot.scalar);
        }
      }
    };
    return mutated;
  }

  endExpansion(): void {
    const stop = this.stopObserving;
    this.stopObserving = undefined;
    stop?.();
  }

  capture(name: string): void {
    this.endExpansion();
    if (!this.underlying.has(name)) {
      const snapshot = this.snapshot(name);
      this.underlying.set(name, snapshot);
      this.values.set(name, snapshot.scalar);
    }
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
    this.restoreRedirectionScope?.();
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
