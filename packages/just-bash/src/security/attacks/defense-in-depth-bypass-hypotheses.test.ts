import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "../defense-in-depth-box.js";
import type { SecurityViolation } from "../types.js";

describe("Defense-in-depth bypass hypotheses", () => {
  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  afterEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  it("H1: pre-captured process.binding reference still bypasses sandbox-time process proxying", async () => {
    const capturedBinding = (
      process as unknown as { binding: (name: string) => unknown }
    ).binding;
    const violations: SecurityViolation[] = [];

    const box = DefenseInDepthBox.getInstance({
      enabled: true,
      onViolation: (v) => violations.push(v),
    });
    const handle = box.activate();

    let directError: Error | undefined;
    let bypassError: Error | undefined;
    let bypassType: string | undefined;

    await handle.run(async () => {
      try {
        (process as unknown as { binding: (name: string) => unknown }).binding(
          "fs",
        );
      } catch (e) {
        directError = e as Error;
      }

      try {
        const bindingResult = capturedBinding("fs");
        bypassType = typeof bindingResult;
      } catch (e) {
        bypassError = e as Error;
      }
    });

    handle.deactivate();

    expect(directError).toBeInstanceOf(SecurityViolationError);
    expect(bypassError).toBeUndefined();
    expect(["object", "function"]).toContain(String(bypassType));
    expect(violations.some((v) => v.type === "process_binding")).toBe(true);
  });

  it("H2: pre-captured process.env object bypasses sandbox-time process.env proxy", async () => {
    const probeKey = "__JB_DEFENSE_ENV_PROBE__";
    const probeValue = `probe-${Date.now()}`;
    process.env[probeKey] = probeValue;
    const capturedEnv = process.env;

    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let directError: Error | undefined;
    let bypassError: Error | undefined;
    let bypassValue: string | undefined;

    await handle.run(async () => {
      try {
        const _blocked = process.env[probeKey];
      } catch (e) {
        directError = e as Error;
      }

      try {
        bypassValue = capturedEnv[probeKey];
      } catch (e) {
        bypassError = e as Error;
      }
    });

    handle.deactivate();
    delete process.env[probeKey];

    expect(directError).toBeInstanceOf(SecurityViolationError);
    expect(bypassError).toBeUndefined();
    expect(bypassValue).toBe(probeValue);
  });

  it("H3: Object.defineProperty can shadow blocked process.binding inside sandbox context", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let bypassError: Error | undefined;
    let shadowResult: string | undefined;

    await handle.run(async () => {
      try {
        Object.defineProperty(process, "binding", {
          value: () => "shadow-binding-ok",
          writable: true,
          configurable: true,
        });

        shadowResult = (
          process as unknown as { binding: (name: string) => string }
        ).binding("fs");
      } catch (e) {
        bypassError = e as Error;
      }
    });

    handle.deactivate();

    expect(bypassError).toBeUndefined();
    expect(shadowResult).toBe("shadow-binding-ok");
  });

  it("H4: main-thread defense leaves process.stdout writable/usable in sandbox context", async () => {
    const originalWrite = process.stdout.write;
    let captured = "";

    Object.defineProperty(process.stdout, "write", {
      value: (chunk: unknown) => {
        captured += String(chunk);
        return true;
      },
      writable: true,
      configurable: true,
    });

    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let writeError: Error | undefined;

    await handle.run(async () => {
      try {
        process.stdout.write("__JB_DIRECT_STDOUT_BYPASS__\n");
      } catch (e) {
        writeError = e as Error;
      }
    });

    handle.deactivate();
    Object.defineProperty(process.stdout, "write", {
      value: originalWrite,
      writable: true,
      configurable: true,
    });

    expect(writeError).toBeUndefined();
    expect(captured).toBe("__JB_DIRECT_STDOUT_BYPASS__\n");
  });

  it("H5: process.cwd() is blocked in sandbox context (info disclosure)", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    let readError: Error | undefined;

    await handle.run(async () => {
      try {
        process.cwd();
      } catch (e) {
        readError = e as Error;
      }
    });

    handle.deactivate();

    expect(readError).toBeInstanceOf(SecurityViolationError);
    expect(readError?.message).toContain("process.cwd");
  });
});
