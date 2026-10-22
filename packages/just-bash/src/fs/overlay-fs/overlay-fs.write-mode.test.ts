import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { OverlayFs } from "./overlay-fs.js";

const MOUNT = "/home/user/project";

describe("OverlayFs overwrite keeps the stored mode", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-write-mode-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function overlay(): OverlayFs {
    return new OverlayFs({ root, mountPoint: MOUNT });
  }

  /** Seed a real lower-layer file at `mode`. */
  function seed(name: string, mode: number): void {
    const target = path.join(root, name);
    fs.writeFileSync(target, "#!/bin/bash\necho ran\n");
    fs.chmodSync(target, mode);
  }

  async function modeOf(fsx: OverlayFs, name: string): Promise<number> {
    return (await fsx.stat(`${MOUNT}/${name}`)).mode;
  }

  it("keeps the exec bit when a lower-layer script is truncated", async () => {
    seed("m.sh", 0o755);
    const fsx = overlay();

    await fsx.writeFile(`${MOUNT}/m.sh`, "#!/bin/bash\necho again\n");

    expect(await modeOf(fsx, "m.sh")).toBe(0o755);
  });

  it("keeps the exec bit when a lower-layer script is rewritten by sed -i", async () => {
    seed("m.sh", 0o700);
    const bash = new Bash({ fs: overlay(), cwd: MOUNT });

    const result = await bash.exec("sed -i 's/ran/again/' m.sh");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(await bash.fs.readFile(`${MOUNT}/m.sh`)).toBe(
      "#!/bin/bash\necho again\n",
    );
    expect((await bash.fs.stat(`${MOUNT}/m.sh`)).mode).toBe(0o700);
  });

  it("keeps the mode when a lower-layer file is appended to", async () => {
    seed("a.sh", 0o750);
    const fsx = overlay();

    await fsx.appendFile(`${MOUNT}/a.sh`, "y\n");

    expect(await modeOf(fsx, "a.sh")).toBe(0o750);
    expect(await fsx.readFile(`${MOUNT}/a.sh`)).toBe(
      "#!/bin/bash\necho ran\ny\n",
    );
  });

  it("keeps the mode when a memory-layer file is appended to", async () => {
    seed("a.sh", 0o750);
    const fsx = overlay();
    await fsx.writeFile(`${MOUNT}/a.sh`, "x\n");

    await fsx.appendFile(`${MOUNT}/a.sh`, "y\n");

    expect(await modeOf(fsx, "a.sh")).toBe(0o750);
  });

  it("uses the default mode for a path with no existing file", async () => {
    const fsx = overlay();

    await fsx.writeFile(`${MOUNT}/new.txt`, "content");

    expect(await modeOf(fsx, "new.txt")).toBe(0o644);
  });

  it("uses the default mode after the file has been removed", async () => {
    seed("m.sh", 0o755);
    const fsx = overlay();
    await fsx.rm(`${MOUNT}/m.sh`);

    await fsx.writeFile(`${MOUNT}/m.sh`, "x\n");

    expect(await modeOf(fsx, "m.sh")).toBe(0o644);
  });

  it("clears the set-user-ID bit on overwrite", async () => {
    seed("u.sh", 0o4755);
    const fsx = overlay();

    await fsx.writeFile(`${MOUNT}/u.sh`, "x\n");

    expect(await modeOf(fsx, "u.sh")).toBe(0o755);
  });

  it("clears the set-user-ID bit on append", async () => {
    seed("u.sh", 0o4644);
    const fsx = overlay();

    await fsx.appendFile(`${MOUNT}/u.sh`, "y\n");

    expect(await modeOf(fsx, "u.sh")).toBe(0o644);
  });

  it("keeps the set-group-ID bit of a non-group-executable file", async () => {
    seed("g.sh", 0o2644);
    const fsx = overlay();

    await fsx.writeFile(`${MOUNT}/g.sh`, "x\n");

    expect(await modeOf(fsx, "g.sh")).toBe(0o2644);
  });

  it("clears the set-group-ID bit of a group-executable file", async () => {
    seed("g.sh", 0o2755);
    const fsx = overlay();

    await fsx.writeFile(`${MOUNT}/g.sh`, "x\n");

    expect(await modeOf(fsx, "g.sh")).toBe(0o755);
  });

  it("keeps the sticky bit on overwrite", async () => {
    seed("t.sh", 0o1777);
    const fsx = overlay();

    await fsx.writeFile(`${MOUNT}/t.sh`, "x\n");

    expect(await modeOf(fsx, "t.sh")).toBe(0o1777);
  });
});
