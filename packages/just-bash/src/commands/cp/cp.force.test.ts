import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ReadWriteFs } from "../../fs/read-write-fs/read-write-fs.js";

describe("cp -f", () => {
  it.each([
    "cp -f /src.txt /dst.txt",
    "cp --force /src.txt /dst.txt",
    "cp -pf /src.txt /dst.txt",
    "cp -f -- /src.txt /dst.txt",
  ])("accepts %s and overwrites the destination", async (command) => {
    const bash = new Bash({
      files: { "/src.txt": "new\n", "/dst.txt": "old\n" },
    });

    const result = await bash.exec(command);

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(await bash.readFile("/dst.txt")).toBe("new\n");
  });

  it.each([
    "-rf",
    "-fr",
    "-Rf",
    "-r --force",
  ])("combines with recursive copies as %s", async (flags) => {
    const bash = new Bash({
      files: { "/src/a.txt": "new\n", "/dst/src/a.txt": "old\n" },
    });

    const result = await bash.exec(`cp ${flags} /src /dst`);

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(await bash.readFile("/dst/src/a.txt")).toBe("new\n");
  });

  it.each([
    "-nf",
    "-fn",
    "-n --force",
  ])("lets -n keep the destination as %s", async (flags) => {
    const bash = new Bash({
      files: { "/src.txt": "new\n", "/dst.txt": "old\n" },
    });

    const result = await bash.exec(`cp ${flags} /src.txt /dst.txt`);

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(await bash.readFile("/dst.txt")).toBe("old\n");
  });

  it("lists -f in --help", async () => {
    const bash = new Bash();

    const result = await bash.exec("cp --help");

    expect(result.stdout).toBe(
      "cp - copy files and directories\n\n" +
        "Usage: cp [OPTION]... SOURCE... DEST\n\n" +
        "Options:\n" +
        "  -r, -R, --recursive  copy directories recursively\n" +
        "  -f, --force          if an existing destination file cannot be opened,\n" +
        "                       remove it and try again (ignored with -n)\n" +
        "  -n, --no-clobber     do not overwrite an existing file\n" +
        "  -p, --preserve       preserve file attributes\n" +
        "  -v, --verbose        explain what is being done\n" +
        "      --help           display this help and exit\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("still rejects unknown options", async () => {
    const bash = new Bash({ files: { "/src.txt": "new\n" } });

    const result = await bash.exec("cp -fx /src.txt /dst.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("cp: invalid option -- 'x'\n");
    expect(result.exitCode).toBe(1);
  });
});

// Root ignores file modes, so these only mean something for a regular user.
describe.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "cp -f with a destination that cannot be opened for writing",
  () => {
    let root: string;
    const lockedDirectories: string[] = [];

    function setup(maxFileReadSize?: number): Bash {
      root = nodeFs.mkdtempSync(path.join(os.tmpdir(), "cp-force-"));
      nodeFs.writeFileSync(path.join(root, "src.txt"), "new\n");
      nodeFs.writeFileSync(path.join(root, "dst.txt"), "old\n");
      nodeFs.chmodSync(path.join(root, "dst.txt"), 0o444);
      return new Bash({
        fs: new ReadWriteFs({ root, maxFileReadSize }),
        cwd: "/",
      });
    }

    function readHost(name: string): string {
      return nodeFs.readFileSync(path.join(root, name), "utf8");
    }

    afterEach(() => {
      for (const directory of lockedDirectories.splice(0)) {
        nodeFs.chmodSync(directory, 0o755);
      }
      nodeFs.rmSync(root, { recursive: true, force: true });
    });

    it("fails without -f and keeps the destination", async () => {
      const bash = setup();

      const result = await bash.exec("cp src.txt dst.txt");

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "cp: cannot copy 'src.txt': EACCES: cannot open destination for writing, cp '/dst.txt'\n",
      );
      expect(result.exitCode).toBe(1);
      expect(readHost("dst.txt")).toBe("old\n");
    });

    it("removes the destination and copies again", async () => {
      const bash = setup();

      const result = await bash.exec("cp -f src.txt dst.txt");

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(readHost("dst.txt")).toBe("new\n");
      expect(nodeFs.statSync(path.join(root, "dst.txt")).mode & 0o222).not.toBe(
        0,
      );
    });

    it("reports the removal with -v", async () => {
      const bash = setup();

      const result = await bash.exec("cp -fv src.txt dst.txt");

      expect(result.stdout).toBe(
        "'src.txt' -> '/dst.txt'\nremoved '/dst.txt'\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(readHost("dst.txt")).toBe("new\n");
    });

    it("keeps the destination when -n is also given", async () => {
      const bash = setup();

      const result = await bash.exec("cp -fn src.txt dst.txt");

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(readHost("dst.txt")).toBe("old\n");
    });

    it("reports a destination it cannot remove", async () => {
      const bash = setup();
      const directory = path.join(root, "locked");
      nodeFs.mkdirSync(directory);
      nodeFs.writeFileSync(path.join(directory, "dst.txt"), "old\n");
      nodeFs.chmodSync(path.join(directory, "dst.txt"), 0o444);
      nodeFs.chmodSync(directory, 0o555);
      lockedDirectories.push(directory);

      const result = await bash.exec("cp -f src.txt locked/dst.txt");

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "cp: cannot remove '/locked/dst.txt': Permission denied\n",
      );
      expect(result.exitCode).toBe(1);
      expect(readHost("locked/dst.txt")).toBe("old\n");
    });

    it("keeps the destination when the source cannot be read", async () => {
      const bash = setup();
      nodeFs.chmodSync(path.join(root, "src.txt"), 0o000);

      const result = await bash.exec("cp -f src.txt dst.txt");

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "cp: cannot open 'src.txt' for reading: Permission denied\n",
      );
      expect(result.exitCode).toBe(1);
      expect(readHost("dst.txt")).toBe("old\n");
    });

    it("replaces read-only files inside a target directory", async () => {
      const bash = setup();
      nodeFs.mkdirSync(path.join(root, "out"));
      nodeFs.writeFileSync(path.join(root, "out/src.txt"), "stale\n");
      nodeFs.chmodSync(path.join(root, "out/src.txt"), 0o444);

      const result = await bash.exec("cp -f src.txt dst.txt out");

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(readHost("out/src.txt")).toBe("new\n");
      expect(readHost("out/dst.txt")).toBe("old\n");
    });

    it.each([
      "cp",
      "cp -f",
    ])("leaves a FIFO destination in place with %s", async (command) => {
      const bash = setup();
      execFileSync("mkfifo", [path.join(root, "fifo")]);

      const result = await bash.exec(`${command} src.txt fifo`);

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "cp: cannot copy 'src.txt': EACCES: cannot copy over special file '/fifo'\n",
      );
      expect(result.exitCode).toBe(1);
      expect(nodeFs.lstatSync(path.join(root, "fifo")).isFIFO()).toBe(true);
    });

    it("replaces the destination with a source above maxFileReadSize", async () => {
      const bash = setup(1000);
      const content = "x".repeat(2000);
      nodeFs.writeFileSync(path.join(root, "src.txt"), content);

      const result = await bash.exec("cp -f src.txt dst.txt");

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(readHost("dst.txt")).toBe(content);
    });
  },
);
