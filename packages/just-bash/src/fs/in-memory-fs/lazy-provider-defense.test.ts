import { afterEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "../../security/defense-in-depth-box.js";
import { InMemoryFs } from "./in-memory-fs.js";

describe("lazy provider under defense-in-depth (#253)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    DefenseInDepthBox.resetInstance();
  });

  it("materializes a provider that settles on a macrotask during exec", async () => {
    const bash = new Bash({
      defenseInDepth: true,
      files: {
        "/async.md": async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "ASYNC_RESOLVED";
        },
      },
    });

    const result = await bash.exec("cat /async.md");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("ASYNC_RESOLVED");
    expect(result.exitCode).toBe(0);
  });

  it("materializes a provider that reads process.env during exec", async () => {
    vi.stubEnv("JUST_BASH_LAZY_TEST", "FROM_ENV");
    const bash = new Bash({
      defenseInDepth: true,
      files: {
        "/env.md": async () => process.env.JUST_BASH_LAZY_TEST ?? "",
      },
    });

    const result = await bash.exec("cat /env.md");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("FROM_ENV");
  });

  it("keeps untrusted command execution blocked after materialization", async () => {
    const probe = defineCommand(
      "probe",
      async () => {
        try {
          new Function("return 1");
          return { stdout: "unblocked\n", stderr: "", exitCode: 0 };
        } catch (error) {
          if (error instanceof SecurityViolationError) {
            return { stdout: "blocked\n", stderr: "", exitCode: 0 };
          }
          throw error;
        }
      },
      { trusted: false },
    );
    const fs = new InMemoryFs();
    fs.writeFileLazy("/late.md", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "LATE";
    });
    const bash = new Bash({
      defenseInDepth: true,
      fs,
      customCommands: [probe],
    });

    const result = await bash.exec("cat /late.md && probe");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("LATEblocked\n");
    expect(result.exitCode).toBe(0);
  });
});
