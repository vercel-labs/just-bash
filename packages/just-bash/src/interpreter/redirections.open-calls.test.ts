import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/index.js";
import type { IFileSystem } from "../fs/interface.js";

/**
 * Every async IFileSystem call the interpreter makes, as `name(arg0,arg1)`.
 * Remote backends pay a round trip per call, so the sequence is the contract.
 */
function recordingFs(): { fs: IFileSystem; calls: string[] } {
  const inner = new InMemoryFs();
  const calls: string[] = [];
  const fs = new Proxy(inner, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (key === "resolvePath" || key === "getAllPaths") {
        return value.bind(target);
      }
      return (...args: unknown[]) => {
        const shown = args
          .slice(0, 2)
          .map((arg) => (typeof arg === "string" ? JSON.stringify(arg) : "…"))
          .join(",");
        calls.push(`${String(key)}(${shown})`);
        return value.apply(target, args);
      };
    },
  }) as IFileSystem;
  return { fs, calls };
}

async function callsFor(
  script: string,
  setup = "echo seed > existing.log",
): Promise<string[]> {
  const { fs, calls } = recordingFs();
  const bash = new Bash({ fs, cwd: "/home/user" });
  await bash.exec(setup);
  calls.length = 0;
  await bash.exec(script);
  return calls;
}

describe("backend calls per output redirect", () => {
  it("opens `> existing` with one stat and the pre-open write", async () => {
    expect(await callsFor("echo r > existing.log")).toEqual([
      'stat("/home/user/existing.log")',
      'writeFile("/home/user/existing.log","")',
      'stat("/usr/bin/echo")',
      'writeFile("/home/user/existing.log","r\\n")',
    ]);
  });

  it("opens `>> existing` with one stat and the pre-open append", async () => {
    expect(await callsFor("echo r >> existing.log")).toEqual([
      'stat("/home/user/existing.log")',
      'appendFile("/home/user/existing.log","")',
      'stat("/usr/bin/echo")',
      'appendFile("/home/user/existing.log","r\\n")',
    ]);
  });

  it("truncates `: > f` with one stat and one write", async () => {
    expect(await callsFor(": > existing.log")).toEqual([
      'stat("/home/user/existing.log")',
      'writeFile("/home/user/existing.log","")',
    ]);
  });
});

/** A backend whose exists() is the usual try/catch around stat(). */
class StatFailsFs extends InMemoryFs {
  override async stat(path: string) {
    if (path === "/guarded") {
      throw Object.assign(new Error("EIO: i/o error, stat '/guarded'"), {
        code: "EIO",
      });
    }
    return super.stat(path);
  }

  override async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }
}

describe("output redirect target stat errors", () => {
  it("refuses the redirect under noclobber instead of clobbering", async () => {
    const fs = new StatFailsFs({ "/guarded": "precious\n" });
    const result = await new Bash({ fs }).exec(
      "set -C; echo hi > /guarded; echo rc=$?",
    );
    expect(result.stdout).toBe("rc=1\n");
    expect(result.stderr).toBe("bash: /guarded: cannot open redirect target\n");
    expect(await fs.readFile("/guarded")).toBe("precious\n");
  });
});
