import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSharedBuffer, ProtocolBuffer } from "./protocol.js";
import { SyncBackend } from "./sync-backend.js";

// Stand-in for the main thread, written against the buffer layout in
// protocol.ts: status at Int32 index 1, result length at index 4, result
// bytes at offset 4128. It reports when it is watching for the request, then
// wakes the waiting thread without changing the status, which is what the
// notify for the previous operation does when it lands late. It records that
// wake in `wakeObserved`, so a test can tell a stale wake apart from a request
// that timed out before anything ever woke it. After `delayMs` it answers the
// request, unless `answer` is false.
const HOST_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { sharedBuffer, wakeObserved, answer, delayMs } = workerData;
const control = new Int32Array(sharedBuffer);
const bytes = new Uint8Array(sharedBuffer);
const observed = new Int32Array(wakeObserved);
const STATUS = 1, RESULT_LENGTH = 4, DATA_BUFFER = 4128;
const READY = 1, SUCCESS = 2;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const giveUpAt = Date.now() + 5000;
parentPort.postMessage("armed");
while (Atomics.load(control, STATUS) !== READY) {
  if (Date.now() > giveUpAt) throw new Error("request never became READY");
  sleep(1);
}
while (Atomics.notify(control, STATUS, 1) === 0) {
  if (Date.now() > giveUpAt) throw new Error("backend never waited");
}
Atomics.store(observed, 0, 1);
sleep(delayMs);
if (answer) {
  bytes.set([111, 107], DATA_BUFFER);
  Atomics.store(control, RESULT_LENGTH, 2);
  Atomics.store(control, STATUS, SUCCESS);
  Atomics.notify(control, STATUS);
}
`;

let host: Worker | undefined;

afterEach(async () => {
  await host?.terminate();
  host = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// The returned promise resolves once the host is watching for the request, so
// the timed request cannot start before something is able to answer it.
function startHost(
  sharedBuffer: SharedArrayBuffer,
  options: { answer: boolean; delayMs: number },
): { woke: Int32Array; armed: Promise<void> } {
  const wakeObserved = new SharedArrayBuffer(4);
  const worker = new Worker(HOST_SOURCE, {
    eval: true,
    workerData: { sharedBuffer, wakeObserved, ...options },
  });
  host = worker;
  return {
    woke: new Int32Array(wakeObserved),
    armed: new Promise((resolve) => worker.once("message", () => resolve())),
  };
}

describe("SyncBackend", () => {
  it("keeps waiting when woken before the request is answered", async () => {
    const sharedBuffer = createSharedBuffer();
    const backend = new SyncBackend(sharedBuffer, 5000);
    const { woke, armed } = startHost(sharedBuffer, {
      answer: true,
      delayMs: 100,
    });
    await armed;

    const content = backend.readFile("/home/user/file.txt");

    expect(new TextDecoder().decode(content)).toBe("ok");
    expect(Atomics.load(woke, 0)).toBe(1);
  });

  it("times out at the operation deadline when woken without an answer", async () => {
    const sharedBuffer = createSharedBuffer();
    const backend = new SyncBackend(sharedBuffer, 300);
    const { woke, armed } = startHost(sharedBuffer, {
      answer: false,
      delayMs: 0,
    });
    await armed;

    const start = Date.now();
    expect(() => backend.readFile("/home/user/file.txt")).toThrow(
      "Operation timed out",
    );
    expect(Date.now() - start).toBeGreaterThanOrEqual(250);
    expect(Atomics.load(woke, 0)).toBe(1);
  });

  it("gives each retry only what is left of the operation deadline", () => {
    vi.useFakeTimers();
    const backend = new SyncBackend(createSharedBuffer(), 300);
    const waitBudgets: number[] = [];
    vi.spyOn(ProtocolBuffer.prototype, "waitForResult").mockImplementation(
      (timeoutMs) => {
        waitBudgets.push(timeoutMs ?? 0);
        // A stale wake ends the wait before the budget is spent, so the loop
        // has to keep waiting with only what is left.
        vi.advanceTimersByTime(100);
        return "ok";
      },
    );

    expect(() => backend.readFile("/home/user/file.txt")).toThrow(
      "Operation timed out",
    );
    expect(waitBudgets).toEqual([300, 200, 100]);
  });
});
