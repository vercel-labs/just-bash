import { afterEach, describe, expect, it } from "vitest";
import { DefenseInDepthBox } from "./defense-in-depth-box.js";
import { WorkerDefenseInDepth } from "./worker-defense-in-depth.js";

describe("defense intrinsic protection", () => {
  afterEach(() => DefenseInDepthBox.resetInstance());

  it("protects cached intrinsic references across every mutation path", async () => {
    const cachedMath = Math;
    const cachedJson = JSON;
    const cachedReflect = Reflect;
    const originalFloor = cachedMath.floor;
    const originalParse = cachedJson.parse;
    const originalGet = cachedReflect.get;

    const handle = DefenseInDepthBox.getInstance(true).activate();
    await handle.run(async () => {
      for (const mutate of [
        () => {
          (cachedMath as unknown as Record<string, unknown>).floor = () => 0;
        },
        () => Object.defineProperty(cachedJson, "parse", { value: () => 0 }),
        () =>
          Reflect.defineProperty(cachedReflect, "get", {
            value: () => 0,
          }),
        () => Reflect.set(cachedMath, "floor", () => 0),
      ]) {
        try {
          mutate();
        } catch {
          // Frozen intrinsics may throw or return false depending on the API.
        }
      }
    });
    handle.deactivate();

    expect(cachedMath.floor).toBe(originalFloor);
    expect(cachedJson.parse).toBe(originalParse);
    expect(cachedReflect.get).toBe(originalGet);
    expect(Object.isFrozen(cachedMath)).toBe(true);
    expect(Object.isFrozen(cachedJson)).toBe(true);
    expect(Object.isFrozen(cachedReflect)).toBe(true);
  });

  it("makes protected symbol descriptors non-redefinable", () => {
    const handle = DefenseInDepthBox.getInstance(true).activate();
    const original = Array.prototype[Symbol.iterator];

    expect(() =>
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        value: function* maliciousIterator() {
          yield "escape";
        },
      }),
    ).toThrow(TypeError);
    expect(
      Reflect.defineProperty(Array.prototype, Symbol.iterator, {
        value: function* maliciousIterator() {
          yield "escape";
        },
      }),
    ).toBe(false);
    expect(Array.prototype[Symbol.iterator]).toBe(original);
    expect(
      Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)
        ?.configurable,
    ).toBe(false);

    handle.deactivate();
  });

  it("protects cached references in the disposable worker realm", () => {
    const cachedMath = Math;
    const cachedJson = JSON;
    const cachedReflect = Reflect;
    const originals = [cachedMath.floor, cachedJson.parse, cachedReflect.get];
    const defense = new WorkerDefenseInDepth({});

    for (const mutate of [
      () => Object.defineProperty(cachedMath, "floor", { value: () => 0 }),
      () => Reflect.defineProperty(cachedJson, "parse", { value: () => 0 }),
      () => Reflect.set(cachedReflect, "get", () => 0),
    ]) {
      try {
        mutate();
      } catch {
        // Expected for frozen intrinsics.
      }
    }
    defense.deactivate();

    expect([cachedMath.floor, cachedJson.parse, cachedReflect.get]).toEqual(
      originals,
    );
  });
});
