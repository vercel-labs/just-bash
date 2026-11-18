import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "./in-memory-fs.js";

const SCRIPT = "#!/bin/bash\\necho ran\\n";

describe("InMemoryFs keeps a file's mode when it is overwritten", () => {
  it("keeps the exec bit after > truncates the file", async () => {
    const bash = new Bash();
    const result = await bash.exec(`
      printf '${SCRIPT}' > m.sh; chmod 755 m.sh
      printf '${SCRIPT}' > m.sh; stat -c '%a' m.sh
      ./m.sh; echo rc=$?
    `);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("755\nran\nrc=0\n");
  });

  it("keeps the exec bit after sed -i rewrites the file", async () => {
    const bash = new Bash();
    const result = await bash.exec(`
      printf '${SCRIPT}' > m.sh; chmod 755 m.sh
      sed -i 's/ran/again/' m.sh; stat -c '%a' m.sh
      ./m.sh; echo rc=$?
    `);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("755\nagain\nrc=0\n");
  });

  it("keeps the exec bit after >> appends to the file", async () => {
    const bash = new Bash();
    const result = await bash.exec(`
      printf '${SCRIPT}' > m.sh; chmod 755 m.sh
      echo 'echo more' >> m.sh; stat -c '%a' m.sh
      ./m.sh; echo rc=$?
    `);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("755\nran\nmore\nrc=0\n");
  });

  it("keeps the mode when writeFileLazy replaces a file", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/f", "old");
    await fs.chmod("/f", 0o750);
    fs.writeFileLazy("/f", () => "new");
    expect((await fs.stat("/f")).mode).toBe(0o750);
    expect(await fs.readFile("/f")).toBe("new");
  });

  it("uses an explicit metadata.mode over the existing mode", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/f", "old");
    await fs.chmod("/f", 0o755);
    fs.writeFileSync("/f", "new", undefined, { mode: 0o600 });
    expect((await fs.stat("/f")).mode).toBe(0o600);
  });

  it("gives a new file the default mode", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/f", "new");
    expect((await fs.stat("/f")).mode).toBe(0o644);
  });

  it("gives the default mode to a file written over a directory", async () => {
    const fs = new InMemoryFs();
    await fs.mkdir("/d");
    await fs.chmod("/d", 0o700);
    await fs.writeFile("/d", "new");
    const stat = await fs.lstat("/d");
    expect(stat.isFile).toBe(true);
    expect(stat.mode).toBe(0o644);
  });

  it("does not give a file written at a symlink the symlink's mode", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/target", "t");
    await fs.chmod("/target", 0o700);
    await fs.symlink("/target", "/link");
    await fs.writeFile("/link", "new");
    expect((await fs.stat("/link")).mode).not.toBe(0o777);
    expect((await fs.stat("/target")).mode).toBe(0o700);
  });
});
