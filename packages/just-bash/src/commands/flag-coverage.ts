import type { FeatureCoverageWriter } from "../types.js";
import { getAllCommandFuzzInfo } from "./fuzz-flags.js";

const flagMap = new Map<string, Set<string>>();
for (const info of getAllCommandFuzzInfo()) {
  flagMap.set(info.name, new Set(info.flags.map((f) => f.flag)));
}

export function emitFlagCoverage(
  coverage: FeatureCoverageWriter,
  cmdName: string,
  args: readonly string[],
): void {
  const knownFlags = flagMap.get(cmdName);
  if (!knownFlags || knownFlags.size === 0) return;
  for (const arg of args) {
    if (knownFlags.has(arg)) {
      coverage.hit(`cmd:flag:${cmdName}:${arg}`);
    }
  }
}
