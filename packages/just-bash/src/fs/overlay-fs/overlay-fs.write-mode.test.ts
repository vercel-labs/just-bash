import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { OverlayFs } from "./overlay-fs.js";

describe("OverlayFs keeps a file's mode when it is overwritten", () => {
  let root: string;
  let overlay: OverlayFs;
  let bash: Bash;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-write-mode-"));
    const lower = path.join(root, "low.sh");
    fs.writeFileSync(lower, "#!/bin/bash\necho low\n");
    fs.chmodSync(lower, 0o755);
    overlay = new OverlayFs({ root, mountPoint: "/", allowSymlinks: true });
    bash = new Bash({ fs: overlay, cwd: "/" });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("keeps a lower-layer file's mode after > truncates it", async () => {
    const result = await bash.exec(`
      printf '#!/bin/bash\\necho new\\n' > low.sh
      ./low.sh; echo rc=$?
    `);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("new\nrc=0\n");
    expect((await overlay.stat("/low.sh")).mode).toBe(0o755);
    expect(fs.readFileSync(path.join(root, "low.sh"), "utf8")).toBe(
      "#!/bin/bash\necho low\n",
    );
  });

  it("keeps a lower-layer file's mode after >> appends to it", async () => {
    const result = await bash.exec(`
      echo 'echo more' >> low.sh
      ./low.sh; echo rc=$?
    `);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("low\nmore\nrc=0\n");
    expect((await overlay.stat("/low.sh")).mode).toBe(0o755);
  });

  it("keeps a memory-layer file's mode after > and sed -i", async () => {
    const result = await bash.exec(`
      printf '#!/bin/bash\\necho ran\\n' > m.sh; chmod 755 m.sh
      printf '#!/bin/bash\\necho ran\\n' > m.sh; stat -c '%a' m.sh
      sed -i 's/ran/again/' m.sh; stat -c '%a' m.sh
      ./m.sh; echo rc=$?
    `);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("755\n755\nagain\nrc=0\n");
  });

  it("gives a new file the default mode", async () => {
    await overlay.writeFile("/new.txt", "new");
    expect((await overlay.stat("/new.txt")).mode).toBe(0o644);
  });

  it("gives the default mode to a file recreated after rm", async () => {
    await overlay.rm("/low.sh");
    await overlay.writeFile("/low.sh", "new");
    expect((await overlay.stat("/low.sh")).mode).toBe(0o644);
  });

  it("gives the default mode to a file that replaces a lower-layer symlink", async () => {
    fs.symlinkSync("low.sh", path.join(root, "link.sh"));
    await overlay.writeFile("/link.sh", "new");
    const stat = await overlay.lstat("/link.sh");
    expect(stat.isFile).toBe(true);
    expect(stat.mode).toBe(0o644);
  });

  it("clears set-user-ID when > truncates a lower-layer file", async () => {
    fs.chmodSync(path.join(root, "low.sh"), 0o4755);
    await overlay.writeFile("/low.sh", "new");
    expect((await overlay.stat("/low.sh")).mode).toBe(0o755);
  });

  it("keeps set-user-ID when an empty >> opens a lower-layer file", async () => {
    fs.chmodSync(path.join(root, "low.sh"), 0o4755);
    await overlay.appendFile("/low.sh", "");
    expect((await overlay.stat("/low.sh")).mode).toBe(0o4755);
  });

  it("gives mv's destination the source's mode", async () => {
    const result = await bash.exec(`
      echo a > tmp.sh
      mv tmp.sh low.sh; stat -c '%a' low.sh
      chmod 755 low.sh; mv low.sh new.sh; stat -c '%a' new.sh
    `);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("644\n755\n");
  });
});
