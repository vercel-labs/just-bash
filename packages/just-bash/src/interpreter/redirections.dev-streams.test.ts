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
          const parent = path.slice(0, path.lastIndexOf("/")) || "/";
          if (!(await target.exists(parent)))
            throw new Error(`ENOENT: no such file or directory, '${parent}'`);
          return target[key](...args);
        };
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const both = "{ echo out; echo err >&2; }";

type Case = [script: string, stdout: string, stderr: string];

const cases: Case[] = [
  [`${both} &> /dev/stdout; echo after rc=$?`, "out\nerr\nafter rc=0\n", ""],
  [`${both} &> /dev/stderr; echo after rc=$?`, "after rc=0\n", "out\nerr\n"],
  [
    "cat /nope &>> /dev/stdout; echo after rc=$?",
    "cat: /nope: No such file or directory\nafter rc=1\n",
    "",
  ],
  ["echo g &>> /dev/stderr; echo after rc=$?", "after rc=0\n", "g\n"],
  [`${both} 2>/dev/null &> /dev/stderr; echo after`, "after\n", ""],
  [`${both} 2>&1 &>> /dev/stderr; echo after`, "out\nerr\nafter\n", ""],
  [`${both} &> /dev/stdout | tr a-z A-Z`, "OUT\nERR\n", ""],
  [
    "f() { echo out; echo err >&2; }; f &>> /dev/stderr; echo rc=$?",
    "rc=0\n",
    "out\nerr\n",
  ],
  ["exec &> /dev/stdout; echo a; echo b >&2", "a\nb\n", ""],
  [`${both} &> /dev/./stdout; echo rc=$?`, "out\nerr\nrc=0\n", ""],
  ["echo x > /dev/./stderr; echo rc=$?", "rc=0\n", "x\n"],
  ["set -C; echo x > /dev/stdout; echo rc=$?", "x\nrc=0\n", ""],
  [`set -C; ${both} &> /dev/stderr; echo rc=$?`, "rc=0\n", "out\nerr\n"],
];

const defaultFsCases: Case[] = [
  [`cd /dev && ${both} &> stdout; echo rc=$?`, "out\nerr\nrc=0\n", ""],
  [`${both} > f &> /dev/stdout; echo rc=$?; cat f`, "rc=0\nout\nerr\n", ""],
  [`${both} &> reg; cat reg`, "out\nerr\n", ""],
];

async function deviceFileSizes(fs: IFileSystem): Promise<number[]> {
  const sizes: number[] = [];
  for (const path of ["/dev/stdout", "/dev/stderr"]) {
    sizes.push((await fs.stat(path)).size);
  }
  return sizes;
}

describe("&> and &>> to /dev/stdout and /dev/stderr (default filesystem)", () => {
  it.each([
    ...cases,
    ...defaultFsCases,
  ])("%s", async (script, stdout, stderr) => {
    const fs = new InMemoryFs();
    const result = await new Bash({ fs }).exec(script);
    expect(result).toMatchObject({ stdout, stderr, exitCode: 0 });
    expect(await deviceFileSizes(fs)).toEqual([0, 0]);
  });
});

describe("&> and &>> to /dev/stdout and /dev/stderr (unseeded filesystem)", () => {
  it.each(cases)("%s", async (script, stdout, stderr) => {
    const fs = asyncOnlyPosixFs();
    const result = await new Bash({ fs, cwd: "/" }).exec(script);
    expect(result).toMatchObject({ stdout, stderr, exitCode: 0 });
    expect(await fs.exists("/dev")).toBe(false);
  });
});
