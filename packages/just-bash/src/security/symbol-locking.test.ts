import * as nodeModule from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { DefenseInDepthBox } from "./defense-in-depth-box.js";
import { WorkerDefenseInDepth } from "./worker-defense-in-depth.js";

describe("well-known symbol locking", () => {
  afterEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  it.runIf(typeof nodeModule.registerHooks === "function")(
    "temporarily protects and then restores host symbol descriptors in scoped mode",
    () => {
      const targets = [
        [Array.prototype, Symbol.iterator],
        [String.prototype, Symbol.iterator],
        [RegExp.prototype, Symbol.match],
        [Function.prototype, Symbol.hasInstance],
        [Array.prototype, Symbol.unscopables],
        [Map.prototype, Symbol.toStringTag],
      ] as const;
      const before = targets.map(([target, symbol]) =>
        Object.getOwnPropertyDescriptor(target, symbol),
      );
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();
      try {
        const during = targets.map(([target, symbol]) =>
          Object.getOwnPropertyDescriptor(target, symbol),
        );
        for (let i = 0; i < during.length; i++) {
          const duringDescriptor = during[i];
          const beforeDescriptor = before[i];
          expect(duringDescriptor?.configurable).toBe(
            beforeDescriptor?.configurable,
          );
          if (
            duringDescriptor &&
            beforeDescriptor &&
            "value" in duringDescriptor
          ) {
            expect(duringDescriptor.value).toBe(beforeDescriptor.value);
            expect(duringDescriptor.writable).toBe(false);
          }
        }
      } finally {
        handle.deactivate();
        DefenseInDepthBox.resetInstance();
      }
      expect(
        targets.map(([target, symbol]) =>
          Object.getOwnPropertyDescriptor(target, symbol),
        ),
      ).toEqual(before);
    },
  );

  it("locks data-descriptor symbols in WorkerDefenseInDepth", () => {
    const defense = new WorkerDefenseInDepth({});
    let mapIteratorDesc: PropertyDescriptor | undefined;
    let setIteratorDesc: PropertyDescriptor | undefined;
    let regexpMatchDesc: PropertyDescriptor | undefined;
    let hasInstanceDesc: PropertyDescriptor | undefined;
    let unscopablesDesc: PropertyDescriptor | undefined;
    let mapToStringTagDesc: PropertyDescriptor | undefined;
    let stackTraceLimitDesc: PropertyDescriptor | undefined;
    try {
      // Worker defense blocks Proxy/function constructors while active; capture
      // descriptors first, then assert after deactivate.
      mapIteratorDesc = Object.getOwnPropertyDescriptor(
        Map.prototype,
        Symbol.iterator,
      );
      setIteratorDesc = Object.getOwnPropertyDescriptor(
        Set.prototype,
        Symbol.iterator,
      );
      regexpMatchDesc = Object.getOwnPropertyDescriptor(
        RegExp.prototype,
        Symbol.match,
      );
      hasInstanceDesc = Object.getOwnPropertyDescriptor(
        Function.prototype,
        Symbol.hasInstance,
      );
      unscopablesDesc = Object.getOwnPropertyDescriptor(
        Array.prototype,
        Symbol.unscopables,
      );
      mapToStringTagDesc = Object.getOwnPropertyDescriptor(
        Map.prototype,
        Symbol.toStringTag,
      );
      stackTraceLimitDesc = Object.getOwnPropertyDescriptor(
        Error,
        "stackTraceLimit",
      );
    } finally {
      defense.deactivate();
    }

    expect(mapIteratorDesc).toBeDefined();
    expect(mapIteratorDesc?.configurable).toBe(false);
    if (mapIteratorDesc && "value" in mapIteratorDesc) {
      expect(mapIteratorDesc.writable).toBe(false);
    }

    expect(setIteratorDesc).toBeDefined();
    expect(setIteratorDesc?.configurable).toBe(false);
    if (setIteratorDesc && "value" in setIteratorDesc) {
      expect(setIteratorDesc.writable).toBe(false);
    }

    // RegExp Symbol.match
    expect(regexpMatchDesc).toBeDefined();
    expect(regexpMatchDesc?.configurable).toBe(false);
    if (regexpMatchDesc && "value" in regexpMatchDesc) {
      expect(regexpMatchDesc.writable).toBe(false);
    }

    // Function.prototype Symbol.hasInstance
    expect(hasInstanceDesc).toBeDefined();
    if (hasInstanceDesc && "value" in hasInstanceDesc) {
      expect(hasInstanceDesc.writable).toBe(false);
    }

    // Array.prototype Symbol.unscopables
    expect(unscopablesDesc).toBeDefined();
    expect(unscopablesDesc?.configurable).toBe(false);
    if (unscopablesDesc && "value" in unscopablesDesc) {
      expect(unscopablesDesc.writable).toBe(false);
    }

    // Map.prototype Symbol.toStringTag
    expect(mapToStringTagDesc).toBeDefined();
    expect(mapToStringTagDesc?.configurable).toBe(false);
    if (mapToStringTagDesc && "value" in mapToStringTagDesc) {
      expect(mapToStringTagDesc.writable).toBe(false);
    }

    // Error.stackTraceLimit remains host-managed.
    expect(stackTraceLimitDesc).toBeDefined();
    expect(stackTraceLimitDesc?.configurable).toBe(true);
  });
});
