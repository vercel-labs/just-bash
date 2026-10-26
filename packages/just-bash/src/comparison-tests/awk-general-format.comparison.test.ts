import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("awk %g, %e and OFMT - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  const cases: Array<[string, string]> = [
    [
      "%g of integer-valued results",
      `awk 'BEGIN { printf "%g %g %g %g\\n", 100000, 120000, 999999, 0 }'`,
    ],
    [
      "%g exponent zeros",
      `awk 'BEGIN { printf "%g %g %g %g %g\\n", 1e10, 1.5e30, 1000000, 1234567, 123456789 }'`,
    ],
    [
      "%g exponent form below 1e-4",
      `awk 'BEGIN { printf "%g %g %g %g\\n", 0.0001, 0.00001, -0.00001234, 1e-10 }'`,
    ],
    [
      "%G, precision and width",
      `awk 'BEGIN { printf "%G|%.3g|%.10g|%.0g|%10g|%-10g|\\n", 1e-10, 1234.5, 1e10, 123, 100000, 100000 }'`,
    ],
    [
      "%e exponent width",
      `awk 'BEGIN { printf "%e %E %.2e %e\\n", 12345, 12345, 0.000123, 1e100 }'`,
    ],
    [
      "print with the default OFMT",
      `awk 'BEGIN { print 1234567.89, 0.000012345, 1e-10, 0.1 + 0.2 }'`,
    ],
    [
      "# flag in %g and %e",
      `awk 'BEGIN { printf "[%#g] [%#g] [%#.3g] [%#.0g] [%#.1g] [%#e] [%#.0e] [%#10g] [%#-10g|]\\n", 100000, 1, 100, 123, 5, 12345, 5, 100000, 100000 }'`,
    ],
    [
      "print with a custom OFMT",
      `awk 'BEGIN { OFMT = "%.3g"; print 1234.5678, 0.00012345, 3.14159 }'`,
    ],
  ];

  for (const [name, command] of cases) {
    it(`should format ${name}`, async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, command);
    });
  }
});
