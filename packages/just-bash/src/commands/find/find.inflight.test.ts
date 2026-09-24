import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { DirentEntry } from "../../fs/interface.js";

// Taken before any command runs: the defense-in-depth box blocks the global
// during an execution, and a real disk's reads settle on the host's own timers.
const hostSetTimeout = setTimeout;

/**
 * A filesystem whose directory reads take real time, like a disk. On
 * InMemoryFs every read settles before `find` can fail, so nothing is still
 * running when it returns and the failure this covers cannot occur.
 */
class SlowReaddirFs extends InMemoryFs {
  constructor(
    files: Record<string, string>,
    private readonly delayMs: number,
  ) {
    super(files);
  }

  private readonly pause = () =>
    new Promise<void>((resolve) => hostSetTimeout(resolve, this.delayMs));

  override async readdir(path: string): Promise<string[]> {
    await this.pause();
    return super.readdir(path);
  }

  override async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    await this.pause();
    return super.readdirWithFileTypes(path);
  }
}

function tree(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let d = 0; d < 30; d++) {
    for (let f = 0; f < 50; f++) files[`/t/d${d}/f${f}`] = "";
  }
  return files;
}

describe("find failing part way through a batch", () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", record);
  });

  afterEach(() => {
    process.off("unhandledRejection", record);
  });

  // Each directory read takes 20ms, so the root settles at 20ms and its thirty
  // children are all in flight until about 40ms; every case below ends the
  // command inside that window.
  it.each([
    [
      "a traversal limit",
      { maxTraversalEntries: 500, maxTraversalWork: 500 },
      undefined,
      126,
    ],
    ["an abort", {}, 30, 124],
    ["the execution deadline", { maxExecutionTimeMs: 30 }, undefined, 124],
  ] as const)("leaves nothing running to reject after %s ends it", async (_reason, executionLimits, abortAfterMs, exitCode) => {
    const bash = new Bash({
      fs: new SlowReaddirFs(tree(), 20),
      executionLimits,
    });
    const controller = new AbortController();
    if (abortAfterMs !== undefined) {
      hostSetTimeout(() => controller.abort(), abortAfterMs);
    }

    const result = await bash.exec("find /t -type f", {
      signal: controller.signal,
    });
    // Long enough for every sibling read in the batch to settle.
    await new Promise((resolve) => hostSetTimeout(resolve, 200));

    expect(result.exitCode).toBe(exitCode);
    expect(unhandled).toEqual([]);
  });
});
