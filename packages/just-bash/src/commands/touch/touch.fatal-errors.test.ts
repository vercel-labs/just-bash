import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";

/**
 * `touch` recovers from a file it cannot write by reporting it and carrying on
 * to the next operand. Execution limits, aborts and security violations are
 * not that kind of failure: they mean the run is over, and a command that
 * turns one into "cannot touch 'f'" both hides the real reason and lets the
 * script continue past a stop signal.
 *
 * `rethrowFatalExecutionError` exists for exactly this and its own doc comment
 * says to call it first in broad catch blocks, which the two catch blocks here
 * were not doing.
 */

class LimitOnUtimesFs extends InMemoryFs {
  override async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    if (path === "/w/boom.txt") {
      throw new ExecutionLimitError(
        "touch: output size limit exceeded (1)",
        "output_size",
      );
    }
    return super.utimes(path, atime, mtime);
  }
}

class FailingWriteFs extends InMemoryFs {
  override async writeFile(
    ...args: Parameters<InMemoryFs["writeFile"]>
  ): Promise<void> {
    if (args[0] === "/w/nope.txt") throw new Error("disk on fire");
    return super.writeFile(...args);
  }
}

class LimitOnStatFs extends InMemoryFs {
  override async stat(path: string) {
    if (path === "/w/ref.txt") {
      throw new ExecutionLimitError(
        "touch: output size limit exceeded (1)",
        "output_size",
      );
    }
    return super.stat(path);
  }
}

describe("touch propagates fatal execution errors", () => {
  it("does not report a limit from the write loop as a failed file", async () => {
    const fs = new LimitOnUtimesFs({ "/w/boom.txt": "" });
    const bash = new Bash({ fs, cwd: "/w" });

    const result = await bash.exec("touch /w/boom.txt");

    expect(result.stderr).not.toContain("cannot touch");
    expect(result.stderr).toContain("limit exceeded");
    expect(result.exitCode).toBe(126);
  });

  it("does not report a limit from -r as a missing reference", async () => {
    const fs = new LimitOnStatFs({ "/w/ref.txt": "", "/w/f.txt": "" });
    const bash = new Bash({ fs, cwd: "/w" });

    const result = await bash.exec("touch -r /w/ref.txt /w/f.txt");

    expect(result.stderr).not.toContain("failed to get attributes");
    expect(result.stderr).toContain("limit exceeded");
    expect(result.exitCode).toBe(126);
  });

  it("still reports an ordinary write failure per file", async () => {
    const fs = new FailingWriteFs({ "/w/keep": "" });
    const bash = new Bash({ fs, cwd: "/w" });

    const result = await bash.exec("touch /w/nope.txt");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("touch: cannot touch '/w/nope.txt'");
  });
});
