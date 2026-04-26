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

  it("should redirect node command to js-exec with help", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(`node -e "console.log('test')"`);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "this sandbox uses js-exec instead of node",
    );
    expect(result.stderr).toContain("js-exec -c");
  });

  it("should not have node command without javascript option", async () => {
    const env = new Bash();
    const result = await env.exec(`node -e "console.log('test')"`);
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

  describe("eval and Function constructor blocked", () => {
    it("should block eval()", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { eval('1+1'); console.log('FAIL'); } catch(e) { console.log(e.constructor.name + ': ' + e.message); }"`,
      );
      expect(result.stdout).toBe("TypeError: not a function\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should block new Function()", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { new Function('return 1')(); console.log('FAIL'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toBe("Function constructor is not allowed\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should block constructor.constructor (Function via prototype chain)", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { ({}).constructor.constructor('return 42')(); console.log('FAIL'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toBe("Function constructor is not allowed\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should block AsyncFunction constructor", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { const AF = (async function(){}).constructor; new AF('return 1')(); console.log('FAIL'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toBe("Function constructor is not allowed\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should block GeneratorFunction constructor", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { const GF = (function*(){}).constructor; new GF('yield 1')().next(); console.log('FAIL'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toBe("Function constructor is not allowed\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should block AsyncGeneratorFunction constructor", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { const AGF = (async function*(){}).constructor; new AGF('yield 1')(); console.log('FAIL'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toBe("Function constructor is not allowed\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("intrinsic prototypes frozen", () => {
    it("should block prototype pollution on Object.prototype", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "Object.prototype.polluted = true; console.log('polluted' in Object.prototype)"`,
      );
      // Frozen: write silently fails in sloppy mode, property not added
      expect(result.stdout).toBe("false\n");
      expect(result.exitCode).toBe(0);
    });

    it("should block prototype pollution on Array.prototype", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "Array.prototype.polluted = true; console.log('polluted' in Array.prototype)"`,
      );
      expect(result.stdout).toBe("false\n");
      expect(result.exitCode).toBe(0);
    });

    it("should block overwriting built-in methods", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "const origToString = Object.prototype.toString; Object.prototype.toString = () => 'hacked'; console.log(Object.prototype.toString === origToString)"`,
      );
      // Frozen: the overwrite silently fails, original method remains
      expect(result.stdout).toBe("true\n");
      expect(result.exitCode).toBe(0);
    });

    it("should still allow creating objects with own properties", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "const obj = { a: 1 }; obj.b = 2; console.log(obj.a, obj.b)"`,
      );
      expect(result.stdout).toBe("1 2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should still allow array operations", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "const arr = [1,2,3]; arr.push(4); console.log(arr.join(','))"`,
      );
      expect(result.stdout).toBe("1,2,3,4\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("timer APIs not available", () => {
    it("should not have setTimeout", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(typeof setTimeout)"`,
      );
      expect(result.stdout).toBe("undefined\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not have setInterval", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(typeof setInterval)"`,
      );
      expect(result.stdout).toBe("undefined\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not have setImmediate", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(typeof setImmediate)"`,
      );
      expect(result.stdout).toBe("undefined\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("timeout DoS prevention", () => {
    it(
      "should recover after timeout — subsequent execution succeeds",
      { timeout: 30000 },
      async () => {
        const env = new Bash({
          javascript: true,
          executionLimits: { maxJsTimeoutMs: 500 },
        });
        // Infinite loop should time out
        const r1 = await env.exec(`js-exec -c "while(true){}"`);
        expect(r1.exitCode).not.toBe(0);
        expect(r1.stderr).toContain("timeout");

        // Subsequent execution on the same Bash instance should succeed
        const r2 = await env.exec(`js-exec -c "console.log('alive')"`);
        expect(r2.stdout).toBe("alive\n");
        expect(r2.exitCode).toBe(0);
      },
    );

    it(
      "should not starve a second Bash instance after first times out",
      { timeout: 30000 },
      async () => {
        const env1 = new Bash({
          javascript: true,
          executionLimits: { maxJsTimeoutMs: 500 },
        });
        const env2 = new Bash({
          javascript: true,
          executionLimits: { maxJsTimeoutMs: 5000 },
        });

        // First instance times out
        const r1 = await env1.exec(`js-exec -c "while(true){}"`);
        expect(r1.exitCode).not.toBe(0);

        // Second instance should still work
        const r2 = await env2.exec(`js-exec -c "console.log('ok')"`);
        expect(r2.stdout).toBe("ok\n");
        expect(r2.exitCode).toBe(0);
      },
    );
  });
});
