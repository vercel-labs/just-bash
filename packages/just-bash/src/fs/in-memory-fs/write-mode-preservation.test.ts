import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "./in-memory-fs.js";

describe("InMemoryFs overwrite keeps the stored mode", () => {
  it("keeps the mode when writeFile truncates an existing file", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/script.sh", "#!/bin/bash\n");
    await fs.chmod("/script.sh", 0o755);

    await fs.writeFile("/script.sh", "#!/bin/sh\n");

    expect((await fs.stat("/script.sh")).mode).toBe(0o755);
  });

  it("keeps the mode when writeFileSync truncates an existing file", async () => {
    const fs = new InMemoryFs();
    fs.writeFileSync("/script.sh", "#!/bin/bash\n");
    await fs.chmod("/script.sh", 0o750);

    fs.writeFileSync("/script.sh", "#!/bin/sh\n");

    expect((await fs.stat("/script.sh")).mode).toBe(0o750);
  });

  it("keeps the mode of the original entry for a replacement lazy file", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/script.sh", "#!/bin/bash\n");
    await fs.chmod("/script.sh", 0o700);

    fs.writeFileLazy("/script.sh", () => "#!/bin/sh\n");

    expect((await fs.stat("/script.sh")).mode).toBe(0o700);
  });

  it("uses the default mode for a path with no existing file", async () => {
    const fs = new InMemoryFs();

    await fs.writeFile("/new.txt", "content");

    expect((await fs.stat("/new.txt")).mode).toBe(0o644);
  });

  it("lets an explicit mode win over the stored one", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/script.sh", "#!/bin/bash\n");
    await fs.chmod("/script.sh", 0o755);

    fs.writeFileSync("/script.sh", "#!/bin/sh\n", undefined, { mode: 0o600 });

    expect((await fs.stat("/script.sh")).mode).toBe(0o600);
  });

  it("updates the mode when the previous entry was removed", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/script.sh", "#!/bin/bash\n");
    await fs.chmod("/script.sh", 0o755);
    await fs.rm("/script.sh");

    await fs.writeFile("/script.sh", "#!/bin/sh\n");

    expect((await fs.stat("/script.sh")).mode).toBe(0o644);
  });
});

describe("InMemoryFs overwrite keeps an executable script runnable", () => {
  it("runs a script truncated by a redirection and rewritten by sed -i", async () => {
    const bash = new Bash();

    const truncated = await bash.exec(
      "printf '#!/bin/bash\\necho ran\\n' > m.sh; chmod 755 m.sh; " +
        "printf '#!/bin/bash\\necho ran\\n' > m.sh; stat -c '%a' m.sh; ./m.sh",
    );
    expect(truncated.stdout).toBe("755\nran\n");
    expect(truncated.stderr).toBe("");
    expect(truncated.exitCode).toBe(0);

    const sedInPlace = await bash.exec(
      "sed -i 's/ran/again/' m.sh; stat -c '%a' m.sh; ./m.sh",
    );
    expect(sedInPlace.stdout).toBe("755\nagain\n");
    expect(sedInPlace.stderr).toBe("");
    expect(sedInPlace.exitCode).toBe(0);
  });

  it("keeps a read-only script read-only across sed -i", async () => {
    const bash = new Bash({ cwd: "/" });
    await bash.fs.writeFile("/ro.sh", "#!/bin/bash\necho ro\n");

    const result = await bash.exec(
      "chmod 400 ro.sh; sed -i 's/ro/again/' ro.sh; stat -c '%a' ro.sh; ./ro.sh; echo rc=$?",
    );

    expect(result.stdout).toBe("400\nrc=126\n");
    expect(result.stderr).toBe("bash: ./ro.sh: Permission denied\n");
    expect(result.exitCode).toBe(0);
  });
});
