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
          if (!(await target.exists(parent))) {
            throw new Error(`ENOENT: no such file or directory, '${parent}'`);
          }
          return target[key](...args);
        };
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const cases: [script: string, stdout: string, stderr?: string][] = [
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
  ["exec 3<> /dev/null; echo hi >&3; cat <&3; echo rc=$?", "rc=0\n"],
  ["wc -c < /dev/null", "0\n"],
  ["read -r v < /dev/null; echo rc=$? v=[$v]", "rc=1 v=[]\n"],
  ["echo x &> /dev/stderr; echo after", "after\n", "x\n"],
  ["echo x &>> /dev/stdout; echo after", "x\nafter\n"],
  ["echo x 2> /dev/stdout; echo after", "x\nafter\n"],
  ["echo hi > /out 3> /dev/stdout >&3; echo [$(cat /out)]", "[hi]\n"],
  ["(exec > /out; exec > /dev/stdout; echo hi); echo [$(cat /out)]", "[hi]\n"],
  [
    "(exec > /out; set -o noclobber; echo x > /dev/stdout; echo rc=$? >&2); cat /out",
    "",
    "bash: /dev/stdout: cannot overwrite existing file\nrc=1\n",
  ],
];

describe("/dev redirections on a filesystem without /dev", () => {
  it.each(cases)("%s", async (script, stdout, stderr = "") => {
    const fs = asyncOnlyPosixFs();
    const result = await new Bash({ fs }).exec(script);
    expect(result).toMatchObject({ stdout, stderr, exitCode: 0 });
    expect(await fs.exists("/dev")).toBe(false);
  });
});

describe("/dev redirections on the default filesystem", () => {
  it.each<[script: string, stdout: string, stderr?: string]>([
    ...cases,
    ["cd /dev && echo x > null; wc -c < /dev/null", "0\n"],
    ["cd /dev && echo x > stdout", "x\n"],
    ["set -o noclobber; echo x > /dev/stdout; echo rc=$?", "x\nrc=0\n"],
    [
      "mkdir /tmp/w && cd /tmp/w && { cd /dev; echo hi; } > stdout; echo [$(cat /tmp/w/stdout)]",
      "[hi]\n",
    ],
    [
      "mkdir /tmp/w && cd /tmp/w && f() { cd /dev; echo hi; }; f > null; echo [$(cat /tmp/w/null)]",
      "[hi]\n",
    ],
    [
      "(exec > /tmp/out; cd /dev; exec > stdout; echo hi); echo [$(cat /tmp/out)]",
      "[hi]\n",
    ],
  ])("%s", async (script, stdout, stderr = "") => {
    const result = await new Bash().exec(script);
    expect(result).toMatchObject({ stdout, stderr, exitCode: 0 });
  });

  it("discards appended output instead of accumulating it", async () => {
    const result = await new Bash().exec(
      "for i in $(seq 1 100); do echo line-$i >> /dev/null; done; echo hello > /dev/null; wc -c < /dev/null; cat /dev/null",
    );
    expect(result.stdout).toBe("0\n");
  });
});
