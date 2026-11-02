// Automa: already-accounted output survives control flow and process writers.
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("Automa unwind output accounting", () => {
  it.each([
    "break",
    "continue",
  ])("charges nested %s output once", async (flow) => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 4 } });
    const result = await bash.exec(
      `for a in 1; do for b in 1; do printf abcd; ${flow} 2; done > out.txt; done`,
    );
    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(result.executionFailure).toBeUndefined();
    expect(await bash.fs.readFile("/home/user/out.txt")).toBe("abcd");
  });

  it("charges output process substitution once", async () => {
    const result = await new Bash({
      executionLimits: { maxOutputSize: 4 },
    }).exec(": > >(printf 1234)");
    expect(result).toMatchObject({ stdout: "1234", stderr: "", exitCode: 0 });
    expect(result.executionFailure).toBeUndefined();
  });

  it("does not swallow a writer capture limit during return", async () => {
    const result = await new Bash({
      executionLimits: { maxStringLength: 16 },
    }).exec(
      "f() { { :; return 0; } > >(echo 1234567; echo 1234567; echo 1234567); }; f; echo BAD",
    );
    expect(result).toMatchObject({
      stdout: "",
      stderr:
        "bash: process substitution: string length limit exceeded (16 bytes)\n",
      exitCode: 126,
    });
    expect(result.executionFailure?.limitType).toBe("string_length");
  });

  it("does not transfer unrelated redirected credits into a capture", async () => {
    const result = await new Bash({
      files: { "/x": "1234" },
      executionLimits: { maxOutputSize: 4 },
    }).exec(": > >(printf abcd >/other; cp /x /dev/fd/63)");
    expect(result.exitCode).toBe(126);
    expect(result.executionFailure?.limitType).toBe("output_size");
  });

  it("invalidates capture credits after direct replacement", async () => {
    const result = await new Bash({
      files: { "/x": "1234" },
      executionLimits: { maxOutputSize: 4 },
    }).exec(": > >(printf abcd; cp /x /dev/fd/63)");
    expect(result.exitCode).toBe(126);
    expect(result.executionFailure?.limitType).toBe("output_size");
  });

  it("retains only the routed suffix credit after direct capture replacement", async () => {
    const result = await new Bash({
      files: { "/x": "12" },
      executionLimits: { maxOutputSize: 4 },
    }).exec(": > >(cp /x /dev/fd/63; printf 34)");
    expect(result).toMatchObject({ stdout: "1234", stderr: "", exitCode: 0 });
    expect(result.executionFailure).toBeUndefined();
  });

  it("retains capture credits when a copied link entry is replaced independently", async () => {
    const bash = new Bash({
      files: { "/x": "1234" },
      executionLimits: { maxOutputSize: 4 },
    });
    const result = await bash.exec(
      ": > >(printf abcd; ln /dev/fd/63 /alias; cp /x /alias)",
    );
    expect(result).toMatchObject({ stdout: "abcd", stderr: "", exitCode: 0 });
    expect(result.executionFailure).toBeUndefined();
    expect(await bash.fs.readFile("/alias")).toBe("1234");
  });

  it.each([
    "return 0",
    "exit 0",
  ])("retains writer output while unwinding %s", async (flow) => {
    const result = await new Bash({
      executionLimits: { maxOutputSize: 4 },
    }).exec(`f() { { :; ${flow}; } > >(printf 1234); }; f`);
    expect(result).toMatchObject({
      stdout: "1234",
      stderr: "",
      exitCode: 0,
      output: "1234",
    });
    expect(result.executionFailure).toBeUndefined();
  });

  it("retains the writer stderr while unwinding return", async () => {
    const result = await new Bash({
      executionLimits: { maxOutputSize: 1 },
    }).exec("f() { { :; return 0; } > >(printf b >&2); }; f");
    expect(result).toMatchObject({
      stdout: "",
      stderr: "b",
      exitCode: 0,
      output: "b",
    });
    expect(result.executionFailure).toBeUndefined();
  });

  it.each([
    "break",
    "continue",
  ])("retains prefix and byte output through three-level %s", async (flow) => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 4 } });
    const result = await bash.exec(
      `for a in 1; do printf ab; for b in 1; do for c in 1; do printf cd; ${flow} 3; done; done > out; done`,
    );
    expect(result).toMatchObject({
      stdout: "ab",
      stderr: "",
      exitCode: 0,
      output: "ab",
    });
    expect(result.executionFailure).toBeUndefined();
    expect(await bash.fs.readFile("/home/user/out")).toBe("cd");
  });

  it("uses encoded byte length for the process writer credit", async () => {
    const chunks: string[] = [];
    const result = await new Bash({
      executionLimits: { maxOutputSize: 2 },
    }).exec(": > >(printf é)", {
      onOutput: (text) => {
        chunks.push(text);
      },
    });
    expect(result).toMatchObject({
      stdout: "é",
      stderr: "",
      exitCode: 0,
      output: "é",
    });
    expect(result.executionFailure).toBeUndefined();
    expect(chunks.join("")).toBe("é");
  });

  it.each([
    4, 8,
  ])("keeps input substitution capture and re-emission distinct with budget %s", async (maxOutputSize) => {
    const result = await new Bash({ executionLimits: { maxOutputSize } }).exec(
      "cat <(printf 1234)",
    );
    if (maxOutputSize === 4) {
      expect(result.exitCode).toBe(126);
      expect(result.executionFailure?.limitType).toBe("output_size");
    } else {
      expect(result).toMatchObject({ stdout: "1234", stderr: "", exitCode: 0 });
      expect(result.executionFailure).toBeUndefined();
    }
  });

  it("keeps actual output exhaustion sticky through return cleanup", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 4 } });
    const result = await bash.exec(
      "f() { { :; return 0; } > >(printf 12345); }; f || true; echo BAD",
    );
    expect(result.exitCode).toBe(126);
    expect(result.executionFailure?.kind).toBe("resource-limit");
    expect(result.stdout).not.toContain("BAD");
    expect(await bash.exec("printf ok")).toMatchObject({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
  });

  it("cleans all writer descriptors after a capture failure without running siblings", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 16 } });
    const result = await bash.exec(
      ": > >(printf BAD > /marker) > >(echo 1234567; echo 1234567; echo 1234567)",
    );
    expect(result.exitCode).toBe(126);
    expect(result.executionFailure?.limitType).toBe("string_length");
    expect(await bash.fs.exists("/marker")).toBe(false);
    const fresh = await bash.exec("ls /dev/fd | wc -l");
    expect(fresh).toMatchObject({ stdout: "0\n", stderr: "", exitCode: 0 });
  });

  it("retains an already completed writer when a later capture fails", async () => {
    const result = await new Bash({
      executionLimits: { maxStringLength: 16 },
    }).exec(": > >(echo 1234567; echo 1234567; echo 1234567) > >(printf yes)");
    expect(result.stdout).toBe("yes");
    expect(result.stderr).toBe(
      "bash: process substitution: string length limit exceeded (16 bytes)\n",
    );
    expect(result.exitCode).toBe(126);
    expect(result.executionFailure?.limitType).toBe("string_length");
  });
});
