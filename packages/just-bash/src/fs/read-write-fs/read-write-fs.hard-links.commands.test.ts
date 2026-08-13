import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs hard-link containment through shell operations", () => {
  let parentDir: string;
  let sandboxDir: string;
  let outsideFile: string;
  let linkedFile: string;
  let bash: Bash;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-hard-command-"));
    sandboxDir = path.join(parentDir, "sandbox");
    const outsideDir = path.join(parentDir, "outside");
    fs.mkdirSync(sandboxDir);
    fs.mkdirSync(outsideDir);
    outsideFile = path.join(outsideDir, "victim.txt");
    linkedFile = path.join(sandboxDir, "linked.txt");
    fs.writeFileSync(outsideFile, "outside\n");
    fs.linkSync(outsideFile, linkedFile);
    bash = new Bash({ fs: new ReadWriteFs({ root: sandboxDir }), cwd: "/" });
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("creates new files while defense-in-depth is active", async () => {
    const result = await bash.exec("echo created > new-file.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(sandboxDir, "new-file.txt"), "utf8")).toBe(
      "created\n",
    );
  });

  it.each([
    [
      "append redirection",
      "echo sandbox >> linked.txt",
      "outside\nsandbox\n",
      "",
    ],
    [
      "tee overwrite",
      "echo sandbox | tee linked.txt",
      "sandbox\n",
      "sandbox\n",
    ],
    ["sed in-place", "sed -i 's/outside/sandbox/' linked.txt", "sandbox\n", ""],
    [
      "file-descriptor redirection",
      "exec 3>linked.txt; echo sandbox >&3; exec 3>&-",
      "sandbox\n",
      "",
    ],
  ])("contains %s", async (_name, script, expectedInside, expectedStdout) => {
    const result = await bash.exec(script);

    expect(result.stdout).toBe(expectedStdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(linkedFile, "utf8")).toBe(expectedInside);
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside\n");
  });

  it.each([
    ["chmod", "chmod 700 linked.txt"],
    ["touch", "touch -m -t 202001010000 linked.txt"],
  ])("contains %s metadata mutation", async (_name, script) => {
    const originalStat = fs.statSync(outsideFile);

    const result = await bash.exec(script);

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(fs.statSync(outsideFile).mode).toBe(originalStat.mode);
    expect(fs.statSync(outsideFile).mtimeMs).toBe(originalStat.mtimeMs);
  });
});
