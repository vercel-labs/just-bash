import { describe, expect, it } from "vitest";
import { _internals } from "./sqlite3.js";

describe("sqlite3 database lock cancellation", () => {
  it("removes an aborted waiter without stealing the next lock grant", async () => {
    const fsIdentity = {};
    const releaseFirst = await _internals.acquireDatabaseLock(
      fsIdentity,
      "/database",
    );
    const abort = new AbortController();
    const waiting = _internals.acquireDatabaseLock(
      fsIdentity,
      "/database",
      abort.signal,
    );
    abort.abort();
    await expect(waiting).rejects.toThrow("database lock wait aborted");

    releaseFirst();
    const releaseNext = await _internals.acquireDatabaseLock(
      fsIdentity,
      "/database",
    );
    releaseNext();
  });
});
