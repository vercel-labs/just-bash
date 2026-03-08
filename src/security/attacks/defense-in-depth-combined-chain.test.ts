import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _setTimeout } from "../../timers.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "../defense-in-depth-box.js";
import type { SecurityViolation } from "../types.js";

describe("Defense-in-depth combined chain probes", () => {
  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  afterEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  it("blocks promise-deferred shadowing + constructor-chain payload after deactivate", async () => {
    const violations: SecurityViolation[] = [];
    const box = DefenseInDepthBox.getInstance({
      enabled: true,
      onViolation: (v) => violations.push(v),
    });
    const handle = box.activate();

    const originalBinding = Object.getOwnPropertyDescriptor(process, "binding");
    let resolveGate: (() => void) | undefined;
    let callbackRan = false;
    let constructorValue: number | undefined;
    let constructorError: Error | undefined;
    let shadowResult: string | undefined;

    try {
      await handle.run(async () => {
        const gate = new Promise<void>((resolve) => {
          resolveGate = resolve;
        });
        void gate.then(() => {
          callbackRan = true;
          Object.defineProperty(process, "binding", {
            value: () => "shadowed-binding",
            writable: true,
            configurable: true,
          });
          shadowResult = (
            process as unknown as { binding: (name: string) => string }
          ).binding("fs");
          try {
            const Fn = {}.constructor.constructor as (
              body: string,
            ) => () => number;
            constructorValue = Fn("return 9001")();
          } catch (e) {
            constructorError = e as Error;
          }
        });
      });

      handle.deactivate();
      resolveGate?.();
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      if (originalBinding) {
        Object.defineProperty(process, "binding", originalBinding);
      } else {
        delete (process as unknown as Record<string, unknown>).binding;
      }
    }

    expect(callbackRan).toBe(false);
    expect(shadowResult).toBeUndefined();
    expect(constructorValue).toBeUndefined();
    expect(constructorError).toBeUndefined();
    expect(
      violations.some((v) => v.type === "promise_then_after_deactivate"),
    ).toBe(true);
  });

  it("blocks timer-deferred shadowing + constructor-chain payload after deactivate", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    const originalBinding = Object.getOwnPropertyDescriptor(process, "binding");
    let callbackRan = false;
    let constructorValue: number | undefined;
    let constructorError: Error | undefined;
    let shadowResult: string | undefined;

    try {
      await handle.run(async () => {
        _setTimeout(() => {
          callbackRan = true;
          Object.defineProperty(process, "binding", {
            value: () => "shadowed-binding",
            writable: true,
            configurable: true,
          });
          shadowResult = (
            process as unknown as { binding: (name: string) => string }
          ).binding("fs");
          try {
            const Fn = {}.constructor.constructor as (
              body: string,
            ) => () => number;
            constructorValue = Fn("return 1337")();
          } catch (e) {
            constructorError = e as Error;
          }
        }, 0);
      });

      handle.deactivate();
      await new Promise<void>((resolve) => _setTimeout(resolve, 10));
    } finally {
      if (originalBinding) {
        Object.defineProperty(process, "binding", originalBinding);
      } else {
        delete (process as unknown as Record<string, unknown>).binding;
      }
    }

    expect(callbackRan).toBe(false);
    expect(shadowResult).toBeUndefined();
    expect(constructorValue).toBeUndefined();
    expect(constructorError).toBeUndefined();
  });

  it("keeps constructor-chain blocked when shadowing is attempted inside active context", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    const originalBinding = Object.getOwnPropertyDescriptor(process, "binding");
    let shadowResult: string | undefined;
    let constructorValue: number | undefined;
    let constructorError: Error | undefined;

    try {
      await handle.run(async () => {
        Object.defineProperty(process, "binding", {
          value: () => "shadowed-binding",
          writable: true,
          configurable: true,
        });
        shadowResult = (
          process as unknown as { binding: (name: string) => string }
        ).binding("fs");

        try {
          const Fn = {}.constructor.constructor as (
            body: string,
          ) => () => number;
          constructorValue = Fn("return 5150")();
        } catch (e) {
          constructorError = e as Error;
        }
      });
    } finally {
      handle.deactivate();
      if (originalBinding) {
        Object.defineProperty(process, "binding", originalBinding);
      } else {
        delete (process as unknown as Record<string, unknown>).binding;
      }
    }

    expect(shadowResult).toBe("shadowed-binding");
    expect(constructorValue).toBeUndefined();
    expect(constructorError).toBeInstanceOf(SecurityViolationError);
  });
});
