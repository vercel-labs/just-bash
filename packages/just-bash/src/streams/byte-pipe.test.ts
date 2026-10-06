import { describe, expect, it } from "vitest";
import { unsafeBytesFromLatin1 } from "../encoding.js";
import { ExecutionScope } from "../execution-scope.js";
import { resolveLimits } from "../limits.js";
import { BrokenPipeError, BytePipe } from "./byte-pipe.js";

describe("BytePipe", () => {
  it("accepts writes up to capacity before a consumer starts reading", async () => {
    const scope = new ExecutionScope(resolveLimits({ maxLiveBytes: 4 }));
    const pipe = new BytePipe(scope, 4);
    await pipe.write(unsafeBytesFromLatin1("ab"));
    await pipe.write(unsafeBytesFromLatin1("cd"));
    expect(scope.remainingLiveBytes).toBe(0);
    pipe.end();
    expect(await pipe.read()).toBe(unsafeBytesFromLatin1("abcd"));
    expect(await pipe.read()).toBeNull();
    expect(scope.remainingLiveBytes).toBe(4);
  });

  it("rejects a pending write when the pipe ends", async () => {
    const pipe = new BytePipe(new ExecutionScope(resolveLimits()), 1);
    const writing = pipe.write(unsafeBytesFromLatin1("ab"));
    pipe.end();
    await expect(writing).rejects.toBeInstanceOf(BrokenPipeError);
    expect(await pipe.read()).toBe(unsafeBytesFromLatin1("a"));
    expect(await pipe.read()).toBeNull();
  });

  it("splits writes and releases reservations as the consumer reads", async () => {
    const scope = new ExecutionScope(resolveLimits({ maxLiveBytes: 4 }));
    const pipe = new BytePipe(scope, 4);
    let completed = false;
    const write = pipe.write(unsafeBytesFromLatin1("abcdefghij")).then(() => {
      completed = true;
    });
    expect(scope.remainingLiveBytes).toBe(0);
    expect(completed).toBe(false);
    expect(await pipe.read()).toBe(unsafeBytesFromLatin1("abcd"));
    expect(completed).toBe(false);
    expect(await pipe.read()).toBe(unsafeBytesFromLatin1("efgh"));
    expect(await pipe.read()).toBe(unsafeBytesFromLatin1("ij"));
    await write;
    expect(completed).toBe(true);
    expect(scope.remainingLiveBytes).toBe(4);
    pipe.end();
    expect(await pipe.read()).toBeNull();
  });

  it("wakes a reader at EOF", async () => {
    const pipe = new BytePipe(new ExecutionScope(resolveLimits()));
    const reading = pipe.read();
    pipe.end();
    expect(await reading).toBeNull();
  });

  it("cancels a blocked writer and releases its reservation", async () => {
    const scope = new ExecutionScope(resolveLimits({ maxLiveBytes: 4 }));
    const pipe = new BytePipe(scope, 4);
    const writing = pipe.write(unsafeBytesFromLatin1("abcdefgh"));
    pipe.cancel();
    await expect(writing).rejects.toBeInstanceOf(BrokenPipeError);
    expect(scope.remainingLiveBytes).toBe(4);
    await expect(pipe.write(unsafeBytesFromLatin1("x"))).rejects.toBeInstanceOf(
      BrokenPipeError,
    );
  });

  it("propagates the original failure to waiting readers", async () => {
    const pipe = new BytePipe(new ExecutionScope(resolveLimits()));
    const reading = pipe.read();
    const error = new Error("consumer failed");
    pipe.cancel(error);
    await expect(reading).rejects.toBe(error);
  });

  it("rejects concurrent writes instead of accumulating pending chunks", async () => {
    const pipe = new BytePipe(new ExecutionScope(resolveLimits()), 1);
    const writing = pipe.write(unsafeBytesFromLatin1("ab"));
    await expect(pipe.write(unsafeBytesFromLatin1("c"))).rejects.toThrow(
      "Pipe writes must be awaited",
    );
    expect(await pipe.read()).toBe(unsafeBytesFromLatin1("a"));
    expect(await pipe.read()).toBe(unsafeBytesFromLatin1("b"));
    await writing;
  });

  it("rejects concurrent reads", async () => {
    const pipe = new BytePipe(new ExecutionScope(resolveLimits()));
    const reading = pipe.read();
    await expect(pipe.read()).rejects.toThrow("Pipe reads must be awaited");
    pipe.end();
    expect(await reading).toBeNull();
  });

  it("checks the shared live byte budget before retaining a chunk", async () => {
    const scope = new ExecutionScope(resolveLimits({ maxLiveBytes: 2 }));
    const pipe = new BytePipe(scope, 4);
    await expect(pipe.write(unsafeBytesFromLatin1("abcd"))).rejects.toThrow(
      "live byte",
    );
    expect(scope.remainingLiveBytes).toBe(2);
  });

  it("does not fail an acknowledged write when the reader subsequently closes", async () => {
    const pipe = new BytePipe(new ExecutionScope(resolveLimits()));
    const writing = pipe.write(unsafeBytesFromLatin1("x"));
    expect(await pipe.read()).toBe(unsafeBytesFromLatin1("x"));
    pipe.cancel();
    await writing;
    await expect(pipe.write(unsafeBytesFromLatin1("y"))).rejects.toBeInstanceOf(
      BrokenPipeError,
    );
  });
});
