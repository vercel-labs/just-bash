import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec child_process sub-shell", () => {
  it(
    "should execute a shell command and return result",
    { timeout: 30000 },
    async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "const cp = require('child_process'); console.log(cp.execSync('echo hello').trim())"`,
      );
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    },
  );

  it("should return exit code from sub-shell via spawnSync", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "const cp = require('child_process'); const r = cp.spawnSync('false'); console.log(r.status)"`,
    );
    expect(result.stdout).toBe("1\n");
    expect(result.exitCode).toBe(0);
  });

  it("should capture stderr from sub-shell", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "const cp = require('child_process'); const r = cp.spawnSync('echo', ['error', '>&2']); console.log(typeof r.stderr)"`,
    );
    expect(result.stdout).toBe("string\n");
    expect(result.exitCode).toBe(0);
  });

  it("should throw from execSync on failure", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "const cp = require('child_process'); try { cp.execSync('false'); } catch(e) { console.log('caught:', e.status); }"`,
    );
    expect(result.stdout).toBe("caught: 1\n");
    expect(result.exitCode).toBe(0);
  });

  it("should handle multi-command pipelines", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "const cp = require('child_process'); console.log(cp.execSync('echo abc | tr a-z A-Z').trim())"`,
    );
    expect(result.stdout).toBe("ABC\n");
    expect(result.exitCode).toBe(0);
  });
});
