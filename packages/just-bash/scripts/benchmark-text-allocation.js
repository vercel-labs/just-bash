// Run after pnpm build:
// node --expose-gc packages/just-bash/scripts/benchmark-text-allocation.js
// This deterministic workload supports future tuning, not reproduction of the
// historical PR measurements whose exact input generator was not committed.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Bash } from "../dist/index.js";
import { createStringBuilder } from "../dist/utils/string-builder.js";

if (!globalThis.gc) throw new Error("Run with --expose-gc");
console.log(`Node ${process.version}; 3 warmups, median of 9 measured rounds`);

const workloads = [
  ["tr a-z A-Z", (input) => input.toUpperCase()],
  ["tr -d b", (input) => input.replaceAll("b", "")],
  ["tr -s abc", (input) => input.replace(/([abc])\1+/g, "$1")],
  ["sed 's/aaa/xyz/g'", (input) => input.replaceAll("aaa", "xyz")],
];
const input = "aaabbbccc\n".repeat(104_849).slice(0, 1_048_481);
assert.equal(Buffer.byteLength(input), 1_048_481);
const environment = new Bash({ files: { "/input.txt": input } });
const measurements = workloads.map(() => []);
// Rotate command order, and keep GC and output validation outside timing.
for (let round = -3; round < 9; round++) {
  for (let index = 0; index < workloads.length; index++) {
    const slot = (index + round + 3) % workloads.length;
    const [command, expected] = workloads[slot];
    globalThis.gc();
    const start = performance.now();
    const result = await environment.exec(`${command} < /input.txt`);
    const elapsed = performance.now() - start;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected(input));
    if (round >= 0) measurements[slot].push(elapsed);
  }
}
for (let index = 0; index < workloads.length; index++) {
  measurements[index].sort((a, b) => a - b);
  console.log(
    `${workloads[index][0]}: ${measurements[index][4].toFixed(3)} ms`,
  );
}

// Compare batching-only, short-prefix, and fully inline construction around
// tr's 32-fragment prefix and 32768-code-unit input cutoff.
for (const size of [31, 32, 33, 32767, 32768, 32769, 1_048_481]) {
  const times = [[], [], []];
  const thresholds = [0, 32, 32768];
  const expected = "x".repeat(size);
  for (let round = -3; round < 9; round++) {
    for (let index = 0; index < thresholds.length; index++) {
      const slot = (index + round + 3) % thresholds.length;
      globalThis.gc();
      const start = performance.now();
      const builder = createStringBuilder(thresholds[slot]);
      for (let offset = 0; offset < size; offset++) builder.append("x");
      const output = builder.finish();
      const elapsed = performance.now() - start;
      assert.equal(output, expected);
      if (round >= 0) times[slot].push(elapsed);
    }
  }
  console.log(
    `builder ${size} fragments: ${times
      .map((values, index) => {
        values.sort((a, b) => a - b);
        return `inline=${thresholds[index]} ${values[4].toFixed(3)} ms`;
      })
      .join("; ")}`,
  );
}
