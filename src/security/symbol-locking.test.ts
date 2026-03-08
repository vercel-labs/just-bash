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
    } finally {
      handle.deactivate();
      DefenseInDepthBox.resetInstance();
    }
  });

  it("locks data-descriptor symbols in WorkerDefenseInDepth", () => {
    const defense = new WorkerDefenseInDepth({});
    let mapIteratorDesc: PropertyDescriptor | undefined;
    let setIteratorDesc: PropertyDescriptor | undefined;
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
  });
});
