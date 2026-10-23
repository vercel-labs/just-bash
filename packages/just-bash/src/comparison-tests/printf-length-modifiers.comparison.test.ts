import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("printf length modifiers - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  const cases: Array<[string, string]> = [
    [
      "l with flags and width",
      "printf '[%ld] [%5ld] [%-5ld] [%05ld] [%+ld]\\n' 1 2 3 4 5",
    ],
    [
      "ll",
      "printf '[%lu] [%lx] [%lX] [%lo] [%lli] [%lld] [%llu] [%llx]\\n' 3 255 255 8 -9 1 2 255",
    ],
    [
      "h, hh, j, z and t",
      "printf '[%hd] [%hhd] [%hu] [%hhx] [%jd] [%ju] [%zd] [%zu] [%td]\\n' 4 5 6 255 7 8 9 10 11",
    ],
    [
      "floating point",
      "printf '[%lf] [%Lf] [%.2lf] [%le] [%lg] [%Lg] [%LE] [%lG]\\n' 2.5 1.5 3.14159 4.5 3.5 7.5 100 100",
    ],
    ["%s and %c", "printf '[%ls] [%lc] [%10ls]\\n' str xyz abc"],
    [
      "width and precision from arguments",
      "printf '[%*ld] [%.*lf]\\n' 4 7 2 3.14159",
    ],
  ];

  for (const [name, command] of cases) {
    it(`should accept ${name}`, async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, command);
    });
  }
});
