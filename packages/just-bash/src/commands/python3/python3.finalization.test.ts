import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Note: These tests use CPython Emscripten which loads ~9MB WASM on first run.
// The first test will be slow, subsequent tests reuse the worker.

describe("python3 executable identity and finalization", () => {
  it(
    "uses a virtual executable name instead of the host worker path",
    { timeout: 60000 },
    async () => {
      const bash = new Bash({ python: true });
      const result = await bash.exec(
        'python3 -c "import sys; print(sys.executable)"',
      );
      expect(result.stdout).toBe("/usr/bin/python3\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    },
  );

  it("runs atexit callbacks and flushes virtual file writes", async () => {
    const bash = new Bash({ python: true });
    const result = await bash.exec(`python3 -c '
import atexit
@atexit.register
def finish():
    with open("/tmp/finalized.txt", "w") as f:
        f.write("done")
    print("finalized")
print(42)
'
cat /tmp/finalized.txt`);
    expect(result.stdout).toBe("42\nfinalized\ndone");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("preserves explicit exit status and stderr through finalization", async () => {
    const bash = new Bash({ python: true });
    const result = await bash.exec(`python3 -c 'import sys
sys.stderr.write("expected error\\n")
sys.exit(7)'`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("expected error\n");
    expect(result.exitCode).toBe(7);
  });
});
