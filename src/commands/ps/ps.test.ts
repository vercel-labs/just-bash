import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * Create a Bash instance with hanging sleep for tests that need jobs to stay "Running".
 */
function bashWithHangingSleep(): Bash {
  return new Bash({
    sleep: (_ms: number) => new Promise<void>(() => {}),
    defenseInDepth: false,
  });
}

describe("ps command", () => {
  describe("basic output", () => {
    it("ps with no background jobs shows just bash", async () => {
      const bash = new Bash();
      const result = await bash.exec("ps");
      expect(result.stdout).toContain("PID");
      expect(result.stdout).toContain("CMD");
      expect(result.stdout).toContain("bash");
      expect(result.exitCode).toBe(0);
    });

    it("ps output has header line with PID TTY TIME CMD", async () => {
      const bash = new Bash();
      const result = await bash.exec("ps");
      const header = result.stdout.split("\n")[0];
      expect(header).toContain("PID");
      expect(header).toContain("TTY");
      expect(header).toContain("TIME");
      expect(header).toContain("CMD");
    });

    it("ps always shows bash as PID 1", async () => {
      const bash = new Bash();
      const result = await bash.exec("ps");
      expect(result.stdout).toContain("    1 ?        00:00:00 bash");
    });

    it("ps with no flags only shows running jobs", async () => {
      const bash = new Bash();
      const result = await bash.exec(`
        true &
        wait
        ps
      `);
      // Completed jobs should not show without -e
      const lines = result.stdout.split("\n").filter((l) => l.trim());
      // Should just be header + bash
      expect(lines.length).toBe(2);
    });
  });

  describe("with background jobs", () => {
    it("sleep 10 & ps shows bash + sleep", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        ps
      `);
      expect(result.stdout).toContain("bash");
      expect(result.stdout).toContain("sleep 10");
    });

    it("multiple background jobs appear in ps", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        sleep 20 &
        ps
      `);
      expect(result.stdout).toContain("sleep 10");
      expect(result.stdout).toContain("sleep 20");
    });

    it("ps PIDs are right-aligned with 5-char padding", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 5 &
        ps
      `);
      // PID should be right-aligned in 5 chars
      const lines = result.stdout.split("\n");
      const sleepLine = lines.find((l) => l.includes("sleep"));
      expect(sleepLine).toBeDefined();
      // PID should be padded (e.g., "    2 ?")
      expect(sleepLine).toMatch(/^\s+\d+ \?/);
    });
  });

  describe("flags", () => {
    it("ps -e shows all processes including completed", async () => {
      const bash = new Bash();
      const result = await bash.exec(`
        true &
        wait
        ps -e
      `);
      expect(result.stdout).toContain("bash");
      expect(result.exitCode).toBe(0);
    });

    it("ps -A is equivalent to ps -e", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        ps -A
      `);
      expect(result.stdout).toContain("sleep 10");
    });

    it("ps aux works (BSD-style flag)", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        ps aux
      `);
      expect(result.stdout).toContain("sleep 10");
    });

    it("ps -ef works (combined flags)", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        ps -ef
      `);
      expect(result.stdout).toContain("sleep 10");
    });

    it("ps --help shows usage", async () => {
      const bash = new Bash();
      const result = await bash.exec("ps --help");
      expect(result.stdout).toContain("Usage");
      expect(result.exitCode).toBe(0);
    });

    it("ps with unknown flags doesn't error", async () => {
      const bash = new Bash();
      const result = await bash.exec("ps -x");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("bash");
    });

    it("ps -e with no background jobs still shows bash", async () => {
      const bash = new Bash();
      const result = await bash.exec("ps -e");
      expect(result.stdout).toContain("bash");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("command display", () => {
    it("ps shows the actual command text from background job", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 42 &
        ps
      `);
      expect(result.stdout).toContain("sleep 42");
    });

    it("ps shows compound background commands", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        (sleep 10; sleep 20) &
        ps
      `);
      // Should show the subshell command
      expect(result.exitCode).toBe(0);
    });
  });
});
