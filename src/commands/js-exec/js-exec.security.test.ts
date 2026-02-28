import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec security", () => {
  it("should support require for known modules but not arbitrary ones", async () => {
    const env = new Bash({ javascript: true });
    // require('fs') should work (sandboxed)
    const r1 = await env.exec(
      `js-exec -c "const fs = require('fs'); console.log(typeof fs.readFileSync)"`,
    );
    expect(r1.stdout).toBe("function\n");
    expect(r1.exitCode).toBe(0);

    // require('http') should throw (not a supported module)
    const r2 = await env.exec(
      `js-exec -c "try { require('http'); console.log('FAIL'); } catch(e) { console.log('blocked'); }"`,
    );
    expect(r2.stdout).toBe("blocked\n");
    expect(r2.exitCode).toBe(0);
  });

  it("should have sandboxed process (not real Node.js process)", async () => {
    const env = new Bash({ javascript: true });
    // process.env is our sandboxed env object, not the real Node.js process.env
    const result = await env.exec(
      `js-exec -c "console.log(typeof process.env, typeof process.pid)"`,
    );
    // process.env exists (sandboxed), process.pid does not (not exposed)
    expect(result.stdout).toBe("object undefined\n");
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
