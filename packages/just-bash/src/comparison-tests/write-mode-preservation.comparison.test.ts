import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("overwrite mode preservation - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("keeps the exec bit across a truncating redirection", async () => {
    const env = await setupFiles(testDir, {
      "m.sh": "#!/bin/bash\necho ran\n",
    });

    await compareOutputs(
      env,
      testDir,
      "chmod 755 m.sh; printf '#!/bin/bash\\necho ran\\n' > m.sh; test -x m.sh && echo kept; ./m.sh",
    );
  });

  it("keeps the exec bit across sed -i", async () => {
    const env = await setupFiles(testDir, {
      "m.sh": "#!/bin/bash\necho ran\n",
    });

    await compareOutputs(
      env,
      testDir,
      "chmod 700 m.sh; sed -i 's/ran/again/' m.sh; test -x m.sh && echo still-executable; ./m.sh",
    );
  });

  it("keeps a read-only file read-only across sed -i", async () => {
    const env = await setupFiles(testDir, {
      "m.sh": "#!/bin/bash\necho ran\n",
    });

    await compareOutputs(
      env,
      testDir,
      "chmod 400 m.sh; sed -i 's/ran/ro/' m.sh; test -x m.sh || echo not-executable; cat m.sh",
    );
  });

  it("clears the set-user-ID bit across a truncating redirection", async () => {
    const env = await setupFiles(testDir, {
      "m.sh": "#!/bin/bash\necho ran\n",
    });

    await compareOutputs(
      env,
      testDir,
      "chmod 4755 m.sh; printf 'x\\n' > m.sh; test -u m.sh || echo no-setuid; test -x m.sh && echo executable",
    );
  });

  it("clears the set-user-ID bit across sed -i", async () => {
    const env = await setupFiles(testDir, {
      "m.sh": "#!/bin/bash\necho ran\n",
    });

    await compareOutputs(
      env,
      testDir,
      "chmod 4755 m.sh; sed -i 's/ran/ro/' m.sh; test -u m.sh || echo no-setuid; test -x m.sh && echo executable",
    );
  });

  it("keeps the set-group-ID bit of a non-group-executable file", async () => {
    const env = await setupFiles(testDir, {
      "m.sh": "#!/bin/bash\necho ran\n",
    });

    await compareOutputs(
      env,
      testDir,
      "chmod 2644 m.sh; printf 'x\\n' > m.sh; test -g m.sh && echo setgid-kept; test -r m.sh && echo readable",
    );
  });

  it("clears the set-group-ID bit of a group-executable file", async () => {
    const env = await setupFiles(testDir, {
      "m.sh": "#!/bin/bash\necho ran\n",
    });

    await compareOutputs(
      env,
      testDir,
      "chmod 2755 m.sh; printf 'x\\n' > m.sh; test -g m.sh || echo no-setgid; test -x m.sh && echo executable",
    );
  });
});
