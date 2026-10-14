import * as hostFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";
import { InMemoryFs } from "../fs/in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "../fs/interface.js";
import { MountableFs } from "../fs/mountable-fs/mountable-fs.js";
import { OverlayFs } from "../fs/overlay-fs/overlay-fs.js";
import { ReadWriteFs } from "../fs/read-write-fs/read-write-fs.js";

const cases = [
  ['{ x=$(echo hi); echo "[$x]"; } >f; cat f', "[hi]\n"],
  ['{ x=`echo hi`; echo "[$x]"; } >f; cat f', "[hi]\n"],
  ['{ for i in $(seq 1 2); do echo "[$i]"; done; } >f; cat f', "[1]\n[2]\n"],
  [
    'fun() { x=$(echo hi; echo side >&2); echo "[$x]"; }; fun >f 2>&1; cat f',
    "side\n[hi]\n",
  ],
  [
    '{ x=$(echo hi; echo side >&3); echo "[$x]"; } >f 3>&1; cat f',
    "side\n[hi]\n",
  ],
  ['{ x=$(echo hi; exit 2); echo "[$x]"; } >f; cat f', "[hi]\n"],
  ['{ x=$(echo "$(echo hi)"); echo "[$x]"; } >f; cat f', "[hi]\n"],
  ["{ case x in $(echo x)) echo matched;; esac; } >f; cat f", "matched\n"],
  ["printf éé >f; exec 3<>f; printf X >&3; printf Y >&3; cat f", "XYé"],
  ["printf éé >f; { printf X; printf Y >&2; } 1<>f 2>&1; cat f", "XYé"],
  [
    "exec 4>&1; exec >f; exec 2>/dev/stdout; echo e >&2; exec >&4; cat f",
    "e\n",
  ],
  ["{ echo a; echo b >&3; } >f 2>/dev/stdout 3>&2; cat f", "b\n"],
  [
    "exec 4>&1; exec >f; exec 3>/dev/stdout; exec >&4; echo b >&3; cat f",
    "b\n",
  ],
  ["{ echo a; echo b >&3; } >f 3>/dev/stdout; cat f", "b\n"],
  ["{ echo a >&2; echo b >&3; } 2>f 3>/dev/stderr; cat f", "b\n"],
  [
    "exec 4>&1; exec >f; printf AA; exec 3>/dev/stdout; printf BB >&3; printf CC; exec >&4; cat f",
    "BBCC",
  ],
  ["exec 2>f; exec 3>/dev/stderr; exec 2>/dev/null; echo b >&3; cat f", "b\n"],
  ["{ echo a; echo b >&3; } >f 3>&1; cat f", "a\nb\n"],
  [
    "exec 9>&1; exec 1>f; exec 3>&1; { exec 3>g; echo x; } >h; echo y; cat f >&9",
    "y\n",
  ],
  ["{ echo a 1>&1; echo b >&3; } >f 3>&1; cat f", "a\nb\n"],
  ["{ echo a; echo b >&3; } >f 2>&1 3>&2; cat f", "a\nb\n"],
  ["{ echo oooo; echo e >&2; } >f 2>f; cat f", "e\noo\n"],
  ["exec 3>f; echo one >&3; echo two >&3; exec 3>&-; cat f", "one\ntwo\n"],
  ["printf abcdef >f; { echo X; echo Y >&2; } 1<>f 2>&1; cat f", "X\nY\nef"],
  ["echo a >>f; { echo b; echo c >&3; } >>f 3>&1; cat f", "a\nb\nc\n"],
  ["printf abcdef >f; exec 3<>f; printf XY >f; printf Z >&3; cat f", "ZY"],
  ["printf abcdef >f; exec 3<>f; printf X >>f; printf Y >&3; cat f", "YbcdefX"],
  ["exec 3>f; echo one >&3; echo other >f; echo two >&3; cat f", "othetwo\n"],
  ["exec 3>f; printf é >&3; printf X >&3; cat f", "éX"],
  ["{ echo abc | tr a-z A-Z; } >f; cat f", "ABC\n"],
  ["{ { echo abc >&2; } |& tr a-z A-Z; } &>f; cat f", "ABC\n"],
  ["exec 3>f; echo a >&3; (echo b >&3); echo c >&3; cat f", "a\nb\nc\n"],
  [
    "exec 3>f; echo one >&3; { echo two >&4; } 4>&3; echo three >&3; cat f",
    "one\ntwo\nthree\n",
  ],
] as const;

