/**
 * Defense-in-Depth Hardening Tests
 *
 * Comprehensive tests for security hardening of the defense-in-depth layer:
 *
 * Category A: Unit-level blocking tests for NEW process property protections
 * Category B: Constructor chain coverage tests for EXISTING protections
 * Category C: Bash.exec() integration tests with defenseInDepth: true
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "./defense-in-depth-box.js";

describe("Defense-in-Depth Hardening", () => {
  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  afterEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  // =====================================================================
  // Category A: Unit-level blocking tests for NEW protections
  // =====================================================================
  describe("Category A: New process property blocking", () => {
    describe("process.exit blocking", () => {
      it("should block process.exit inside sandbox", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            process.exit(0);
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.exit");
      });

      it("should allow process.exit outside sandbox", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        // Outside run() context - should still be a function
        expect(typeof process.exit).toBe("function");

        handle.deactivate();
      });
    });

    describe("process.abort blocking", () => {
      it("should block process.abort inside sandbox", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            process.abort();
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.abort");
      });

      it("should allow process.abort outside sandbox", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        expect(typeof process.abort).toBe("function");

        handle.deactivate();
      });
    });

    describe("process.kill blocking", () => {
      it("should block process.kill inside sandbox", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            process.kill(process.pid, 0);
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.kill");
      });

      it("should allow process.kill outside sandbox", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        expect(typeof process.kill).toBe("function");

        handle.deactivate();
      });
    });

    describe("process.setuid blocking", () => {
      it.skipIf(!process.setuid)(
        "should block process.setuid inside sandbox",
        async () => {
          const box = DefenseInDepthBox.getInstance(true);
          const handle = box.activate();

          let error: Error | undefined;
          await handle.run(async () => {
            try {
              // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
              process.setuid!(0);
            } catch (e) {
              error = e as Error;
            }
          });

          handle.deactivate();

          expect(error).toBeInstanceOf(SecurityViolationError);
          expect(error?.message).toContain("process.setuid");
        },
      );

      it.skipIf(!process.setuid)(
        "should allow process.setuid outside sandbox",
        () => {
          const box = DefenseInDepthBox.getInstance(true);
          const handle = box.activate();

          expect(typeof process.setuid).toBe("function");

          handle.deactivate();
        },
      );
    });

    describe("process.setgid blocking", () => {
      it.skipIf(!process.setgid)(
        "should block process.setgid inside sandbox",
        async () => {
          const box = DefenseInDepthBox.getInstance(true);
          const handle = box.activate();

          let error: Error | undefined;
          await handle.run(async () => {
            try {
              // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
              process.setgid!(0);
            } catch (e) {
              error = e as Error;
            }
          });

          handle.deactivate();

          expect(error).toBeInstanceOf(SecurityViolationError);
          expect(error?.message).toContain("process.setgid");
        },
      );

      it.skipIf(!process.setgid)(
        "should allow process.setgid outside sandbox",
        () => {
          const box = DefenseInDepthBox.getInstance(true);
          const handle = box.activate();

          expect(typeof process.setgid).toBe("function");

          handle.deactivate();
        },
      );
    });

    describe("process.umask blocking", () => {
      it("should block process.umask inside sandbox", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            process.umask();
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.umask");
      });

      it("should allow process.umask outside sandbox", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        expect(typeof process.umask).toBe("function");

        handle.deactivate();
      });
    });

    describe("process.argv blocking", () => {
      it("should block process.argv access inside sandbox", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            const _argv = process.argv[0];
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.argv");
      });

      it("should allow process.argv outside sandbox", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        // Outside run() context - should work
        expect(Array.isArray(process.argv)).toBe(true);

        handle.deactivate();
      });
    });

    describe("process.execPath blocking", () => {
      it("should block process.execPath access inside sandbox", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            const _path = process.execPath;
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.execPath");
      });

      it("should block process.execPath modification inside sandbox", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            (process as unknown as Record<string, unknown>).execPath =
              "/malicious/node";
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.execPath");
      });

      it("should allow process.execPath outside sandbox", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        // Outside run() context - should work
        expect(typeof process.execPath).toBe("string");

        handle.deactivate();
      });
    });

    describe("process.chdir blocking", () => {
      it("should block process.chdir inside sandbox", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            process.chdir("/");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.chdir");
      });

      it("should allow process.chdir outside sandbox", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        expect(typeof process.chdir).toBe("function");

        handle.deactivate();
      });
    });

    // Note: process.send, process.connected, and process.channel are only
    // blocked in WorkerDefenseInDepth (not in the main-thread DefenseInDepthBox).
    // Blocking IPC properties in the main thread interferes with test runners
    // and Node.js internals that use IPC within the same async context.

    describe("process.cpuUsage blocking", () => {
      it("should block process.cpuUsage inside sandbox", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            process.cpuUsage();
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.cpuUsage");
      });

      it("should allow process.cpuUsage outside sandbox", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        expect(typeof process.cpuUsage).toBe("function");

        handle.deactivate();
      });
    });

    describe("process.memoryUsage blocking", () => {
      it("should block process.memoryUsage inside sandbox", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            process.memoryUsage();
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.memoryUsage");
      });

      it("should allow process.memoryUsage outside sandbox", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        expect(typeof process.memoryUsage).toBe("function");

        handle.deactivate();
      });
    });

    describe("process.hrtime blocking", () => {
      it("should block process.hrtime inside sandbox", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            process.hrtime();
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.hrtime");
      });

      it("should allow process.hrtime outside sandbox", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        expect(typeof process.hrtime).toBe("function");

        handle.deactivate();
      });
    });
  });

  // =====================================================================
  // Category B: Constructor chain coverage for EXISTING protections
  // =====================================================================
  describe("Category B: Constructor chain coverage for built-in types", () => {
    it("should block Map.constructor.constructor", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let error: Error | undefined;
      await handle.run(async () => {
        try {
          const m = new Map();
          const Fn = m.constructor.constructor;
          Fn("return 1");
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();
      expect(error).toBeInstanceOf(SecurityViolationError);
    });

    it("should block Set.constructor.constructor", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let error: Error | undefined;
      await handle.run(async () => {
        try {
          const s = new Set();
          const Fn = s.constructor.constructor;
          Fn("return 1");
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();
      expect(error).toBeInstanceOf(SecurityViolationError);
    });

    it("should block RegExp.constructor.constructor", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let error: Error | undefined;
      await handle.run(async () => {
        try {
          const r = /test/;
          const Fn = r.constructor.constructor;
          Fn("return 1");
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();
      expect(error).toBeInstanceOf(SecurityViolationError);
    });

    it("should block Error.constructor.constructor", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let error: Error | undefined;
      await handle.run(async () => {
        try {
          const e = new Error();
          const Fn = e.constructor.constructor;
          Fn("return 1");
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();
      expect(error).toBeInstanceOf(SecurityViolationError);
    });

    it("should block Date.constructor.constructor", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let error: Error | undefined;
      await handle.run(async () => {
        try {
          const d = new Date();
          const Fn = d.constructor.constructor;
          Fn("return 1");
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();
      expect(error).toBeInstanceOf(SecurityViolationError);
    });

    it("should block Promise.constructor.constructor", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let error: Error | undefined;
      await handle.run(async () => {
        try {
          const p = Promise.resolve();
          const Fn = p.constructor.constructor;
          Fn("return 1");
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();
      expect(error).toBeInstanceOf(SecurityViolationError);
    });

    it("should block Uint8Array.constructor.constructor", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let error: Error | undefined;
      await handle.run(async () => {
        try {
          const buf = new Uint8Array(1);
          const Fn = buf.constructor.constructor;
          Fn("return 1");
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();
      expect(error).toBeInstanceOf(SecurityViolationError);
    });

    it("should block Boolean.constructor.constructor (via true)", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let error: Error | undefined;
      await handle.run(async () => {
        try {
          const b = true;
          const Fn = b.constructor.constructor;
          Fn("return 1");
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();
      expect(error).toBeInstanceOf(SecurityViolationError);
    });

    it("should block Symbol.constructor.constructor", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let error: Error | undefined;
      await handle.run(async () => {
        try {
          const s = Symbol("test");
          const Fn = s.constructor.constructor;
          Fn("return 1");
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();
      expect(error).toBeInstanceOf(SecurityViolationError);
    });
  });

  // =====================================================================
  // Category C: Bash.exec() integration tests
  // =====================================================================
  describe("Category C: Bash.exec() integration with defenseInDepth", () => {
    it("should execute normal bash commands with defenseInDepth enabled", async () => {
      const bash = new Bash({ defenseInDepth: true });

      const result = await bash.exec('echo "hello world"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello world\n");
    });

    it("should handle arithmetic with defenseInDepth", async () => {
      const bash = new Bash({ defenseInDepth: true });

      const result = await bash.exec("echo $((5 + 3 * 2))");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("11\n");
    });

    it("should handle loops with defenseInDepth", async () => {
      const bash = new Bash({ defenseInDepth: true });

      const result = await bash.exec('for i in 1 2 3; do echo "item $i"; done');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("item 1\nitem 2\nitem 3\n");
    });

    it("should handle pipes with defenseInDepth", async () => {
      const bash = new Bash({ defenseInDepth: true });

      const result = await bash.exec(
        'echo -e "cherry\\napple\\nbanana" | sort',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("apple\nbanana\ncherry\n");
    });

    it("should handle command substitution with defenseInDepth", async () => {
      const bash = new Bash({ defenseInDepth: true });

      const result = await bash.exec('x=$(echo "inner"); echo "got: $x"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("got: inner\n");
    });

    it("should handle arrays with defenseInDepth", async () => {
      const bash = new Bash({ defenseInDepth: true });

      const result = await bash.exec(
        'arr=(alpha beta gamma); echo "${arr[1]}" "${#arr[@]}"',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("beta 3\n");
    });

    it("should handle subshells with defenseInDepth", async () => {
      const bash = new Bash({ defenseInDepth: true });

      const result = await bash.exec(
        'x=outer; (x=inner; echo "$x"); echo "$x"',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("inner\nouter\n");
    });

    it("should handle heredocs with defenseInDepth", async () => {
      const bash = new Bash({ defenseInDepth: true });

      const result = await bash.exec("cat <<EOF\nhello world\nEOF");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello world\n");
    });

    it("should handle case statements with defenseInDepth", async () => {
      const bash = new Bash({ defenseInDepth: true });

      const result = await bash.exec(`
        x="banana"
        case "$x" in
          apple) echo "fruit: apple" ;;
          banana) echo "fruit: banana" ;;
          *) echo "unknown" ;;
        esac
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("fruit: banana\n");
    });

    it("should handle comprehensive bash script with defenseInDepth", async () => {
      const bash = new Bash({ defenseInDepth: true });

      const result = await bash.exec(`
        # Arithmetic
        sum=$((10 + 20))

        # Arrays
        colors=(red green blue)

        # Loop with command substitution
        output=""
        for color in "\${colors[@]}"; do
          upper=$(echo "$color" | tr '[:lower:]' '[:upper:]')
          output="$output $upper"
        done

        # Case statement
        status="ok"
        case "$status" in
          ok) msg="success" ;;
          *) msg="failure" ;;
        esac

        # Pipe
        count=$(echo -e "a\\nb\\nc" | wc -l | tr -d ' ')

        echo "sum=$sum colors=\${#colors[@]} output=$output msg=$msg count=$count"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("sum=30");
      expect(result.stdout).toContain("colors=3");
      expect(result.stdout).toContain("RED");
      expect(result.stdout).toContain("msg=success");
      expect(result.stdout).toContain("count=3");
    });

    it("should handle concurrent exec calls with defenseInDepth", async () => {
      const bash = new Bash({ defenseInDepth: true });

      const [r1, r2, r3] = await Promise.all([
        bash.exec('echo "first"'),
        bash.exec("echo $((100 + 200))"),
        bash.exec('x="third"; echo "$x"'),
      ]);

      expect(r1.exitCode).toBe(0);
      expect(r1.stdout).toBe("first\n");
      expect(r2.exitCode).toBe(0);
      expect(r2.stdout).toBe("300\n");
      expect(r3.exitCode).toBe(0);
      expect(r3.stdout).toBe("third\n");
    });

    it("should still work after new process blocks are added", async () => {
      const bash = new Bash({ defenseInDepth: true });

      // Run multiple bash commands to verify nothing is broken
      const results = await Promise.all([
        bash.exec("echo hello"),
        bash.exec('echo -e "one\\ntwo\\nthree"'),
        bash.exec("seq 1 5 | tail -1"),
        bash.exec('test -n "foo" && echo yes || echo no'),
      ]);

      expect(results[0].stdout).toBe("hello\n");
      expect(results[1].stdout).toBe("one\ntwo\nthree\n");
      expect(results[2].stdout).toBe("5\n");
      expect(results[3].stdout).toBe("yes\n");

      for (const r of results) {
        expect(r.exitCode).toBe(0);
      }
    });
  });
});
