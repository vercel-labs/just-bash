import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { ReadWriteFs } from "../fs/read-write-fs/read-write-fs.js";

describe("host-backed redirections", () => {
  let root: string;
  let data: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "just-bash-host-fd-"));
    data = join(root, "data");
    await fs.writeFile(data, "original", { mode: 0o600 });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([
    "f() { chmod 444 data; printf replacement; }; f >data",
    "exec 3>data; exec 4>&3; exec 3>&-; chmod 444 data; printf replacement >&4",
    "exec 3<>data; (exec 3>&-); chmod 444 data; printf replacement >&3",
  ])("keeps write access through chmod in %s", async (script) => {
    const bash = new Bash({ fs: new ReadWriteFs({ root }), cwd: "/" });

    expect(await bash.exec(script)).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(await fs.readFile(data, "utf8")).toBe("replacement");
    expect((await fs.stat(data)).mode & 0o777).toBe(0o444);
  });

  it("releases temporary and closed descriptors before the next iteration", async () => {
    const bash = new Bash({
      fs: new ReadWriteFs({ root }),
      cwd: "/",
      executionLimits: { maxFileDescriptors: 1 },
    });
    const result = await bash.exec(
      'for n in 1 2 3; do printf "$n" >data; exec 3>>data; printf ":$n" >&3; exec 3>&-; done',
    );

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile(data, "utf8")).toBe("3:3");
  });

  it("keeps hard-linked data isolated when opening a read-write descriptor", async () => {
    const alias = join(root, "alias");
    await fs.link(data, alias);
    const bash = new Bash({ fs: new ReadWriteFs({ root }), cwd: "/" });

    expect(await bash.exec("exec 3<>data; printf X >&3")).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(await fs.readFile(data, "utf8")).toBe("Xriginal");
    expect(await fs.readFile(alias, "utf8")).toBe("original");
  });
});
