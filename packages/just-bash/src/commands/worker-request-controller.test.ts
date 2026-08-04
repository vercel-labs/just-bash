import { describe, expect, it, vi } from "vitest";
import {
  estimateMessageBytes,
  WorkerRequestController,
} from "./worker-request-controller.js";

describe("WorkerRequestController", () => {
  it("observes an already-aborted parent before queue insertion", () => {
    const abort = new AbortController();
    abort.abort();
    const events: string[] = [];
    const request = new WorkerRequestController({
      commandName: "test",
      timeoutMs: 1_000,
      signal: abort.signal,
      maxMessageBytes: 100,
    });
    request.arm(() => events.push("cancel"));
    if (!request.isCanceled) events.push("enqueue");
    expect(events).toEqual(["cancel"]);
    request.close();
  });

  it("removes listeners and fires cancellation once", () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const cancel = vi.fn();
    const request = new WorkerRequestController({
      commandName: "test",
      timeoutMs: 10,
      signal: abort.signal,
      maxMessageBytes: 100,
    });
    request.arm(cancel);
    abort.abort();
    vi.advanceTimersByTime(20);
    expect(cancel).toHaveBeenCalledTimes(1);
    request.close();
    vi.useRealTimers();
  });

  it("does not schedule a platform-overflowing timer for Infinity", () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const request = new WorkerRequestController({
      commandName: "test",
      timeoutMs: Number.POSITIVE_INFINITY,
      maxMessageBytes: 100,
    });
    request.arm(cancel);
    vi.advanceTimersByTime(10_000);
    expect(cancel).not.toHaveBeenCalled();
    expect(request.remainingTimeMs()).toBe(Number.POSITIVE_INFINITY);
    request.close();
    vi.useRealTimers();
  });

  it("bounds nested and cyclic structured-clone payloads", () => {
    const value: Record<string, unknown> = { text: "😀" };
    value.self = value;
    expect(estimateMessageBytes(value, 100)).toBe(28);
    const request = new WorkerRequestController({
      commandName: "test",
      timeoutMs: 100,
      maxMessageBytes: 7,
    });
    expect(() => request.assertMessageSize(value, "response")).toThrow(
      "worker response exceeds 7 byte limit",
    );
  });

  it("rejects huge arrays without spreading them onto the host stack", () => {
    expect(estimateMessageBytes(new Array(1_000_000), 100)).toBe(101);
  });
});
