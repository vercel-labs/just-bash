import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { FakeClock } from "../testing/fake-clock.js";

/**
 * Create a Bash instance with hanging sleep for tests that need jobs to stay "Running".
 * Defense-in-depth is disabled to avoid global patching interference between tests.
 */
function bashWithHangingSleep(): Bash {
  return new Bash({
    sleep: (_ms: number) => new Promise<void>(() => {}),
    defenseInDepth: false,
  });
}

describe("background execution", () => {
  describe("basic backgrounding", () => {
    it("echo hello & should exit 0 with job announcement on stderr", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec("echo hello &");
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toMatch(/\[\d+\] \d+/);
    });

    it("$! should be non-zero after backgrounding", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo hello &
        echo $!
      `);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split("\n");
      const lastBgPid = lines.find(
        (l) => l.trim() !== "hello" && /^\d+$/.test(l.trim()),
      );
      expect(lastBgPid).toBeDefined();
      expect(Number(lastBgPid)).toBeGreaterThan(0);
    });

    it("echo hello & wait should have hello in stdout", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec("echo hello & wait");
      expect(result.stdout).toContain("hello");
      expect(result.exitCode).toBe(0);
    });

    it("false & wait $!; echo $? should print 1", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        false &
        wait $!
        echo $?
      `);
      expect(result.stdout).toContain("1");
    });

    it("job announcement format is [N] PID", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec("true &");
      // Should match [1] <number>
      expect(result.stderr).toMatch(/^\[1\] \d+\n$/);
    });

    it("second job gets [2] announcement", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec("true & true &");
      expect(result.stderr).toContain("[1]");
      expect(result.stderr).toContain("[2]");
    });

    it("$! updates after each background job", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        true &
        p1=$!
        true &
        p2=$!
        echo "$p1 $p2"
      `);
      const pidLine = result.stdout.trim().split("\n").pop() ?? "";
      const [p1, p2] = pidLine.split(" ").map(Number);
      expect(p1).toBeGreaterThan(0);
      expect(p2).toBeGreaterThan(p1);
    });

    it("background job stdout is collected", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo "from background" &
        wait
      `);
      expect(result.stdout).toContain("from background");
    });

    it("background job stderr is collected", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo "err msg" >&2 &
        wait
      `);
      expect(result.stderr).toContain("err msg");
    });

    it("background job with exit builtin", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        (exit 7) &
        wait $!
        echo $?
      `);
      expect(result.stdout).toContain("7");
    });
  });

  describe("state isolation", () => {
    it("variable changes in background do not affect parent", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        x=1
        x=2 &
        wait
        echo $x
      `);
      expect(result.stdout).toContain("1");
    });

    it("function defined in background does not leak to parent", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        f() { echo bg_func; } &
        wait
        f
      `);
      expect(result.stderr).toContain("command not found");
    });

    it("cwd change in background does not affect parent", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        cd / &
        wait
        pwd
      `);
      expect(result.stdout).toContain("/home/user");
    });

    it("background job gets its own BASHPID", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo $BASHPID &
        wait
        echo $BASHPID
      `);
      const lines = result.stdout
        .trim()
        .split("\n")
        .filter((l) => /^\d+$/.test(l.trim()));
      expect(lines.length).toBe(2);
      expect(lines[0]).not.toBe(lines[1]);
    });

    it("shell options in background do not affect parent", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        (set -e) &
        wait
        false
        echo "still running"
      `);
      expect(result.stdout).toContain("still running");
    });

    it("array modifications in background do not leak", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        arr=(a b c)
        (arr+=(d e)) &
        wait
        echo \${#arr[@]}
      `);
      expect(result.stdout).toContain("3");
    });
  });

  describe("errexit interaction", () => {
    it("set -e; false &; echo reached - should print reached", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        set -e
        false &
        echo reached
      `);
      expect(result.stdout).toContain("reached");
    });

    it("set -e does not affect background job failures", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        set -e
        (false; echo unreachable) &
        wait
        echo parent_ok
      `);
      expect(result.stdout).toContain("parent_ok");
      expect(result.stdout).not.toContain("unreachable");
    });
  });

  describe("multiple background jobs", () => {
    it("echo a & echo b & wait - both outputs present", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo a &
        echo b &
        wait
      `);
      expect(result.stdout).toContain("a");
      expect(result.stdout).toContain("b");
    });

    it("separate PIDs for separate background jobs", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo a &
        pid1=$!
        echo b &
        pid2=$!
        echo "$pid1 $pid2"
      `);
      const lines = result.stdout.trim().split("\n");
      const pidLine = lines.find((l) => l.includes(" ")) ?? "";
      const [pid1, pid2] = pidLine.split(" ");
      expect(pid1).not.toBe(pid2);
    });

    it("three background jobs with different exit codes", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        (exit 0) &
        p1=$!
        (exit 1) &
        p2=$!
        (exit 42) &
        p3=$!
        wait $p1; echo "j1=$?"
        wait $p2; echo "j2=$?"
        wait $p3; echo "j3=$?"
      `);
      expect(result.stdout).toContain("j1=0");
      expect(result.stdout).toContain("j2=1");
      expect(result.stdout).toContain("j3=42");
    });

    it("background jobs increment job IDs sequentially", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        true &
        true &
        true &
      `);
      expect(result.stderr).toContain("[1]");
      expect(result.stderr).toContain("[2]");
      expect(result.stderr).toContain("[3]");
    });
  });

  describe("max background jobs limit", () => {
    it("exceeding limit returns error", async () => {
      const clock = new FakeClock();
      const bash = new Bash({
        sleep: clock.sleep,
        executionLimits: { maxBackgroundJobs: 2 },
      });
      const result = await bash.exec(`
        sleep 100 &
        sleep 100 &
        sleep 100 &
      `);
      expect(result.stderr).toContain("limit");
    });

    it("limit of 1 allows exactly one background job", async () => {
      const bash = new Bash({
        sleep: (_ms: number) => new Promise<void>(() => {}),
        executionLimits: { maxBackgroundJobs: 1 },
        defenseInDepth: false,
      });
      const result = await bash.exec(`
        sleep 100 &
        sleep 100 &
      `);
      expect(result.stderr).toContain("[1]");
      expect(result.stderr).toContain("limit");
    });

    it("completed jobs free slots for new ones", async () => {
      const clock = new FakeClock();
      const bash = new Bash({
        sleep: clock.sleep,
        executionLimits: { maxBackgroundJobs: 1 },
      });
      const result = await bash.exec(`
        true &
        wait
        true &
        wait
        echo ok
      `);
      expect(result.stdout).toContain("ok");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("sleep with FakeClock", () => {
    it("sleep 10 & wait completes instantly with FakeClock", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const start = Date.now();
      const result = await bash.exec(`
        sleep 10 &
        wait
      `);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
      expect(result.exitCode).toBe(0);
    });

    it("multiple background sleeps complete with FakeClock", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        sleep 5 &
        sleep 10 &
        sleep 15 &
        wait
        echo all_done
      `);
      expect(result.stdout).toContain("all_done");
    });
  });

  describe("script exit cleanup", () => {
    it("remaining background jobs are cleaned up on exit", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        sleep 100 &
        echo done
      `);
      expect(result.stdout).toContain("done");
      expect(result.exitCode).toBe(0);
    });

    it("output from background jobs is collected at exit", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec("echo collected &");
      expect(result.stdout).toContain("collected");
    });

    it("multiple unwatched jobs are all cleaned up", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo one &
        echo two &
        echo three &
      `);
      expect(result.stdout).toContain("one");
      expect(result.stdout).toContain("two");
      expect(result.stdout).toContain("three");
    });
  });

  describe("background with operators", () => {
    it("true && echo yes & - conditional chain in background", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        true && echo yes &
        wait
      `);
      expect(result.stdout).toContain("yes");
    });

    it("false || echo fallback & - or chain in background", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        false || echo fallback &
        wait
      `);
      expect(result.stdout).toContain("fallback");
    });

    it("false && echo skip & - skipped in background", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        false && echo skip &
        wait
        echo done
      `);
      expect(result.stdout).not.toContain("skip");
      expect(result.stdout).toContain("done");
    });
  });

  describe("wait builtin", () => {
    it("wait with no args waits for all jobs", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo first &
        echo second &
        wait
        echo done
      `);
      expect(result.stdout).toContain("first");
      expect(result.stdout).toContain("second");
      expect(result.stdout).toContain("done");
    });

    it("wait with PID waits for specific job", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo hello &
        wait $!
        echo after
      `);
      expect(result.stdout).toContain("hello");
      expect(result.stdout).toContain("after");
    });

    it("wait with %N waits for job by number", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo hello &
        wait %1
        echo after
      `);
      expect(result.stdout).toContain("hello");
      expect(result.stdout).toContain("after");
    });

    it("wait returns exit code of waited job", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        (exit 42) &
        wait $!
        echo $?
      `);
      expect(result.stdout).toContain("42");
    });

    it("wait for non-existent PID returns error 127", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec("wait 99999");
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain("not a child");
    });

    it("wait for non-existent job spec returns error 127", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec("wait %99");
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain("no such job");
    });

    it("wait -n waits for any one job", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo first &
        echo second &
        wait -n
        echo after
      `);
      expect(result.stdout).toContain("after");
    });

    it("wait -n with no running jobs returns OK", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        true &
        wait
        wait -n
        echo ok
      `);
      expect(result.stdout).toContain("ok");
      expect(result.exitCode).toBe(0);
    });

    it("wait with no background jobs is a no-op", async () => {
      const bash = new Bash();
      const result = await bash.exec("wait; echo ok");
      expect(result.stdout).toBe("ok\n");
      expect(result.exitCode).toBe(0);
    });

    it("wait collects stdout from background job", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo "background output" &
        wait $!
      `);
      expect(result.stdout).toContain("background output");
    });

    it("wait with invalid argument returns error", async () => {
      const bash = new Bash();
      const result = await bash.exec("wait abc");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not a valid identifier");
    });

    it("wait with invalid job spec returns error", async () => {
      const bash = new Bash();
      const result = await bash.exec("wait %abc");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not a valid identifier");
    });

    it("multiple wait calls work correctly", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        (exit 1) &
        p1=$!
        (exit 2) &
        p2=$!
        wait $p1
        echo "w1=$?"
        wait $p2
        echo "w2=$?"
      `);
      expect(result.stdout).toContain("w1=1");
      expect(result.stdout).toContain("w2=2");
    });

    it("wait for already-completed job returns its exit code", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        (exit 5) &
        pid=$!
        sleep 0
        wait $pid
        echo $?
      `);
      expect(result.stdout).toContain("5");
    });
  });

  describe("job notifications", () => {
    it("completed job shows Done notification at script exit", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec("echo bg_output &");
      expect(result.stdout).toContain("bg_output");
      expect(result.stderr).toMatch(/\[\d+\] \d+/);
    });

    it("unwatched completed job shows Done before next statement", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo bg &
        sleep 0
        echo fg
      `);
      expect(result.stdout).toContain("bg");
      expect(result.stdout).toContain("fg");
    });

    it("Done notification includes command text", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        true &
        wait
        true
      `);
      expect(result.stderr).toContain("Done");
    });

    it("multiple completed jobs produce multiple notifications", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        true &
        true &
        wait
        true
      `);
      // Should have two Done notifications
      const doneCount = (result.stderr.match(/Done/g) ?? []).length;
      expect(doneCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("jobs builtin", () => {
    it("jobs shows running background jobs", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        jobs
      `);
      expect(result.stdout).toContain("Running");
      expect(result.stdout).toContain("sleep 10");
    });

    it("jobs with no background jobs produces no output", async () => {
      const bash = new Bash();
      const result = await bash.exec("jobs");
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("jobs -l shows PIDs", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        jobs -l
      `);
      expect(result.stdout).toContain("Running");
      expect(result.stdout).toMatch(/\d+/);
    });

    it("jobs -p shows PIDs only", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        jobs -p
      `);
      expect(result.stdout).toMatch(/^\d+\n$/);
      expect(result.stdout).not.toContain("Running");
    });

    it("jobs -r shows only running jobs", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        true &
        wait
        sleep 10 &
        jobs -r
      `);
      expect(result.stdout).toContain("sleep 10");
    });

    it("jobs -s shows no output (no stopped jobs in non-interactive mode)", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        jobs -s
      `);
      // No stopped jobs, so -s should produce no output
      expect(result.stdout).toBe("");
    });

    it("multiple jobs listed in order", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        sleep 20 &
        jobs
      `);
      expect(result.stdout).toContain("[1]");
      expect(result.stdout).toContain("[2]");
    });

    it("jobs output includes & suffix", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        jobs
      `);
      expect(result.stdout).toContain("&");
    });

    it("jobs -p with multiple jobs shows all PIDs", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        sleep 20 &
        jobs -p
      `);
      const pids = result.stdout.trim().split("\n");
      expect(pids.length).toBe(2);
      expect(pids[0]).not.toBe(pids[1]);
    });

    it("jobs -l includes PID in output alongside status", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        pid=$!
        jobs -l
      `);
      // Output should have both PID and "Running"
      expect(result.stdout).toContain("Running");
      const lines = result.stdout.trim().split("\n");
      expect(lines[0]).toMatch(/\[\d+\]\+\s+\d+\s+Running/);
    });
  });

  describe("kill builtin", () => {
    it("kill $! terminates a background job", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 100 &
        kill $!
        wait $!
        echo $?
      `);
      expect(result.stdout).toContain("143");
    });

    it("kill %1 terminates job by spec", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 100 &
        kill %1
        wait %1
        echo $?
      `);
      expect(result.stdout).toContain("143");
    });

    it("kill -0 checks process existence (exists)", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        kill -0 $!
        echo $?
      `);
      expect(result.stdout).toContain("0");
      expect(result.exitCode).toBe(0);
    });

    it("kill -0 non-existent PID returns error", async () => {
      const bash = new Bash();
      const result = await bash.exec("kill -0 99999");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No such process");
    });

    it("kill -l lists signal names", async () => {
      const bash = new Bash();
      const result = await bash.exec("kill -l");
      expect(result.stdout).toContain("SIGTERM");
      expect(result.stdout).toContain("SIGKILL");
      expect(result.stdout).toContain("SIGHUP");
      expect(result.stdout).toContain("SIGINT");
      expect(result.stdout).toContain("SIGQUIT");
    });

    it("kill -L also lists signals (uppercase variant)", async () => {
      const bash = new Bash();
      const result = await bash.exec("kill -L");
      expect(result.stdout).toContain("SIGTERM");
    });

    it("kill with no args shows usage", async () => {
      const bash = new Bash();
      const result = await bash.exec("kill");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("usage");
    });

    it("kill non-existent job spec returns error", async () => {
      const bash = new Bash();
      const result = await bash.exec("kill %99");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no such job");
    });

    it("kill non-existent PID returns error", async () => {
      const bash = new Bash();
      const result = await bash.exec("kill 12345");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No such process");
    });

    it("kill with invalid argument returns error", async () => {
      const bash = new Bash();
      const result = await bash.exec("kill abc");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("arguments must be process or job IDs");
    });

    it("kill already-terminated job is a no-op", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 100 &
        kill $!
        kill $!
        echo $?
      `);
      // Second kill should succeed silently (job exists but already terminated)
      expect(result.exitCode).toBe(0);
    });

    it("kill -9 sends SIGKILL (exit 128+9=137)", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 100 &
        kill -9 $!
        wait $!
        echo $?
      `);
      expect(result.stdout).toContain("137");
    });

    it("kill -TERM sends SIGTERM", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 100 &
        kill -TERM $!
        wait $!
        echo $?
      `);
      expect(result.stdout).toContain("143");
    });

    it("kill -s TERM sends SIGTERM", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 100 &
        kill -s TERM $!
        wait $!
        echo $?
      `);
      expect(result.stdout).toContain("143");
    });

    it("kill -0 multiple PIDs checks each", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        p1=$!
        sleep 20 &
        p2=$!
        kill -0 $p1 $p2
        echo $?
      `);
      expect(result.stdout).toContain("0");
    });

    it("kill with only signal arg shows usage", async () => {
      const bash = new Bash();
      const result = await bash.exec("kill -15");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("usage");
    });
  });

  describe("disown builtin", () => {
    it("disown removes most recent job", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        disown
        jobs
      `);
      expect(result.stdout).toBe("");
    });

    it("disown %N removes specific job", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        sleep 20 &
        disown %1
        jobs
      `);
      expect(result.stdout).not.toContain("[1]");
      expect(result.stdout).toContain("[2]");
    });

    it("disown -a removes all jobs", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        sleep 20 &
        disown -a
        jobs
      `);
      expect(result.stdout).toBe("");
    });

    it("disown with no jobs is a no-op", async () => {
      const bash = new Bash();
      const result = await bash.exec("disown -a");
      expect(result.exitCode).toBe(0);
    });

    it("disown non-existent job spec returns error", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        disown %99
      `);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no such job");
    });

    it("disown by PID removes job", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        disown $!
        jobs
      `);
      expect(result.stdout).toBe("");
    });

    it("disown by non-existent PID returns error", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        disown 99999
      `);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no such job");
    });

    it("disown with no jobs and specific arg returns error", async () => {
      const bash = new Bash();
      const result = await bash.exec("disown %1");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no such job");
    });

    it("disown removes highest job when called without args", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        sleep 20 &
        disown
        jobs
      `);
      // Should remove job 2 (highest), keep job 1
      expect(result.stdout).toContain("[1]");
      expect(result.stdout).not.toContain("[2]");
    });
  });

  describe("fg/bg builtins", () => {
    it("fg returns error (no job control)", async () => {
      const bash = new Bash();
      const result = await bash.exec("fg");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no job control");
    });

    it("bg returns error (no job control)", async () => {
      const bash = new Bash();
      const result = await bash.exec("bg");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no job control");
    });

    it("fg with args still returns no job control", async () => {
      const bash = bashWithHangingSleep();
      const result = await bash.exec(`
        sleep 10 &
        fg %1
      `);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no job control");
    });
  });

  describe("OutputSink streaming", () => {
    it("onOutput receives chunks for each statement", async () => {
      const chunks: Array<{ stdout: string; stderr: string }> = [];
      const bash = new Bash();
      const result = await bash.exec(
        `
        echo first
        echo second
        echo third
      `,
        { onOutput: (chunk) => chunks.push(chunk) },
      );
      const stdoutChunks = chunks.filter((c) => c.stdout.length > 0);
      expect(stdoutChunks.length).toBeGreaterThanOrEqual(3);
      expect(result.stdout).toContain("first");
      expect(result.stdout).toContain("second");
      expect(result.stdout).toContain("third");
    });

    it("onOutput + return value both work (dual channel)", async () => {
      let streamedStdout = "";
      const bash = new Bash();
      const result = await bash.exec("echo hello; echo world", {
        onOutput: (chunk) => {
          streamedStdout += chunk.stdout;
        },
      });
      expect(streamedStdout).toContain("hello");
      expect(streamedStdout).toContain("world");
      expect(result.stdout).toBe(streamedStdout);
    });

    it("command substitution does NOT stream through onOutput", async () => {
      const chunks: Array<{ stdout: string; stderr: string }> = [];
      const bash = new Bash();
      const result = await bash.exec('x=$(echo inner); echo "outer: $x"', {
        onOutput: (chunk) => chunks.push(chunk),
      });
      const allStreamed = chunks.map((c) => c.stdout).join("");
      expect(allStreamed).toContain("outer: inner");
      const innerChunks = chunks.filter(
        (c) => c.stdout === "inner\n" || c.stdout === "inner",
      );
      expect(innerChunks.length).toBe(0);
      expect(result.stdout).toBe("outer: inner\n");
    });

    it("background output appears via onOutput", async () => {
      let streamedStdout = "";
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec("echo bg & wait; echo fg", {
        onOutput: (chunk) => {
          streamedStdout += chunk.stdout;
        },
      });
      expect(streamedStdout).toContain("bg");
      expect(streamedStdout).toContain("fg");
      expect(result.stdout).toContain("bg");
      expect(result.stdout).toContain("fg");
    });

    it("onOutput receives stderr chunks too", async () => {
      const chunks: Array<{ stdout: string; stderr: string }> = [];
      const bash = new Bash();
      await bash.exec("echo err_msg >&2", {
        onOutput: (chunk) => chunks.push(chunk),
      });
      const stderrContent = chunks.map((c) => c.stderr).join("");
      expect(stderrContent).toContain("err_msg");
    });

    it("no onOutput means no callback called", async () => {
      const called = false;
      const bash = new Bash();
      await bash.exec("echo hello");
      expect(called).toBe(false);
    });

    it("onOutput not called for empty statements", async () => {
      const chunks: Array<{ stdout: string; stderr: string }> = [];
      const bash = new Bash();
      await bash.exec("true", {
        onOutput: (chunk) => chunks.push(chunk),
      });
      // true produces no stdout/stderr, so onOutput should not be called
      const nonEmpty = chunks.filter(
        (c) => c.stdout.length > 0 || c.stderr.length > 0,
      );
      expect(nonEmpty.length).toBe(0);
    });

    it("nested command substitutions are all suppressed from streaming", async () => {
      const chunks: Array<{ stdout: string; stderr: string }> = [];
      const bash = new Bash();
      await bash.exec("echo $(echo $(echo deep))", {
        onOutput: (chunk) => chunks.push(chunk),
      });
      const allStreamed = chunks.map((c) => c.stdout).join("");
      expect(allStreamed).toBe("deep\n");
      // "deep" should only appear once — from the outer echo
    });
  });

  describe("complex scenarios", () => {
    it("subshell in background", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        (echo from_subshell; echo also_subshell) &
        wait
      `);
      expect(result.stdout).toContain("from_subshell");
      expect(result.stdout).toContain("also_subshell");
    });

    it("pipeline in background", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo "hello world" | tr a-z A-Z &
        wait
      `);
      expect(result.stdout).toContain("HELLO WORLD");
    });

    it("for loop in background", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        for i in 1 2 3; do echo $i; done &
        wait
      `);
      expect(result.stdout).toContain("1");
      expect(result.stdout).toContain("2");
      expect(result.stdout).toContain("3");
    });

    it("background job with redirection to file", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        echo "written" > /tmp/bg_output &
        wait
        cat /tmp/bg_output
      `);
      expect(result.stdout).toContain("written");
    });

    it("wait inside function works", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        run_bg() {
          echo bg &
          wait
        }
        run_bg
        echo after
      `);
      expect(result.stdout).toContain("bg");
      expect(result.stdout).toContain("after");
    });

    it("background job inside if statement", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        if true; then
          echo inside_if &
        fi
        wait
      `);
      expect(result.stdout).toContain("inside_if");
    });

    it("while loop with background jobs", async () => {
      const clock = new FakeClock();
      const bash = new Bash({ sleep: clock.sleep });
      const result = await bash.exec(`
        i=0
        while [ $i -lt 3 ]; do
          echo "iter$i" &
          i=$((i + 1))
        done
        wait
      `);
      expect(result.stdout).toContain("iter0");
      expect(result.stdout).toContain("iter1");
      expect(result.stdout).toContain("iter2");
    });
  });
});
