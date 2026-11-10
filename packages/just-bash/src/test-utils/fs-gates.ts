/**
 * Gates for tests that need a filesystem call in flight while they act.
 */
// @banned-pattern-ignore: test helper that only spies on fs.promises.open to hold calls; it does no host I/O of its own
import * as fs from "node:fs";
import { vi } from "vitest";

/** Resolves to "hung" after 2 s, so a hang fails fast instead of at the suite timeout. */
export function settleWithin<T>(promise: Promise<T>): Promise<T | "hung"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<"hung">((resolve) => {
    timer = setTimeout(() => resolve("hung"), 2000);
  });
  return Promise.race([promise, hung]).finally(() => clearTimeout(timer));
}

export interface Gate {
  /** Resolves once the gated call has been reached. */
  inFlight: Promise<void>;
  /** Lets the gated call continue. */
  release: () => void;
  /** Resolves once release() has been called. */
  released: Promise<void>;
  /** Marks the gated call as reached. */
  reached: () => void;
}

export function createGate(): Gate {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const inFlight = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return { inFlight, release, released, reached };
}

/**
 * Holds the first `count` opens that match until each is released, so a test
 * can act while they are in flight.
 */
function holdOpens(
  matches: (filePath: string) => boolean,
  count: number,
): Gate[] {
  const originalOpen = fs.promises.open.bind(fs.promises);
  const gates = Array.from({ length: count }, createGate);
  let held = 0;
  vi.spyOn(fs.promises, "open").mockImplementation(
    async (filePath, flags, mode) => {
      const gate = matches(String(filePath)) ? gates[held++] : undefined;
      if (gate) {
        gate.reached();
        await gate.released;
      }
      const handle = await originalOpen(filePath, flags, mode);
      return handle;
    },
  );
  return gates;
}

/** Holds the staged writes ReadWriteFs makes for new or replaced files. */
export function holdStagedWrites(count: number): Gate[] {
  return holdOpens((filePath) => filePath.includes(".just-bash-write-"), count);
}
