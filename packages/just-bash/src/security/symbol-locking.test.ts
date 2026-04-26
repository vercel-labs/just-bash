import { afterEach, describe, expect, it } from "vitest";
import { DefenseInDepthBox } from "./defense-in-depth-box.js";
import { WorkerDefenseInDepth } from "./worker-defense-in-depth.js";

function expectLockedDataSymbol(
  target: object,
  symbolKey: symbol,
  label: string,
): void {
  const desc = Object.getOwnPropertyDescriptor(target, symbolKey);
  expect(desc, `${label} descriptor should exist`).toBeDefined();
  expect(desc?.configurable, `${label} should be non-configurable`).toBe(false);
  if (desc && "value" in desc) {
    expect(desc.writable, `${label} should be non-writable`).toBe(false);
  }
}

describe("well-known symbol locking", () => {
  afterEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  it("locks data-descriptor symbols in DefenseInDepthBox", () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();
    try {
      // Symbol.iterator
      expectLockedDataSymbol(
        Array.prototype,
        Symbol.iterator,
        "Array.prototype[Symbol.iterator]",
      );
      expectLockedDataSymbol(
        String.prototype,
        Symbol.iterator,
        "String.prototype[Symbol.iterator]",
      );

      // RegExp Symbol methods
      expectLockedDataSymbol(
        RegExp.prototype,
        Symbol.match,
        "RegExp.prototype[Symbol.match]",
      );
      expectLockedDataSymbol(
        RegExp.prototype,
        Symbol.matchAll,
        "RegExp.prototype[Symbol.matchAll]",
      );
      expectLockedDataSymbol(
        RegExp.prototype,
        Symbol.replace,
        "RegExp.prototype[Symbol.replace]",
      );
      expectLockedDataSymbol(
        RegExp.prototype,
        Symbol.search,
        "RegExp.prototype[Symbol.search]",
      );
      expectLockedDataSymbol(
        RegExp.prototype,
        Symbol.split,
        "RegExp.prototype[Symbol.split]",
      );

      // Symbol.hasInstance
      expectLockedDataSymbol(
        Function.prototype,
        Symbol.hasInstance,
        "Function.prototype[Symbol.hasInstance]",
      );

      // Symbol.unscopables
      expectLockedDataSymbol(
        Array.prototype,
        Symbol.unscopables,
        "Array.prototype[Symbol.unscopables]",
      );

      // Symbol.toStringTag
      expectLockedDataSymbol(
        Map.prototype,
        Symbol.toStringTag,
        "Map.prototype[Symbol.toStringTag]",
      );
      expectLockedDataSymbol(
        Set.prototype,
        Symbol.toStringTag,
        "Set.prototype[Symbol.toStringTag]",
      );
      expectLockedDataSymbol(
        Promise.prototype,
        Symbol.toStringTag,
        "Promise.prototype[Symbol.toStringTag]",
      );
      expectLockedDataSymbol(
        ArrayBuffer.prototype,
        Symbol.toStringTag,
        "ArrayBuffer.prototype[Symbol.toStringTag]",
      );

      // Error.stackTraceLimit (configurable: true for restoration support)
      const stackDesc = Object.getOwnPropertyDescriptor(
        Error,
        "stackTraceLimit",
      );
      expect(
        stackDesc,
        "Error.stackTraceLimit descriptor should exist",
      ).toBeDefined();
      expect(
        stackDesc?.writable,
        "Error.stackTraceLimit should be non-writable",
      ).toBe(false);
    } finally {
      handle.deactivate();
      DefenseInDepthBox.resetInstance();
    }
  });

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
    expect(hasInstanceDesc?.configurable).toBe(false);
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

    // Error.stackTraceLimit (configurable: true for restoration support)
    expect(stackTraceLimitDesc).toBeDefined();
    if (stackTraceLimitDesc && "value" in stackTraceLimitDesc) {
      expect(stackTraceLimitDesc.writable).toBe(false);
    }
  });
});
