import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec exec() sub-shell", () => {
  it(
    "should execute a shell command and return result",
    { timeout: 30000 },
    async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "const r = exec('echo hello'); console.log(r.stdout.trim())"`,
      );
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    },
  );

  it("should return exit code from sub-shell", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "const r = exec('false'); console.log(r.exitCode)"`,
    );
    expect(result.stdout).toBe("1\n");
    expect(result.exitCode).toBe(0);
  });

  it("should capture stderr from sub-shell", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "const r = exec('echo error >&2'); console.log(r.stderr.trim())"`,
    );
    expect(result.stdout).toBe("error\n");
    expect(result.exitCode).toBe(0);
  });

  it("should pass stdin to sub-shell", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "const r = exec('cat', {stdin: 'piped data'}); console.log(r.stdout)"`,
    );
    expect(result.stdout).toBe("piped data\n");
    expect(result.exitCode).toBe(0);
  });

  it("should handle multi-command pipelines", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "const r = exec('echo abc | tr a-z A-Z'); console.log(r.stdout.trim())"`,
    );
    expect(result.stdout).toBe("ABC\n");
    expect(result.exitCode).toBe(0);
  });
});
