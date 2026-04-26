import { describe, expect, it } from "vitest";
import { Sandbox } from "./Sandbox.js";

describe("Sandbox API security hardening", () => {
  describe("shell-injection resistance", () => {
    it("does not execute shell metacharacters in writeFiles paths", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.writeFiles({
        "/safe;touch /pwned_write/marker.txt": "safe-content",
      });

      const intended = await sandbox.readFile(
        "/safe;touch /pwned_write/marker.txt",
      );
      const pwnedExists =
        await sandbox.bashEnvInstance.fs.exists("/pwned_write");

      expect(intended).toBe("safe-content");
      expect(pwnedExists).toBe(false);
    });

    it("does not execute shell metacharacters in mkDir paths", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.mkDir("/tmp; touch /pwned_mkdir", { recursive: true });

      const intendedExists = await sandbox.bashEnvInstance.fs.exists(
        "/tmp; touch /pwned_mkdir",
      );
      const pwnedExists =
        await sandbox.bashEnvInstance.fs.exists("/pwned_mkdir");

      expect(intendedExists).toBe(true);
      expect(pwnedExists).toBe(false);
    });

    it("treats object-form cmd as argv by default (no shell parse)", async () => {
      const sandbox = await Sandbox.create();
      const result = await sandbox.runCommand({
        cmd: "echo ok; touch /pwned_run",
      });

      const pwnedExists = await sandbox.bashEnvInstance.fs.exists("/pwned_run");
      expect(await result.stdout()).toBe("");
      expect(await result.stderr()).toBe(
        "bash: echo ok; touch /pwned_run: No such file or directory\n",
      );
      expect(result.exitCode).toBe(127);
      expect(pwnedExists).toBe(false);
    });

    it("supports shell parsing in string command mode", async () => {
      const sandbox = await Sandbox.create();
      const result = await sandbox.runCommand(
        "echo shell-out; echo shell-err >&2",
      );

      expect(await result.stdout()).toBe("shell-out\n");
      expect(await result.stderr()).toBe("shell-err\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("cancellation plumbing", () => {
    it("applies sandbox-level timeoutMs to runCommand", async () => {
      const sandbox = await Sandbox.create({ timeoutMs: 100 });
      const start = Date.now();
      const result = await sandbox.runCommand("sleep", ["1"]);
      const elapsedMs = Date.now() - start;

      expect(elapsedMs).toBeLessThan(500);
      expect(await result.stdout()).toBe("");
      expect(await result.stderr()).toBe("");
      expect([0, 124]).toContain(result.exitCode);
    });

    it("propagates AbortSignal in string+args runCommand form", async () => {
      const sandbox = await Sandbox.create();
      const controller = new AbortController();
      const start = Date.now();
      const run = sandbox.runCommand("sleep", ["1"], {
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 100);
      const result = await run;
      const elapsedMs = Date.now() - start;

      expect(elapsedMs).toBeLessThan(500);
      expect(await result.stdout()).toBe("");
      expect(await result.stderr()).toBe("");
      expect([0, 124]).toContain(result.exitCode);
    });

    it("propagates AbortSignal in object runCommand form", async () => {
      const sandbox = await Sandbox.create();
      const controller = new AbortController();
      const start = Date.now();
      const run = sandbox.runCommand({
        cmd: "sleep",
        args: ["1"],
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 100);
      const result = await run;
      const elapsedMs = Date.now() - start;

      expect(elapsedMs).toBeLessThan(500);
      expect(await result.stdout()).toBe("");
      expect(await result.stderr()).toBe("");
      expect([0, 124]).toContain(result.exitCode);
    });
  });
});
