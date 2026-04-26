/**
 * Proxy Trap Completeness Tests
 *
 * Verify that createBlockingObjectProxy blocks all mutation vectors:
 * deleteProperty, setPrototypeOf, defineProperty.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "../defense-in-depth-box.js";

describe("Proxy trap completeness", () => {
  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  afterEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  describe("deleteProperty trap", () => {
    it("should block delete on proxied objects inside sandbox", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let error: Error | undefined;
      await handle.run(async () => {
        try {
          delete (process.env as Record<string, unknown>).NODE_OPTIONS;
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();

      expect(error).toBeInstanceOf(SecurityViolationError);
      expect(error?.message).toContain("deletion is blocked");
    });

    it("should allow delete outside sandbox context", () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      // Outside run() context — should not throw
      const obj = { a: 1 };
      delete (obj as Record<string, unknown>).a;
      expect(obj).toEqual({});

      handle.deactivate();
    });
  });

  describe("setPrototypeOf trap", () => {
    it("should block Object.setPrototypeOf on proxied objects inside sandbox", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let error: Error | undefined;
      await handle.run(async () => {
        try {
          Object.setPrototypeOf(process.env, {});
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();

      expect(error).toBeInstanceOf(SecurityViolationError);
      expect(error?.message).toContain("setPrototypeOf is blocked");
    });

    it("should allow Object.setPrototypeOf outside sandbox context", () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      const obj = {};
      Object.setPrototypeOf(obj, { x: 1 });
      expect((obj as Record<string, number>).x).toBe(1);

      handle.deactivate();
    });
  });

  describe("defineProperty trap", () => {
    it("should block Object.defineProperty on proxied objects inside sandbox", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let error: Error | undefined;
      await handle.run(async () => {
        try {
          Object.defineProperty(process.env, "MALICIOUS", { value: "pwned" });
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();

      expect(error).toBeInstanceOf(SecurityViolationError);
      expect(error?.message).toContain("defineProperty is blocked");
    });

    it("should allow Object.defineProperty outside sandbox context", () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      const obj: Record<string, unknown> = {};
      Object.defineProperty(obj, "x", { value: 42, configurable: true });
      expect(obj.x).toBe(42);

      handle.deactivate();
    });
  });

  describe("violation counting", () => {
    it("should record violations for all three new traps", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      const initialCount = box.getStats().violationsBlocked;

      await handle.run(async () => {
        // Try all three — each should throw and record
        try {
          delete (process.env as Record<string, unknown>).X;
        } catch {}
        try {
          Object.setPrototypeOf(process.env, {});
        } catch {}
        try {
          Object.defineProperty(process.env, "Y", { value: 1 });
        } catch {}
      });

      handle.deactivate();

      expect(box.getStats().violationsBlocked).toBe(initialCount + 3);
    });
  });
});
