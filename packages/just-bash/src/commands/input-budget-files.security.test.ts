import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("aggregate command file-input accounting", () => {
  it("charges transforming cat reads across command invocations", async () => {
    const bash = new Bash({
      files: {
        "/first.txt": "x\n\n\n",
        "/second.txt": "y\n\n\n",
      },
      executionLimits: {
        maxInputBytes: 7,
        maxStringLength: 100,
        maxOutputSize: 100,
      },
    });

    const result = await bash.exec("cat -s /first.txt; cat -s /second.txt");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain(
      "cat: aggregate input size limit exceeded (7 bytes)",
    );
  });

  it("charges base64 file reads across command invocations", async () => {
    const bash = new Bash({
      files: {
        "/first.b64": "YQ==",
        "/second.b64": "Yg==",
      },
      executionLimits: {
        maxInputBytes: 7,
        maxStringLength: 100,
        maxOutputSize: 100,
      },
    });

    const result = await bash.exec(
      "base64 -d /first.b64; base64 -d /second.b64",
    );

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain(
      "base64: aggregate input size limit exceeded (7 bytes)",
    );
  });
});
