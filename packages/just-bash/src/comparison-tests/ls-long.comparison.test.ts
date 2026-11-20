import { afterEach, beforeEach, describe, it } from "vitest";
import { Bash } from "../Bash.js";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

// GNU coreutils 9.7 fixtures: only the recorded box:box owner and native link
// count are mapped to A12's explicit user:user/1. Sizes, columns, modes, totals,
// timestamps and ordering are compared exactly. Files are not sparse.
const normalize =
  "sed -E 's/^([dl-][rwxstST-]{9}) +[0-9]+ box box /\\1 1 user user /'";
const metadata = {
  uid: 1000,
  gid: 1000,
  user: "user",
  group: "user",
  nlink: 1,
  directorySize: 4096,
  allocationBlockSize: 4096,
};
const seed =
  'chmod 4751 d/a; chmod 1770 d/sub; touch -d "2000-01-02T03:04:05Z" . d d/a d/b d/.hidden d/sub d/sub/c; ';

describe("GNU ls long format with explicit A12 metadata", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(directory);
  });
  for (const flags of [
    "-l",
    "-la",
    "-lt",
    "-ld",
    "-lh",
    "-lR",
    "-lr",
    "-lS",
    "-lA",
    "-lF",
    "-l --color=never",
    "-l --time-style=long-iso",
    "-l --time-style=full-iso",
    "-l --time-style=+%Y",
    "-1 --time-style=+%Y",
    "-l1",
    "-1l",
    "-lAa",
    "-laA",
    "-Far",
    "-FAr",
  ])
    it(flags, async () => {
      const files = {
        "d/a": "a".repeat(17),
        "d/b": "b".repeat(1025),
        "d/.hidden": "",
        "d/sub/c": "child",
      };
      await setupFiles(directory, files);
      const virtualFiles: Record<string, string> = Object.create(null);
      for (const [name, content] of Object.entries(files))
        virtualFiles[`${directory}/${name}`] = content;
      const env = new Bash({
        cwd: directory,
        files: virtualFiles,
        virtualFileMetadata: metadata,
        environmentInfo: { timeZone: "UTC" },
      });
      await compareOutputs(
        env,
        directory,
        `${seed}LC_ALL=C TZ=UTC ls ${flags} d | ${normalize}`,
      );
    });

  it("aligns one block of mixed file and directory operands", async () => {
    const files = {
      "d/a": "a".repeat(17),
      "d/b": "b".repeat(1025),
      "d/.hidden": "",
      "d/sub/c": "child",
    };
    await setupFiles(directory, files);
    const virtualFiles: Record<string, string> = Object.create(null);
    for (const [name, content] of Object.entries(files))
      virtualFiles[`${directory}/${name}`] = content;
    const env = new Bash({
      cwd: directory,
      files: virtualFiles,
      virtualFileMetadata: metadata,
      environmentInfo: { timeZone: "UTC" },
    });
    await compareOutputs(
      env,
      directory,
      `${seed}LC_ALL=C TZ=UTC ls -ld d/a d/b d/sub | ${normalize}`,
    );
  });

  it("preserves symlinks and dangling links in long listings", async () => {
    const env = await setupFiles(directory, { a: "text" });
    await compareOutputs(
      env,
      directory,
      `chmod 755 a; ln -s a link; ln -s missing dangling; LC_ALL=C TZ=UTC ls -lF --time-style=+STAMP link dangling | ${normalize}`,
    );
  });

  it("uses GNU human-size rounding at unit boundaries", async () => {
    const sizes = [17, 1024, 1025, 1537, 10239, 10240, 1048575, 1048576];
    const files: Record<string, string> = Object.create(null);
    sizes.forEach((_size, index) => {
      files[`f${index}`] = "";
    });
    const env = await setupFiles(directory, files);
    const populate = sizes
      .map((size, index) => `printf %${size}s x > f${index}`)
      .join("; ");
    await compareOutputs(
      env,
      directory,
      `${populate}; LC_ALL=C TZ=UTC ls -lh f* | awk '{print $5}'`,
    );
  });
});
