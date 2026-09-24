import { describe, expect, it } from "vitest";
import { WorkerLifecycle } from "./worker-lifecycle.js";

describe("WorkerLifecycle", () => {
  it("accepts a browser worker with synchronous termination", async () => {
    let terminated = false;
    const worker: Pick<Worker, "terminate"> = {
      terminate(): void {
        terminated = true;
      },
    };
    const lifecycle = new WorkerLifecycle({ timeoutMs: 1_000 });

    expect(await lifecycle.terminate(worker)).toBe(true);
    expect(terminated).toBe(true);
  });
});
