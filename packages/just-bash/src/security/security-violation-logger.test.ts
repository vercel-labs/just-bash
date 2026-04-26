import { describe, expect, it, vi } from "vitest";
import {
  createConsoleViolationCallback,
  SecurityViolationLogger,
} from "./security-violation-logger.js";
import type { SecurityViolation } from "./types.js";

describe("SecurityViolationLogger", () => {
  const createTestViolation = (
    overrides: Partial<SecurityViolation> = {},
  ): SecurityViolation => ({
    timestamp: Date.now(),
    type: "function_constructor",
    message: "Test violation",
    path: "globalThis.Function",
    stack: "Error\n    at test.ts:1:1",
    executionId: "test-exec-id",
    ...overrides,
  });

  describe("recording violations", () => {
    it("should record violations", () => {
      const logger = new SecurityViolationLogger();
      const violation = createTestViolation();

      logger.record(violation);

      expect(logger.getTotalCount()).toBe(1);
      expect(logger.hasViolations()).toBe(true);
    });

    it("should return violations in reverse order (most recent first)", () => {
      const logger = new SecurityViolationLogger();

      logger.record(createTestViolation({ message: "first" }));
      logger.record(createTestViolation({ message: "second" }));
      logger.record(createTestViolation({ message: "third" }));

      const violations = logger.getViolations();
      expect(violations[0].message).toBe("third");
      expect(violations[1].message).toBe("second");
      expect(violations[2].message).toBe("first");
    });

    it("should group violations by type", () => {
      const logger = new SecurityViolationLogger();

      logger.record(createTestViolation({ type: "function_constructor" }));
      logger.record(createTestViolation({ type: "eval" }));
      logger.record(createTestViolation({ type: "function_constructor" }));

      const fnViolations = logger.getViolationsByType("function_constructor");
      const evalViolations = logger.getViolationsByType("eval");

      expect(fnViolations.length).toBe(2);
      expect(evalViolations.length).toBe(1);
    });

    it("should cap violations per type", () => {
      const logger = new SecurityViolationLogger({ maxViolationsPerType: 3 });

      for (let i = 0; i < 10; i++) {
        logger.record(createTestViolation({ message: `violation ${i}` }));
      }

      const byType = logger.getViolationsByType("function_constructor");
      expect(byType.length).toBe(3);
    });
  });

  describe("stack trace handling", () => {
    it("should include stack traces by default", () => {
      const logger = new SecurityViolationLogger();
      const violation = createTestViolation({ stack: "test stack" });

      logger.record(violation);

      const recorded = logger.getViolations()[0];
      expect(recorded.stack).toBe("test stack");
    });

    it("should strip stack traces when configured", () => {
      const logger = new SecurityViolationLogger({ includeStackTraces: false });
      const violation = createTestViolation({ stack: "test stack" });

      logger.record(violation);

      const recorded = logger.getViolations()[0];
      expect(recorded.stack).toBeUndefined();
    });
  });

  describe("custom handlers", () => {
    it("should call onViolation callback", () => {
      const onViolation = vi.fn();
      const logger = new SecurityViolationLogger({ onViolation });
      const violation = createTestViolation();

      logger.record(violation);

      expect(onViolation).toHaveBeenCalledTimes(1);
      expect(onViolation).toHaveBeenCalledWith(violation);
    });

    it("should provide createCallback() method", () => {
      const logger = new SecurityViolationLogger();
      const callback = logger.createCallback();

      callback(createTestViolation());

      expect(logger.getTotalCount()).toBe(1);
    });
  });

  describe("console logging", () => {
    it("should log to console when enabled", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const logger = new SecurityViolationLogger({ logToConsole: true });

      logger.record(createTestViolation({ message: "test message" }));

      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toContain("SecurityViolation");

      warnSpy.mockRestore();
    });

    it("should not log to console by default", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const logger = new SecurityViolationLogger();

      logger.record(createTestViolation());

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe("summary generation", () => {
    it("should generate summary by type", () => {
      const logger = new SecurityViolationLogger();

      const now = Date.now();
      logger.record(
        createTestViolation({
          type: "function_constructor",
          path: "globalThis.Function",
          timestamp: now - 1000,
        }),
      );
      logger.record(
        createTestViolation({
          type: "function_constructor",
          path: "globalThis.Function",
          timestamp: now,
        }),
      );
      logger.record(
        createTestViolation({
          type: "eval",
          path: "globalThis.eval",
          timestamp: now - 500,
        }),
      );

      const summary = logger.getSummary();

      expect(summary.length).toBe(2);

      // Should be sorted by count descending
      expect(summary[0].type).toBe("function_constructor");
      expect(summary[0].count).toBe(2);
      expect(summary[0].firstSeen).toBe(now - 1000);
      expect(summary[0].lastSeen).toBe(now);
      expect(summary[0].paths).toContain("globalThis.Function");

      expect(summary[1].type).toBe("eval");
      expect(summary[1].count).toBe(1);
    });

    it("should deduplicate paths in summary", () => {
      const logger = new SecurityViolationLogger();

      logger.record(createTestViolation({ path: "globalThis.Function" }));
      logger.record(createTestViolation({ path: "globalThis.Function" }));
      logger.record(createTestViolation({ path: "globalThis.Function" }));

      const summary = logger.getSummary();
      expect(summary[0].paths.length).toBe(1);
    });
  });

  describe("clearing", () => {
    it("should clear all violations", () => {
      const logger = new SecurityViolationLogger();

      logger.record(createTestViolation());
      logger.record(createTestViolation({ type: "eval" }));

      expect(logger.getTotalCount()).toBe(2);

      logger.clear();

      expect(logger.getTotalCount()).toBe(0);
      expect(logger.hasViolations()).toBe(false);
      expect(logger.getViolations()).toEqual([]);
      expect(logger.getSummary()).toEqual([]);
    });
  });
});

describe("createConsoleViolationCallback", () => {
  it("should create a callback that logs to console", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const callback = createConsoleViolationCallback();

    callback({
      timestamp: Date.now(),
      type: "function_constructor",
      message: "Test message",
      path: "globalThis.Function",
      executionId: "test-id",
    });

    expect(warnSpy).toHaveBeenCalled();
    const output = warnSpy.mock.calls[0].join(" ");
    expect(output).toContain("DefenseInDepth");
    expect(output).toContain("function_constructor");
    expect(output).toContain("globalThis.Function");
    expect(output).toContain("test-id");

    warnSpy.mockRestore();
  });
});
