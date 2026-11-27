import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xargs options with an attached value", () => {
  it("accepts -n2 like -n 2", async () => {
    const result = await new Bash().exec('echo "a b c d e" | xargs -n2 echo');
    expect(result).toMatchObject({
      stdout: "a b\nc d\ne\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("accepts -I{} like -I {}", async () => {
    const result = await new Bash().exec('echo "a\nb" | xargs -I{} echo x{}y');
    expect(result).toMatchObject({
      stdout: "xay\nxby\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("accepts -d, like -d ,", async () => {
    const result = await new Bash().exec('echo "a b,c" | xargs -d, -n1 echo');
    expect(result).toMatchObject({
      stdout: "a b\nc\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("accepts -P2 like -P 2", async () => {
    const result = await new Bash().exec('echo "a b c" | xargs -P2 -n1 echo');
    expect(result).toMatchObject({
      stdout: "a\nb\nc\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("accepts attached values next to flags and separate values", async () => {
    const result = await new Bash().exec(
      'echo "a b c" | xargs -r -n2 -P 1 echo',
    );
    expect(result).toMatchObject({
      stdout: "a b\nc\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("validates an attached value like a separate one", async () => {
    const zero = await new Bash().exec('echo "a b" | xargs -n0 echo');
    expect(zero).toMatchObject({
      stdout: "",
      stderr: "xargs: invalid number for -n: '0'\n",
      exitCode: 1,
    });

    const word = await new Bash().exec('echo "a b" | xargs -nX echo');
    expect(word).toMatchObject({
      stdout: "",
      stderr: "xargs: invalid number for -n: 'X'\n",
      exitCode: 1,
    });

    const procs = await new Bash().exec('echo "a b" | xargs -Pfoo echo');
    expect(procs).toMatchObject({
      stdout: "",
      stderr: "xargs: invalid number for -P: 'foo'\n",
      exitCode: 1,
    });
  });

  it("stops reading options at the command", async () => {
    const result = await new Bash().exec('echo "a b" | xargs echo -n2');
    expect(result).toMatchObject({
      stdout: "-n2 a b\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("still rejects an unknown option", async () => {
    const result = await new Bash().exec('echo "a" | xargs -z echo');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid option -- 'z'");
  });
});
