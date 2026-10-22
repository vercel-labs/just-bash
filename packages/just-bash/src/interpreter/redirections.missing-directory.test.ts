import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { ReadWriteFs } from "../fs/read-write-fs/index.js";

const REDIRECTS = [
  "echo x > missing/f",
  "echo x >| missing/f",
  "echo x >> missing/f",
  "echo x 2> missing/f",
  "echo x &> missing/f",
  "echo x &>> missing/f",
  "echo x 3> missing/f",
  "exec > missing/f",
  "exec {fd}> missing/f",
  "{ echo x; } > missing/f",
];

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "redirect-missing-dir-"));
  fs.mkdirSync(path.join(root, "dir"));
  fs.writeFileSync(path.join(root, "file"), "");
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

const filesystems = {
  InMemoryFs: () =>
    new Bash({
      cwd: "/home/user",
      files: { "/home/user/file": "" },
      redirectCreatesDirectories: false,
    }),
  ReadWriteFs: () =>
    new Bash({
      cwd: "/",
      fs: new ReadWriteFs({ root }),
      redirectCreatesDirectories: false,
    }),
};

describe.each(
  Object.keys(filesystems) as (keyof typeof filesystems)[],
)("without redirectCreatesDirectories, a redirect into a missing directory on %s", (name) => {
  it.each(
    REDIRECTS,
  )("fails %s without making the directory", async (command) => {
    const bash = filesystems[name]();
    const result = await bash.exec(
      `${command}; echo after rc=$?; test -e missing || echo no directory`,
    );
    expect(result.stdout).toBe("after rc=1\nno directory\n");
    expect(result.stderr).toBe("bash: missing/f: No such file or directory\n");
  });

  it("reports a file in the way as not a directory", async () => {
    const result = await filesystems[name]().exec(
      "echo x > file/f; echo after rc=$?",
    );
    expect(result.stdout).toBe("after rc=1\n");
    expect(result.stderr).toBe("bash: file/f: Not a directory\n");
  });

  it("still creates a file in a directory that exists", async () => {
    const result = await filesystems[name]().exec(
      "mkdir -p d; echo x > d/f; echo y >> d/g; cat d/f d/g",
    );
    expect(result.stdout).toBe("x\ny\n");
    expect(result.stderr).toBe("");
  });
});

it("makes the directory by default", async () => {
  const bash = new Bash({ cwd: "/", fs: new ReadWriteFs({ root }) });
  const result = await bash.exec("echo x > missing/f; cat missing/f");
  expect(result.stdout).toBe("x\n");
  expect(result.stderr).toBe("");
});

it("writes to /dev/stdout and /dev/stderr on a filesystem without /dev", async () => {
  const bash = new Bash({
    cwd: "/",
    fs: new ReadWriteFs({ root }),
    redirectCreatesDirectories: false,
  });
  const result = await bash.exec(
    "echo out > /dev/stdout; echo err > /dev/stderr",
  );
  expect(result.stdout).toBe("out\n");
  expect(result.stderr).toBe("err\n");
  expect(fs.existsSync(path.join(root, "dev"))).toBe(false);
});
