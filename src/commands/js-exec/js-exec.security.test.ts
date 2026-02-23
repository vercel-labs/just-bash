import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec security", () => {
  it("should not have access to Node.js require", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "try { require('fs'); console.log('FAIL'); } catch(e) { console.log('blocked'); }"`,
    );
    expect(result.stdout).toBe("blocked\n");
    expect(result.exitCode).toBe(0);
  });

  it("should not have access to Node.js global process module", async () => {
    const env = new Bash({ javascript: true });
    // process.env in QuickJS is not the real Node.js process.env
    // Our sandboxed process only has argv, cwd, exit
    const result = await env.exec(
      `js-exec -c "console.log(typeof process.env)"`,
    );
    // process.env should be undefined (we expose env as a separate global)
    expect(result.stdout).toBe("undefined\n");
    expect(result.exitCode).toBe(0);
  });

  it("should not be available without javascript option", async () => {
    const env = new Bash();
    const result = await env.exec(`js-exec -c "console.log('test')"`);
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("command not found");
  });

  it("should isolate between executions", async () => {
    const env = new Bash({ javascript: true });
    // Set a global in first execution
    await env.exec(`js-exec -c "globalThis.secret = 42"`);
    // Check it's not available in second execution
    const result = await env.exec(
      `js-exec -c "console.log(typeof globalThis.secret)"`,
    );
    expect(result.stdout).toBe("undefined\n");
    expect(result.exitCode).toBe(0);
  });
});
