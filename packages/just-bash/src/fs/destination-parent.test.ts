import { describe, expect, it } from "vitest";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../interpreter/errors.js";
import { resolveLimits } from "../limits.js";
import { resolveDestinationPath } from "./destination-parent.js";
import { InMemoryFs } from "./in-memory-fs/in-memory-fs.js";
import { FileTraversalBudget } from "./traversal.js";

describe("destination resolution lifecycle", () => {
  it("observes cancellation while a directory lookup is pending", async () => {
    const filesystem = new InMemoryFs({ "/a/keep": "keep" });
    const abortController = new AbortController();
    const traversalBudget = new FileTraversalBudget({
      limits: resolveLimits(),
      signal: abortController.signal,
      site: "cp",
    });

    const pendingResolution = resolveDestinationPath(filesystem, "/a/copied", {
      budget: traversalBudget,
    });
    abortController.abort();

    await expect(pendingResolution).rejects.toBeInstanceOf(
      ExecutionAbortedError,
    );
    expect(await filesystem.exists("/a/copied")).toBe(false);
    await expect(resolveDestinationPath(filesystem, "/a/copied")).resolves.toBe(
      "/a/copied",
    );
  });

  it("charges dot components even when they perform no filesystem lookup", async () => {
    const filesystem = new InMemoryFs();
    const traversalBudget = new FileTraversalBudget({
      limits: resolveLimits({ maxTraversalWork: 10 }),
      site: "cp",
    });
    await expect(
      resolveDestinationPath(filesystem, `/${"./".repeat(100)}copied`, {
        budget: traversalBudget,
      }),
    ).rejects.toBeInstanceOf(ExecutionLimitError);
  });
});
