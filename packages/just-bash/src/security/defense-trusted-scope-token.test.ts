import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _setTimeout } from "../timers.js";
import { DefenseInDepthBox } from "./defense-in-depth-box.js";

describe("trusted defense scope tokens", () => {
  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  afterEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  it("keeps rebound callbacks trusted only while their async scope is live", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();
    let value: number | undefined;

    await handle.run(async () => {
      value = await DefenseInDepthBox.runTrustedAsync(
        () =>
          new Promise<number>((resolve) => {
            _setTimeout(() => resolve(new Function("return 4242")()), 0);
          }),
      );
    });

    handle.deactivate();
    expect(value).toBe(4242);
  });

  it("guards an untrusted promise while a sibling trusted scope is live", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();
    let resolveDeferred!: () => void;
    let releaseTrusted!: () => void;
    let trustedPromise!: Promise<void>;
    let callbackRan = false;
    const deferred = new Promise<void>((resolve) => {
      resolveDeferred = resolve;
    });

    await handle.run(async () => {
      const registerUntrustedCallback = DefenseInDepthBox.bindCurrentContext(
        () => {
          deferred.then(() => {
            callbackRan = true;
          });
        },
      );
      trustedPromise = DefenseInDepthBox.runTrustedAsync(
        () =>
          new Promise<void>((resolve) => {
            releaseTrusted = resolve;
          }),
      );
      registerUntrustedCallback();
    });

    handle.deactivate();
    resolveDeferred();
    await Promise.resolve();
    expect(callbackRan).toBe(false);

    releaseTrusted();
    await trustedPromise;
  });
});
