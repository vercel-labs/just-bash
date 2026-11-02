import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("virtual process and resource queries", () => {
  it("reports the enforced descriptor limit without inventing OS rlimits", async () => {
    const result = await new Bash({
      executionLimits: {
        maxFileDescriptors: 23,
        maxExecutionTimeMs: 3000,
        maxLiveBytes: 4096,
      },
    }).exec(
      "ulimit -n; ulimit -Sn; ulimit -Hn; ulimit -t; ulimit -f; ulimit -v",
    );
    expect(result).toMatchObject({
      stdout: "23\n23\n23\nunlimited\nunlimited\nunlimited\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("rejects modifications and keeps its effective limit", async () => {
    const result = await new Bash({
      executionLimits: { maxFileDescriptors: 23 },
    }).exec("ulimit -n 10; echo status:$?; ulimit -n; ulimit -Ht unlimited");
    expect(result).toMatchObject({
      stdout: "status:1\n23\n",
      stderr:
        "bash: ulimit: open files: cannot modify limit: Operation not permitted\nbash: ulimit: cpu time: cannot modify limit: Operation not permitted\n",
      exitCode: 1,
    });
  });
  it("allows only signal zero for the declared virtual identities", async () => {
    const result = await new Bash({ processInfo: { pid: 123, ppid: 42 } }).exec(
      "kill -0 $$; echo own:$?; (kill -0 $BASHPID; echo sub:$?); kill -TERM 12345; kill -0 42; kill -TERM $$; kill -TERM %1",
    );
    expect(result).toMatchObject({
      stdout: "own:0\nsub:0\n",
      stderr:
        "bash: kill: (12345) - No such process\nbash: kill: (42) - No such process\nbash: kill: (123): signal delivery is unavailable in this interpreter\nbash: kill: %1: no such job\n",
      exitCode: 1,
    });
  });
  it("lets regular shell functions override these builtins", async () => {
    const result = await new Bash().exec(
      "umask() { echo mask; }; kill() { echo signal; }; ulimit() { echo limit; }; umask; kill; ulimit; builtin umask 077; builtin umask; builtin kill -0 $$",
    );
    expect(result).toMatchObject({
      stdout: "mask\nsignal\nlimit\n0077\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
