import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * `if`, `for`, C-style `for` and `case` pipeline stages read the pipe.
 * Recorded against real bash for
 * https://github.com/vercel-labs/just-bash/issues/499. Every command feeds
 * its compound from a pipe or a file so recording never blocks on the
 * recorder's own stdin.
 */

const FILES = { "loop.txt": "L1\nL2\nL3\nL4\nL5\n", "file.txt": "F1\nF2\n" };

describe("compound pipeline stdin - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  const scripts: Array<[label: string, script: string]> = [
    ["if stage", "echo hi | if :; then cat; fi"],
    ["case stage", "echo hi | case x in x) cat;; esac"],
    [
      "for stage",
      `printf 'a\\nb\\n' | for i in 1 2; do read x; echo "$i$x"; done`,
    ],
    [
      "C-style for stage",
      `printf 'a\\nb\\n' | for ((i=0; i<2; i++)); do read x; echo "$i$x"; done`,
    ],
    [
      "condition and body share the stream",
      `printf 'a\\nb\\n' | if read x; then read y; echo "x=$x y=$y"; fi`,
    ],
    [
      "inherited stream is not rewound",
      `printf 'a\\nb\\n' | { if :; then read x; fi; read y; echo "x=$x y=$y"; }`,
    ],
    [
      "empty pipe is empty input",
      'echo outer | { printf "" | if :; then cat; fi; cat; }',
    ],
    [
      "redirection wins over the pipe",
      "echo piped | if :; then cat; fi < file.txt",
    ],
    [
      "case word reads the pipe",
      "echo hi | case $(cat) in hi) echo yes;; *) echo no;; esac",
    ],
    [
      "piped compound leaves the enclosing stream alone",
      '{ echo zz | if :; then cat; fi; read b; echo "b=[$b]"; } < loop.txt',
    ],
    [
      "if body in a read loop pairs the lines",
      'while read x; do if :; then read y; fi; echo "$x$y"; done < loop.txt',
    ],
    [
      "piped call reaches an if function body",
      "f() if :; then cat; fi; echo hi | f",
    ],
  ];

  for (const [label, script] of scripts) {
    it(label, async () => {
      const env = await setupFiles(testDir, FILES);
      await compareOutputs(env, testDir, script);
    });
  }
});