describe.each([
  "memory",
  "overlay",
  "read-write",
  "mountable",
])("file output offsets (%s)", (kind) => {
  let directory: string;
  let fs: IFileSystem;
  let bash: Bash;
  beforeEach(async () => {
    directory = await hostFs.mkdtemp(path.join(os.tmpdir(), "file-offsets-"));
    if (kind === "overlay")
      fs = new OverlayFs({ root: directory, mountPoint: "/" });
    else if (kind === "read-write") fs = new ReadWriteFs({ root: directory });
    else if (kind === "mountable") {
      const mounted = new MountableFs({ base: new InMemoryFs() });
      mounted.mount("/work", new ReadWriteFs({ root: directory }));
      fs = mounted;
    } else fs = new InMemoryFs();
    await fs.mkdir("/work", { recursive: true });
    bash = new Bash({ fs, cwd: "/work" });
  });
  afterEach(async () => {
    await hostFs.rm(directory, { recursive: true, force: true });
  });

  it.each(cases)("%s", async (script, stdout) => {
    expect(await bash.exec(script)).toMatchObject({
      stdout,
      stderr: "",
      exitCode: 0,
    });
    expect(await fs.readFile("/work/f")).toBe(stdout);
  });
  it("replaces a file binding with a captured live stream", async () => {
    expect(await bash.exec("{ echo x; } >f 1>&2")).toMatchObject({
      stdout: "",
      stderr: "x\n",
      exitCode: 0,
    });
    expect(await fs.readFile("/work/f")).toBe("");
  });
  it("captures stderr before a later redirect replaces it", async () => {
    expect(await bash.exec("echo hi >/dev/stderr 2>f; cat f")).toMatchObject({
      stdout: "",
      stderr: "hi\n",
      exitCode: 0,
    });
    expect(await fs.readFile("/work/f")).toBe("");
    expect(await bash.exec("echo hi >/dev/stderr 2>/dev/null")).toMatchObject({
      stdout: "",
      stderr: "hi\n",
      exitCode: 0,
    });
  });
  it("captures process-substitution output independently of the enclosing file", async () => {
    expect(
      await bash.exec("{ cat <(echo hi) >g; echo outer; } >f; cat f"),
    ).toMatchObject({
      stdout: "outer\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await fs.readFile("/work/f")).toBe("outer\n");
    expect(await fs.readFile("/work/g")).toBe("hi\n");
  });
  it.each([
    "read -r -u3 x",
    "read -r x <&3",
  ])("counts UTF-8 bytes after %s", async (read) => {
    expect(
      await bash.exec(
        `printf 'é\nZZ' >f; exec 3<>f; ${read}; printf XY >&3; echo "[$x]"; cat f`,
      ),
    ).toMatchObject({
      stdout: "[é]\né\nXY",
      stderr: "",
      exitCode: 0,
    });
    expect(await fs.readFile("/work/f")).toBe("é\nXY");
  });
  it("protects a file-backed stream device with noclobber", async () => {
    expect(
      await bash.exec(
        "exec 4>&1; exec >f; set -C; echo x 2>/dev/stdout; status=$?; exec >&4; echo $status; cat f",
      ),
    ).toMatchObject({
      stdout: "1\n",
      stderr: "bash: /dev/stdout: cannot overwrite existing file\n",
      exitCode: 0,
    });
    expect(await fs.readFile("/work/f")).toBe("");
  });
  it("names a closed stream device in its open error", async () => {
    expect(await bash.exec("echo hi 1>&- 2>/dev/stdout")).toMatchObject({
      stdout: "",
      stderr: "bash: /dev/stdout: No such file or directory\n",
      exitCode: 1,
    });
  });
  it.each([
    ">",
    "1<>",
  ])("preserves raw stdout and text stderr through %s", async (operator) => {
    const stderr = `${"x".repeat(8192)}é`;
    const mixed = defineCommand("mixed", async () => ({
      stdout: "\xc3\xa9",
      stdoutKind: "bytes",
      stderr,
      exitCode: 0,
    }));
    const shell = new Bash({ fs, cwd: "/work", customCommands: [mixed] });
    expect(await shell.exec(`mixed ${operator}f 2>&1`)).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(await fs.readFile("/work/f")).toBe(`é${stderr}`);
  });
  it("closes a file binding before the redirected body runs", async () => {
    expect(await bash.exec("{ echo x; } >f 1>&-")).toMatchObject({
      stdout: "",
      stderr: "bash: echo: write error: Bad file descriptor\n",
      exitCode: 1,
    });
    expect(await fs.readFile("/work/f")).toBe("");
  });

  it.runIf(process.env.BENCHMARK_FILE_REDIRECTS === "1")(
    "measures repeated redirected writes",
    async () => {
      if (process.env.BENCHMARK_BASE_PATH) {
        const baseline = await import(
          `${process.env.BENCHMARK_BASE_PATH}/packages/just-bash/src/Bash.ts`
        );
        bash = new baseline.Bash({ fs, cwd: "/work" });
      }
      const samples: number[] = [];
      const script = `for ((i=0;i<2000;i++)); do printf '%s\\n' '${"x".repeat(1023)}'; done >f`;
      for (let sample = 0; sample < 6; sample++) {
        const start = performance.now();
        expect(await bash.exec(script)).toMatchObject({
          stdout: "",
          stderr: "",
          exitCode: 0,
        });
        if (sample > 0) samples.push(performance.now() - start);
        expect((await fs.stat("/work/f")).size).toBe(2_048_000);
      }
      samples.sort((left, right) => left - right);
      process.stdout.write(
        `${JSON.stringify({ filesystem: kind, medianMs: samples[2], samples })}\n`,
      );
    },
  );
});
