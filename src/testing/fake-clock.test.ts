import { describe, expect, it } from "vitest";
import { FakeClock } from "./fake-clock.js";

describe("FakeClock", () => {
  describe("basic sleep behavior", () => {
    it("single sleep resolves immediately (auto-advances)", async () => {
      const clock = new FakeClock();
      clock.taskUnblocked();
      await clock.sleep(1000);
      expect(clock.time).toBe(1000);
      expect(clock.pendingCount).toBe(0);
    });

    it("zero-duration sleep resolves immediately", async () => {
      const clock = new FakeClock();
      clock.taskUnblocked();
      await clock.sleep(0);
      expect(clock.time).toBe(0);
      expect(clock.pendingCount).toBe(0);
    });

    it("clock.time reflects advanced time", async () => {
      const clock = new FakeClock();
      expect(clock.time).toBe(0);
      clock.taskUnblocked();
      await clock.sleep(42);
      expect(clock.time).toBe(42);
      await clock.sleep(58);
      expect(clock.time).toBe(100);
    });

    it("sequential sleeps accumulate time", async () => {
      const clock = new FakeClock();
      clock.taskUnblocked();
      await clock.sleep(100);
      await clock.sleep(200);
      await clock.sleep(300);
      expect(clock.time).toBe(600);
    });
  });

  describe("concurrent sleeps", () => {
    it("two concurrent sleeps advance in order", async () => {
      const clock = new FakeClock();
      const order: number[] = [];

      clock.taskUnblocked();
      clock.taskUnblocked();

      const p1 = clock.sleep(500).then(() => {
        order.push(500);
        clock.taskBlocked();
      });
      const p2 = clock.sleep(1000).then(() => {
        order.push(1000);
        clock.taskBlocked();
      });

      await Promise.all([p1, p2]);
      expect(order).toEqual([500, 1000]);
      expect(clock.time).toBe(1000);
      expect(clock.pendingCount).toBe(0);
    });

    it("three concurrent sleeps advance in order", async () => {
      const clock = new FakeClock();
      const order: number[] = [];

      clock.taskUnblocked();
      clock.taskUnblocked();
      clock.taskUnblocked();

      const p1 = clock.sleep(300).then(() => {
        order.push(300);
        clock.taskBlocked();
      });
      const p2 = clock.sleep(100).then(() => {
        order.push(100);
        clock.taskBlocked();
      });
      const p3 = clock.sleep(200).then(() => {
        order.push(200);
        clock.taskBlocked();
      });

      await Promise.all([p1, p2, p3]);
      expect(order).toEqual([100, 200, 300]);
      expect(clock.time).toBe(300);
    });

    it("concurrent sleeps with same duration both resolve", async () => {
      const clock = new FakeClock();
      let count = 0;

      clock.taskUnblocked();
      clock.taskUnblocked();

      const p1 = clock.sleep(500).then(() => {
        count++;
        clock.taskBlocked();
      });
      const p2 = clock.sleep(500).then(() => {
        count++;
        clock.taskBlocked();
      });

      await Promise.all([p1, p2]);
      expect(count).toBe(2);
      expect(clock.time).toBe(500);
    });
  });

  describe("task management", () => {
    it("no pending timers means no advancement", () => {
      const clock = new FakeClock();
      expect(clock.time).toBe(0);
      expect(clock.pendingCount).toBe(0);
      clock.taskUnblocked();
      clock.taskBlocked();
      expect(clock.time).toBe(0);
    });

    it("taskBlocked with no active tasks is safe", () => {
      const clock = new FakeClock();
      // Decrement below 0 — should not crash
      clock.taskBlocked();
      expect(clock.time).toBe(0);
    });

    it("multiple taskUnblocked/taskBlocked cycles work correctly", () => {
      const clock = new FakeClock();
      clock.taskUnblocked();
      clock.taskUnblocked();
      clock.taskUnblocked();
      clock.taskBlocked();
      clock.taskBlocked();
      clock.taskBlocked();
      expect(clock.time).toBe(0);
    });

    it("pendingCount is 0 after all sleeps resolve", async () => {
      const clock = new FakeClock();
      expect(clock.pendingCount).toBe(0);

      clock.taskUnblocked();
      clock.taskUnblocked();

      const p1 = clock.sleep(100).then(() => clock.taskBlocked());
      const p2 = clock.sleep(200).then(() => clock.taskBlocked());

      await Promise.all([p1, p2]);
      expect(clock.pendingCount).toBe(0);
    });

    it("sleep auto-increments active count on resolve", async () => {
      const clock = new FakeClock();
      clock.taskUnblocked();
      // After sleep resolves, we should be active again (handled internally)
      await clock.sleep(100);
      // We're still active — can sleep again without taskUnblocked
      await clock.sleep(100);
      expect(clock.time).toBe(200);
    });
  });

  describe("edge cases", () => {
    it("very large sleep duration works", async () => {
      const clock = new FakeClock();
      clock.taskUnblocked();
      await clock.sleep(999_999_999);
      expect(clock.time).toBe(999_999_999);
    });

    it("fresh clock starts at time 0", () => {
      const clock = new FakeClock();
      expect(clock.time).toBe(0);
      expect(clock.pendingCount).toBe(0);
    });

    it("multiple clocks are independent", async () => {
      const clock1 = new FakeClock();
      const clock2 = new FakeClock();

      clock1.taskUnblocked();
      clock2.taskUnblocked();

      await clock1.sleep(100);
      await clock2.sleep(200);

      expect(clock1.time).toBe(100);
      expect(clock2.time).toBe(200);
    });
  });
});
