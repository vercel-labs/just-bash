import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/index.js";
import type { IFileSystem } from "../fs/interface.js";

function asyncOnlyPosixFs(): IFileSystem {
  const mem = new InMemoryFs();
  return new Proxy(mem, {
    get(target, key) {
      if (typeof key === "string" && key.endsWith("Sync")) return undefined;
      if (key === "writeFile" || key === "appendFile") {
        return async (...args: Parameters<IFileSystem["writeFile"]>) => {
          const path = args[0];
          if (path === "/dev/null")
            throw new Error("device write reached filesystem");
          const parent = path.slice(0, path.lastIndexOf("/")) || "/";
          if (!(await target.exists(parent)))
            throw new Error(`ENOENT: no such file or directory, '${parent}'`);
          return target[key](...args);
        };
      }
      if (key === "readFile" || key === "readFileBuffer") {
        return async (...args: Parameters<IFileSystem["readFile"]>) => {
          if (args[0] === "/dev/null")
            throw new Error("device read reached filesystem");
          return target[key](...args);
        };
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const cases: [string, string][] = [
  ["echo x > /dev/null; echo after", "after\n"],
  ["echo x >| /dev/null; echo after", "after\n"],
  ["echo x >> /dev/null; echo after", "after\n"],
  ["echo x &> /dev/null; echo after", "after\n"],
  ["echo x &>> /dev/null; echo after", "after\n"],
  ["ls /nope 2> /dev/null; echo rc=$?", "rc=2\n"],
  ["ls /nope > /dev/null 2>&1; echo after rc=$?", "after rc=2\n"],
  ["if command -v ls > /dev/null; then echo has_ls; fi", "has_ls\n"],
  ["{ echo a; echo b; } > /dev/null; echo after", "after\n"],
  ["echo x 2>&1 > /dev/null | wc -c", "0\n"],
  ["set -o noclobber; echo x > /dev/null; echo rc=$?", "rc=0\n"],
  ["exec > /dev/null; echo hidden", ""],
  ["exec 3> /dev/null; echo y >&3; echo after", "after\n"],
  ["exec {fd}> /dev/null; echo y >&$fd; echo after", "after\n"],
  ["exec 3<> /dev/null; echo hi >&3; cat <&3; echo rc=$?", "rc=0\n"],
  ["wc -c < /dev/null", "0\n"],
  ["read -r v < /dev/null; echo rc=$? v=[$v]", "rc=1 v=[]\n"],
];

it("preserves a backing /dev/null file across discard and read-write redirects", async () => {
  const fs = new InMemoryFs();
  const bash = new Bash({ fs });
  await fs.writeFile("/dev/null", "sentinel");
  const result = await bash.exec(
    "echo overwrite >/dev/null; echo append >>/dev/null; exec 3<>/dev/null; echo readwrite >&3; wc -c <&3; exec 3>&-",
  );
  expect(result).toMatchObject({ stdout: "0\n", stderr: "", exitCode: 0 });
  expect(await fs.readFile("/dev/null")).toBe("sentinel");
});

it("discards relative redirects resolved to /dev/null", async () => {
  const result = await new Bash().exec(
    "cd /dev; echo x > null; wc -c < /dev/null",
  );
  expect(result).toMatchObject({ stdout: "0\n", stderr: "", exitCode: 0 });
});

describe.each([
  "default",
  "unseeded",
])("/dev/null redirects (%s filesystem)", (kind) => {
  it.each(cases)("%s", async (script, stdout) => {
    const fs = kind === "unseeded" ? asyncOnlyPosixFs() : new InMemoryFs();
    const result = await new Bash({ fs }).exec(script);
    expect(result).toMatchObject({ stdout, stderr: "", exitCode: 0 });
    if (kind === "unseeded") expect(await fs.exists("/dev")).toBe(false);
  });
});
