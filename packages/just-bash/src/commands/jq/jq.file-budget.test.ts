import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

const input = JSON.stringify("x".repeat(98));

describe("jq file input budgets", () => {
  it("does not reserve directory metadata as file content", async () => {
    class DirectorySizeFs extends InMemoryFs {
      override async stat(path: string) {
        const stat = await super.stat(path);
        return stat.isDirectory ? { ...stat, size: 4096 } : stat;
      }
    }
    const bash = new Bash({
      fs: new DirectorySizeFs({ "/directory/a": input }),
      executionLimits: { maxLiveBytes: 300 },
    });
    const result = await bash.exec("jq empty /directory");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("jq: /directory: No such file or directory\n");
    expect(result.exitCode).toBe(2);
  });

  it("stops the execution after a single oversized file", async () => {
    const bash = new Bash({
      files: { "/a": input },
      executionLimits: { maxInputBytes: 50 },
    });
    const result = await bash.exec("jq empty /a; jq empty /a; echo continued");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: jq: aggregate input size limit exceeded (50 bytes)\n",
    );
    expect(result.exitCode).toBe(126);
  });

  it("accounts for bytes beyond an advisory stat size", async () => {
    class AdvisorySizeFs extends InMemoryFs {
      override async stat(path: string) {
        return { ...(await super.stat(path)), size: 0 };
      }
    }
    for (const maxLiveBytes of [200, 199]) {
      const bash = new Bash({
        fs: new AdvisorySizeFs({ "/a": input }),
        executionLimits: { maxLiveBytes },
      });
      const result = await bash.exec("jq empty /a");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        maxLiveBytes === 200
          ? ""
          : "bash: jq: live byte limit exceeded (199 bytes)\n",
      );
      expect(result.exitCode).toBe(maxLiveBytes === 200 ? 0 : 126);
    }
  });

  it("charges file operands and argument files to the aggregate input budget", async () => {
    for (const command of [
      "jq empty /a /b",
      "jq -n --rawfile a /a --rawfile b /b empty",
      "jq -n --slurpfile a /a --slurpfile b /b empty",
    ]) {
      const bash = new Bash({
        files: { "/a": input, "/b": input },
        executionLimits: { maxInputBytes: 150 },
      });
      const result = await bash.exec(command);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "bash: jq: aggregate input size limit exceeded (150 bytes)\n",
      );
      expect(result.exitCode).toBe(126);
    }
  });

  it("reserves retained file text across the input batch", async () => {
    const bash = new Bash({
      files: { "/a": input, "/b": input },
      executionLimits: { maxLiveBytes: 300 },
    });
    const result = await bash.exec("jq empty /a /b");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: jq: live byte limit exceeded (300 bytes)\n",
    );
    expect(result.exitCode).toBe(126);
  });

  it("releases file reservations after file errors and successful commands", async () => {
    const bash = new Bash({
      files: { "/a": input },
      executionLimits: { maxLiveBytes: 300 },
    });
    const result = await bash.exec(
      "jq empty /missing /a; jq empty /a; jq empty /a",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("jq: /missing: No such file or directory\n");
    expect(result.exitCode).toBe(0);
  });
});
