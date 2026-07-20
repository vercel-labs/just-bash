import { afterEach, describe, expect, it } from "vitest";
import { DefenseInDepthBox } from "./defense-in-depth-box.js";
import { WorkerDefenseInDepth } from "./worker-defense-in-depth.js";

const describeDefense =
  typeof nodeModule.registerHooks === "function" ? describe : describe.skip;

describeDefense("defense intrinsic protection", () => {
  afterEach(() => DefenseInDepthBox.resetInstance());

  it("protects cached intrinsic assignments and live mutation APIs", async () => {
    const cachedMath = Math;
    const cachedJson = JSON;
    const cachedReflect = Reflect;
    const originalFloor = cachedMath.floor;
    const originalParse = cachedJson.parse;
    const originalGet = cachedReflect.get;
    const originalDescriptors = {
      floor: Object.getOwnPropertyDescriptor(cachedMath, "floor"),
      parse: Object.getOwnPropertyDescriptor(cachedJson, "parse"),
      get: Object.getOwnPropertyDescriptor(cachedReflect, "get"),
    };
    const originalFrozen = {
      math: Object.isFrozen(cachedMath),
      json: Object.isFrozen(cachedJson),
      reflect: Object.isFrozen(cachedReflect),
    };
    let remainedIntact = false;
    let activeFloorIntact = false;
    let activeParseIntact = false;
    let activeGetIntact = false;

    const box = DefenseInDepthBox.getInstance(true);
    expect(box.getStatus().intrinsicProtection).toBe("scoped-best-effort");
    const handle = box.activate();
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
      activeFloorIntact = cachedMath.floor === originalFloor;
      activeParseIntact = cachedJson.parse === originalParse;
      activeGetIntact = cachedReflect.get === originalGet;
      remainedIntact =
        activeFloorIntact && activeParseIntact && activeGetIntact;
    });
    handle.deactivate();

    expect({
      remainedIntact,
      floor: cachedMath.floor === originalFloor,
      parse: cachedJson.parse === originalParse,
      get: cachedReflect.get === originalGet,
      activeFloorIntact,
      activeParseIntact,
      activeGetIntact,
    }).toEqual({
      remainedIntact: true,
      floor: true,
      parse: true,
      get: true,
      activeFloorIntact: true,
      activeParseIntact: true,
      activeGetIntact: true,
    });
    expect(cachedMath.floor).toBe(originalFloor);
    expect(cachedJson.parse).toBe(originalParse);
    expect(cachedReflect.get).toBe(originalGet);
    expect(Object.getOwnPropertyDescriptor(cachedMath, "floor")).toEqual(
      originalDescriptors.floor,
    );
    expect(Object.getOwnPropertyDescriptor(cachedJson, "parse")).toEqual(
      originalDescriptors.parse,
    );
    expect(Object.getOwnPropertyDescriptor(cachedReflect, "get")).toEqual(
      originalDescriptors.get,
    );
    expect(Object.isFrozen(cachedMath)).toBe(originalFrozen.math);
    expect(Object.isFrozen(cachedJson)).toBe(originalFrozen.json);
    expect(Object.isFrozen(cachedReflect)).toBe(originalFrozen.reflect);
  });

  it("blocks protected symbol redefinition during execution and restores it", async () => {
    const before = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator,
    );
    const handle = DefenseInDepthBox.getInstance(true).activate();
    const original = Array.prototype[Symbol.iterator];
    let objectBlocked = false;
    let reflectBlocked = false;
    let remainedIntact = false;

    await handle.run(async () => {
      try {
        Object.defineProperty(Array.prototype, Symbol.iterator, {
          value: function* maliciousIterator() {
            yield "escape";
          },
        });
      } catch {
        objectBlocked = true;
      }
      try {
        reflectBlocked = !Reflect.defineProperty(
          Array.prototype,
          Symbol.iterator,
          {
            value: function* maliciousIterator() {
              yield "escape";
            },
          },
        );
      } catch {
        reflectBlocked = true;
      }
      remainedIntact = Array.prototype[Symbol.iterator] === original;
    });

    handle.deactivate();
    expect(objectBlocked).toBe(true);
    expect(reflectBlocked).toBe(true);
    expect(remainedIntact).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator),
    ).toEqual(before);
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

import * as nodeModule from "node:module";
