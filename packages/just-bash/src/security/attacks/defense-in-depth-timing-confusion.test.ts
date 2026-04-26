import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _clearInterval, _setInterval, _setTimeout } from "../../timers.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "../defense-in-depth-box.js";

describe("Defense-in-depth timing confusion hypotheses", () => {
  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  afterEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  it("TC-01: deferred callback registered inside run is blocked after deactivate", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let insideBlockedError: Error | undefined;
    let resolveGate: (() => void) | undefined;
    let deferredError: Error | undefined;
    let callbackValue: number | undefined;
    let callbackSawActive: boolean | undefined;

    await handle.run(async () => {
      try {
        new Function("return 1");
      } catch (e) {
        insideBlockedError = e as Error;
      }

      const gate = new Promise<void>((resolve) => {
        resolveGate = resolve;
      });

      void gate
        .then(() => {
          callbackSawActive = box.isActive();
          const fn = new Function("return 31337");
          callbackValue = fn();
        })
        .catch((e: unknown) => {
          deferredError = e as Error;
        });
    });

    // run() has ended; deactivate defense before callback resolves
    handle.deactivate();

    expect(insideBlockedError).toBeInstanceOf(SecurityViolationError);
    expect(resolveGate).toBeDefined();
    resolveGate?.();

    // Flush microtasks for gate.then callback
    await Promise.resolve();
    await Promise.resolve();

    expect(callbackSawActive).toBeUndefined();
    expect(deferredError).toBeUndefined();
    expect(callbackValue).toBeUndefined();
  });

  it("TC-01b: blocked deferred onFulfilled preserves value pass-through semantics", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let resolveGate: ((value: string) => void) | undefined;
    let callbackRan = false;
    let passThroughPromise: Promise<unknown> | undefined;

    await handle.run(async () => {
      const gate = new Promise<string>((resolve) => {
        resolveGate = resolve;
      });

      passThroughPromise = gate.then((value) => {
        callbackRan = true;
        return `${value}-mutated`;
      });
    });

    handle.deactivate();
    resolveGate?.("ORIGINAL");

    const finalValue = await passThroughPromise;

    expect(callbackRan).toBe(false);
    expect(finalValue).toBe("ORIGINAL");
  });

  it("TC-01c: blocked deferred onRejected preserves rejection propagation", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let rejectGate: ((reason: unknown) => void) | undefined;
    let callbackRan = false;
    let passThroughPromise: Promise<unknown> | undefined;

    await handle.run(async () => {
      const gate = new Promise<never>((_resolve, reject) => {
        rejectGate = reject;
      });

      passThroughPromise = gate.catch((error) => {
        callbackRan = true;
        throw new Error(`rewrapped:${String(error)}`);
      });
    });

    handle.deactivate();
    rejectGate?.("ORIGINAL_REJECTION");

    await expect(passThroughPromise).rejects.toBe("ORIGINAL_REJECTION");

    expect(callbackRan).toBe(false);
  });

  it("TC-02: deferred callback resolved before deactivate stays blocked", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let resolveGate: (() => void) | undefined;
    let callbackError: Error | undefined;
    let callbackSawActive: boolean | undefined;

    await handle.run(async () => {
      const gate = new Promise<void>((resolve) => {
        resolveGate = resolve;
      });

      void gate.then(() => {
        callbackSawActive = box.isActive();
        try {
          new Function("return 7");
        } catch (e) {
          callbackError = e as Error;
        }
      });

      resolveGate?.();
      await gate;
      await Promise.resolve();
    });

    handle.deactivate();

    expect(callbackSawActive).toBe(true);
    expect(callbackError).toBeInstanceOf(SecurityViolationError);
  });

  it("TC-03: queueMicrotask scheduled inside run does not escape context", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let microtaskError: Error | undefined;

    await handle.run(async () => {
      queueMicrotask(() => {
        try {
          new Function("return 123");
        } catch (e) {
          microtaskError = e as Error;
        }
      });
      await Promise.resolve();
    });

    handle.deactivate();

    expect(microtaskError).toBeInstanceOf(SecurityViolationError);
  });

  it("TC-04: callback handoff from run() to outside context stays blocked while box is active", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let handoffCallback: (() => void) | undefined;
    let handoffId: string | undefined;
    let handoffError: Error | undefined;
    let handoffValue: number | undefined;

    await handle.run(async () => {
      handoffCallback = () => {
        handoffId = DefenseInDepthBox.getCurrentExecutionId();
        try {
          const fn = new Function("return 4242");
          handoffValue = fn();
        } catch (e) {
          handoffError = e as Error;
        }
      };
    });

    expect(box.isActive()).toBe(true);

    await new Promise<void>((resolve) => {
      _setTimeout(() => {
        handoffCallback?.();
        resolve();
      }, 0);
    });

    handle.deactivate();

    expect(handoffId).toBe(handle.executionId);
    expect(handoffError).toBeInstanceOf(SecurityViolationError);
    expect(handoffValue).toBeUndefined();
  });

  it("TC-05: bindCurrentContext preserves executionId and blocking for handoff callbacks", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let boundCallback: (() => void) | undefined;
    let boundId: string | undefined;
    let boundError: Error | undefined;

    await handle.run(async () => {
      boundCallback = DefenseInDepthBox.bindCurrentContext(() => {
        boundId = DefenseInDepthBox.getCurrentExecutionId();
        try {
          new Function("return 5151");
        } catch (e) {
          boundError = e as Error;
        }
      });
    });

    await new Promise<void>((resolve) => {
      _setTimeout(() => {
        boundCallback?.();
        resolve();
      }, 0);
    });

    handle.deactivate();

    expect(boundId).toBe(handle.executionId);
    expect(boundError).toBeInstanceOf(SecurityViolationError);
  });

  it("TC-05b: bindCurrentContext remains blocking with multiple active executions", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handleA = box.activate();
    const handleB = box.activate();

    await handleA.run(async () => {});
    await handleB.run(async () => {});

    let seenId: string | undefined;
    let callbackError: Error | undefined;
    let callbackValue: number | undefined;
    const callback = DefenseInDepthBox.bindCurrentContext(() => {
      seenId = DefenseInDepthBox.getCurrentExecutionId();
      try {
        const fn = new Function("return 9191");
        callbackValue = fn();
      } catch (e) {
        callbackError = e as Error;
      }
    });

    callback();

    handleA.deactivate();
    handleB.deactivate();

    expect(seenId).toBeDefined();
    expect([handleA.executionId, handleB.executionId]).toContain(seenId);
    expect(callbackError).toBeInstanceOf(SecurityViolationError);
    expect(callbackValue).toBeUndefined();
  });

  it("TC-06: pre-captured _setInterval preserves defense trace context", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let intervalId: string | undefined;
    let intervalError: Error | undefined;

    await handle.run(async () => {
      await new Promise<void>((resolve) => {
        const timer = _setInterval(() => {
          intervalId = DefenseInDepthBox.getCurrentExecutionId();
          try {
            new Function("return 6161");
          } catch (e) {
            intervalError = e as Error;
          } finally {
            _clearInterval(timer);
            resolve();
          }
        }, 0);
      });
    });

    handle.deactivate();

    expect(intervalId).toBe(handle.executionId);
    expect(intervalError).toBeInstanceOf(SecurityViolationError);
  });

  it("TC-07: pre-captured _setTimeout preserves defense trace context", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let timeoutId: string | undefined;
    let timeoutError: Error | undefined;

    await handle.run(async () => {
      await new Promise<void>((resolve) => {
        _setTimeout(() => {
          timeoutId = DefenseInDepthBox.getCurrentExecutionId();
          try {
            new Function("return 7171");
          } catch (e) {
            timeoutError = e as Error;
          } finally {
            resolve();
          }
        }, 0);
      });
    });

    handle.deactivate();

    expect(timeoutId).toBe(handle.executionId);
    expect(timeoutError).toBeInstanceOf(SecurityViolationError);
  });

  it("TC-08: trusted mode should not leak into deferred pre-captured timer callbacks", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let deferredId: string | undefined;
    let deferredError: Error | undefined;
    let deferredValue: number | undefined;

    await handle.run(async () => {
      await new Promise<void>((resolve) => {
        DefenseInDepthBox.runTrusted(() => {
          _setTimeout(() => {
            deferredId = DefenseInDepthBox.getCurrentExecutionId();
            try {
              const fn = new Function("return 8181");
              deferredValue = fn();
            } catch (e) {
              deferredError = e as Error;
            } finally {
              resolve();
            }
          }, 0);
        });
      });
    });

    handle.deactivate();

    expect(deferredId).toBe(handle.executionId);
    expect(deferredError).toBeInstanceOf(SecurityViolationError);
    expect(deferredValue).toBeUndefined();
  });
});
