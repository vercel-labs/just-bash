import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const awk = async (program: string) => {
  const env = new Bash();
  return env.exec(`awk '${program}'`);
};

describe("awk %g and %e", () => {
  it("%g keeps the zeros of integer-valued results", async () => {
    const result = await awk(
      'BEGIN { printf "%g %g %g %g\\n", 100000, 120000, 999999, 0 }',
    );
    expect(result.stdout).toBe("100000 120000 999999 0\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("%g keeps the zeros of the exponent and pads it to two digits", async () => {
    const result = await awk(
      'BEGIN { printf "%g %g %g %g %g\\n", 1e10, 1.5e30, 1000000, 1234567, 123456789 }',
    );
    expect(result.stdout).toBe("1e+10 1.5e+30 1e+06 1.23457e+06 1.23457e+08\n");
  });

  it("%g switches to exponent form below 1e-4", async () => {
    const result = await awk(
      'BEGIN { printf "%g %g %g %g\\n", 0.0001, 0.00001, -0.00001234, 1e-10 }',
    );
    expect(result.stdout).toBe("0.0001 1e-05 -1.234e-05 1e-10\n");
  });

  it("%G, precision and width", async () => {
    const result = await awk(
      'BEGIN { printf "%G|%.3g|%.10g|%.0g|%10g|%-10g|\\n", 1e-10, 1234.5, 1e10, 123, 100000, 100000 }',
    );
    expect(result.stdout).toBe(
      "1E-10|1.23e+03|1e+10|1e+02|    100000|100000    |\n",
    );
  });

  it("%e pads the exponent to two digits", async () => {
    const result = await awk(
      'BEGIN { printf "%e %E %.2e %e\\n", 12345, 12345, 0.000123, 1e100 }',
    );
    expect(result.stdout).toBe(
      "1.234500e+04 1.234500E+04 1.23e-04 1.000000e+100\n",
    );
  });

  it("print formats non-integers with OFMT, here %.6g", async () => {
    const result = await awk(
      "BEGIN { print 1234567.89, 0.000012345, 1e-10, 0.1 + 0.2 }",
    );
    expect(result.stdout).toBe("1.23457e+06 1.2345e-05 1e-10 0.3\n");
  });

  it("print honours a custom OFMT", async () => {
    const result = await awk(
      'BEGIN { OFMT = "%.3g"; print 1234.5678, 0.00012345, 3.14159 }',
    );
    expect(result.stdout).toBe("1.23e+03 0.000123 3.14\n");
  });

  it("the # flag keeps zeros and the decimal point in %g and %e", async () => {
    const result = await awk(
      'BEGIN { printf "[%#g] [%#g] [%#g] [%#.3g] [%#.3g] [%#.0g] [%#.1g] [%#.3G]\\n", 100000, 1, 0.0001, 100000, 100, 123, 5, 1e-10; printf "[%#e] [%#.0e] [%#E] [%#10g] [%#-10g|]\\n", 12345, 5, 12345, 100000, 100000 }',
    );
    expect(result.stdout).toBe(
      "[100000.] [1.00000] [0.000100000] [1.00e+05] [100.] [1.e+02] [5.] [1.00E-10]\n" +
        "[1.234500e+04] [5.e+00] [1.234500E+04] [   100000.] [100000.   |]\n",
    );
  });
});
