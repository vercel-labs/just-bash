import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("awk expressions and output", () => {
  it("supports bare length and exponentiation of fields", async () => {
    const result = await new Bash().exec(
      `printf 'abc\\nabcdef\\n' | awk 'length > 4';
       echo '3 4' | awk '{ print $1 ^ $2, $(1 + 1), 2 ^ 3 ^ 2 }'`,
    );
    expect(result).toMatchObject({
      stdout: "abcdef\n81 4 512\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("zero-pads floating-point output after the sign", async () => {
    const result = await new Bash().exec(
      `awk 'BEGIN { printf "%05.1f|%06.1f|%-05.1f|\\n", 3.14159, -3.14159, 3.14159 }'`,
    );
    expect(result).toMatchObject({
      stdout: "003.1|-003.1|3.1  |\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("routes print and printf to the standard streams", async () => {
    const result = await new Bash().exec(
      `awk 'BEGIN { print "e" > "/dev/stderr"; printf "f\\n" >> "/dev/stderr"; print "o" > "/dev/stdout" }'`,
    );
    expect(result).toMatchObject({
      stdout: "o\n",
      stderr: "e\nf\n",
      exitCode: 0,
    });
  });
});
