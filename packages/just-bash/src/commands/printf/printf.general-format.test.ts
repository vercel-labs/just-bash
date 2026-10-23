import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const run = async (script: string) => {
  const env = new Bash();
  return env.exec(script);
};

describe("printf %g", () => {
  it("keeps the zeros of integer-valued results", async () => {
    const result = await run("printf '%g\\n' 100000 120000 999999 0");
    expect(result.stdout).toBe("100000\n120000\n999999\n0\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps the zeros of the exponent", async () => {
    const result = await run("printf '%g %g %g\\n' 1e10 1.5e30 1000000");
    expect(result.stdout).toBe("1e+10 1.5e+30 1e+06\n");
    expect(result.stderr).toBe("");
  });

  it("switches to exponent form below 1e-4 and pads the exponent", async () => {
    const result = await run(
      "printf '%g\\n' 0.0001 0.00001 -0.00001234 1234567 123456789 -2500000",
    );
    expect(result.stdout).toBe(
      "0.0001\n1e-05\n-1.234e-05\n1.23457e+06\n1.23457e+08\n-2.5e+06\n",
    );
  });

  it("handles %G and an explicit precision", async () => {
    const result = await run(
      "printf '%G\\n' 1e-10 1.5e30 0.000123456; printf '%.3g|%.10g|%.0g\\n' 1234.5 1e10 123",
    );
    expect(result.stdout).toBe(
      "1E-10\n1.5E+30\n0.000123456\n1.23e+03|1e+10|1e+02\n",
    );
  });

  it("pads to the field width", async () => {
    const result = await run(
      "printf '[%10g] [%-10g] [%010g]\\n' 100000 100000 1e10",
    );
    expect(result.stdout).toBe("[    100000] [100000    ] [000001e+10]\n");
  });

  it("applies the + and space flags", async () => {
    const result = await run(
      "printf '[%+g] [% g] [%+g]\\n' 100000 100000 1e-10",
    );
    expect(result.stdout).toBe("[+100000] [ 100000] [+1e-10]\n");
  });

  it("keeps trailing zeros with the # flag", async () => {
    const result = await run("printf '[%#g] [%#.3g] [%#g]\\n' 1.5 100000 1e10");
    expect(result.stdout).toBe("[1.50000] [1.00e+05] [1.00000e+10]\n");
  });
});
