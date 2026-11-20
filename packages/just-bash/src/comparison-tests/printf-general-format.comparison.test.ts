import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("printf %g - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  const cases: Array<[string, string]> = [
    ["integer-valued results", "printf '%g\\n' 100000 120000 999999 0"],
    ["exponent zeros", "printf '%g %g %g\\n' 1e10 1.5e30 1000000"],
    [
      "exponent form below 1e-4",
      "printf '%g\\n' 0.0001 0.00001 -0.00001234 1234567 123456789 -2500000",
    ],
    ["%G", "printf '%G\\n' 1e-10 1.5e30 0.000123456"],
    ["precision", "printf '%.3g|%.10g|%.0g\\n' 1234.5 1e10 123"],
    ["width", "printf '[%10g] [%-10g] [%010g]\\n' 100000 100000 1e10"],
    ["sign flags", "printf '[%+g] [% g] [%+g]\\n' 100000 100000 1e-10"],
    ["# flag", "printf '[%#g] [%#.3g] [%#g]\\n' 1.5 100000 1e10"],
    [
      "# flag decimal point",
      "printf '[%#g] [%#g] [%#g] [%#.3g] [%#.0g] [%#.1g]\\n' 100000 1 0 100 123 5",
    ],
    [
      "# flag with %e, width and padding",
      "printf '[%#e] [%#.0e] [%#10g] [%#-10g|] [%#+g] [%#010g]\\n' 12345 5 100000 100000 100000 100000",
    ],
  ];

  for (const [name, command] of cases) {
    it(`should format ${name}`, async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, command);
    });
  }
});
