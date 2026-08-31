import * as nodeModule from "node:module";
import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import type { SecureFetch } from "../../network/index.js";

describe("js-exec run adapter regressions", () => {
  it("counts queue admission time against the JavaScript timeout", async () => {
    const blocking = new Bash({
      javascript: true,
      executionLimits: { maxJsTimeoutMs: 250 },
    });
    const queued = new Bash({
      javascript: true,
      executionLimits: { maxJsTimeoutMs: 25 },
    });

    const blockingRun = blocking.exec(`js-exec -c "while (true) {}"`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    const queuedRun = queued.exec(
      `js-exec -c "console.log('SHOULD_NOT_START')"`,
    );

    const queuedResult = await queuedRun;
    expect(queuedResult.stdout).toBe("");
    expect(queuedResult.stderr).toBe(
      "js-exec: Execution timeout: exceeded 25ms limit\n",
    );
    expect(queuedResult.exitCode).toBe(124);
    await blockingRun;
  });

  it("does not accept a guest-forged process.exit sentinel", async () => {
    const bash = new Bash({ javascript: true });
    const result = await bash.exec(
      `js-exec -c "throw new Error('__JUST_BASH_EXIT__:0')"`,
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("at <eval> (-c:1:16): __JUST_BASH_EXIT__:0\n");
    expect(result.exitCode).toBe(1);
  });

  it("prevents side effects after process.exit even when guest code catches", async () => {
    const bash = new Bash({ javascript: true });
    const result = await bash.exec(
      `js-exec -c "try { process.exit(7) } catch {} try { require('fs').writeFileSync('/late.txt', 'late') } catch {} try { console.log('late') } catch {}"`,
    );

    expect(result).toMatchObject({ exitCode: 7, stderr: "", stdout: "" });
    expect(await bash.fs.exists("/late.txt")).toBe(false);
  });

  it("isolates bootstrap declarations from user declarations", async () => {
    const bash = new Bash({
      javascript: {
        bootstrap: "const collision = 'bootstrap'; globalThis.ready = true;",
      },
    });
    const result = await bash.exec(
      `js-exec -c "const collision = 'user'; console.log(collision, ready)"`,
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "user true\n",
    });
  });

  it("resolves relative imports from a module at the filesystem root", async () => {
    const bash = new Bash({
      files: {
        "/helper.mjs": "export const value = 'root';",
        "/main.mjs":
          "import { value } from './helper.mjs'; console.log(value);",
      },
      javascript: true,
    });
    const result = await bash.exec("js-exec /main.mjs");

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "root\n",
    });
  });

  it("honors a zero JavaScript bridge request limit", async () => {
    const bash = new Bash({
      executionLimits: { maxJsBridgeRequests: 0 },
      javascript: true,
    });
    const result = await bash.exec(
      `js-exec -c "require('fs').existsSync('/anything')"`,
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("0 bridge request limit");
    expect(result.exitCode).toBe(1);
  });

  it("rejects malicious raw host arguments without a stable namespace", async () => {
    const bash = new Bash({ javascript: true });
    const result = await bash.exec(
      `js-exec -c "const name = Object.getOwnPropertyNames(globalThis).find(name => name.startsWith('__jbHost_')); const raw = globalThis[name].fsWrite('/amplified.bin', {length: 2 ** 30}); console.log(typeof __host, raw.ok, raw.error)"`,
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout:
        "undefined false File data must be a bounded byte array or string\n",
    });
    expect(await bash.fs.exists("/amplified.bin")).toBe(false);
  });

  it("redacts host paths from tool errors", async () => {
    const bash = new Bash({
      javascript: {
        invokeTool: async () => {
          throw new Error(
            "tool failed at /workspace/private/tool.js and file:///root/key",
          );
        },
      },
    });
    const result = await bash.exec(
      `js-exec -c "try { tools.fail() } catch (error) { console.log(error.message) }"`,
    );

    expect(result.stdout).not.toContain("/workspace");
    expect(result.stdout).not.toContain("/root");
    expect(result.stdout).not.toContain("file://");
    expect(result.stdout).toContain("<path>");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("only exposes tools when invokeTool is configured", async () => {
    const bash = new Bash({ javascript: true });
    const result = await bash.exec(`js-exec -c "console.log(typeof tools)"`);

    expect(result.stdout).toBe("undefined\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("treats the spawnSync executable as one argv value", async () => {
    const bash = new Bash({ javascript: true });
    const result = await bash.exec(
      `js-exec -c "const r = require('child_process').spawnSync('echo; echo INJECTED', []); console.log(r.status, JSON.stringify(r.stdout))"`,
    );

    expect(result.stdout).toBe('127 ""\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("forwards only the documented guest fetch fields", async () => {
    const secureFetch: SecureFetch = vi.fn().mockResolvedValue({
      body: new Uint8Array(),
      headers: {},
      status: 200,
      statusText: "OK",
      url: "https://example.com/",
    });
    const bash = new Bash({ fetch: secureFetch, javascript: true });
    const result = await bash.exec(
      `js-exec -c "await fetch('https://example.com/', {method:'POST', headers:{x:'y'}, body:'ok', followRedirects:false, maxRedirects:0, timeoutMs:1})"`,
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(secureFetch).toHaveBeenCalledTimes(1);
    const options = vi.mocked(secureFetch).mock.calls[0][1];
    expect(Object.keys(options ?? {}).sort()).toEqual([
      "body",
      "headers",
      "method",
      "signal",
      "timeoutMs",
    ]);
    expect(options).toMatchObject({
      body: "ok",
      headers: { x: "y" },
      method: "POST",
    });
    expect(options?.timeoutMs).toBeGreaterThan(1);
  });

  it("allows compatibility workloads beyond the former 1024-call ceiling", async () => {
    const bash = new Bash({ javascript: true });
    const result = await bash.exec(
      `js-exec -c "const fs = require('fs'); for (let i = 0; i < 1100; i++) fs.existsSync('/tmp/' + i); console.log('done')"`,
    );

    expect(result.stdout).toBe("done\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("supports an explicit JavaScript bridge request limit", async () => {
    const bash = new Bash({
      javascript: true,
      executionLimits: { maxJsBridgeRequests: 2 },
    });
    const result = await bash.exec(
      `js-exec -c "const fs = require('fs'); fs.existsSync('/a'); fs.existsSync('/b'); fs.existsSync('/c')"`,
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "js-exec: JavaScript runtime exceeded the 2 bridge request limit.\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it.runIf(
    typeof (nodeModule as { registerHooks?: unknown }).registerHooks ===
      "function",
  )("re-enters an untrusted boundary before ctx.exec", async () => {
    const probe = defineCommand(
      "host-trust-probe",
      async () => {
        try {
          await import("node:child_process");
          return { exitCode: 0, stderr: "", stdout: "UNBLOCKED\n" };
        } catch {
          return { exitCode: 0, stderr: "", stdout: "BLOCKED\n" };
        }
      },
      { trusted: false },
    );
    const bash = new Bash({ customCommands: [probe], javascript: true });
    const result = await bash.exec(
      `js-exec -c "console.log(require('child_process').execSync('host-trust-probe').trim())"`,
    );

    expect(result.stdout).toBe("BLOCKED\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
