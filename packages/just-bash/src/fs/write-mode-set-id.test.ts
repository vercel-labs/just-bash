import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "./in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "./interface.js";
import { OverlayFs } from "./overlay-fs/overlay-fs.js";

// Recorded with GNU bash 5.1 and GNU sed 4.8 as an unprivileged user on Linux.
const SCRIPT = `
for m in 4755 2755 2644 6755 1755 4644; do
  printf 'x\\n' > f; chmod $m f; : > f; a=$(stat -c %a f)
  printf 'x\\n' > f; chmod $m f; echo y >> f; b=$(stat -c %a f)
  printf 'x\\n' > f; chmod $m f; : >> f; c=$(stat -c %a f)
  printf 'x\\n' > f; chmod $m f; sed -i 's/x/z/' f; d=$(stat -c %a f)
  echo "$m trunc=$a append=$b empty-append=$c sed-i=$d"
done
`;
const BASH_OUTPUT = `4755 trunc=755 append=755 empty-append=4755 sed-i=755
2755 trunc=755 append=755 empty-append=2755 sed-i=755
2644 trunc=2644 append=2644 empty-append=2644 sed-i=2644
6755 trunc=755 append=755 empty-append=6755 sed-i=755
1755 trunc=1755 append=1755 empty-append=1755 sed-i=1755
4644 trunc=644 append=644 empty-append=4644 sed-i=644
`;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const filesystems: [string, () => IFileSystem][] = [
  ["InMemoryFs", () => new InMemoryFs()],
  [
    "OverlayFs",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "write-set-id-"));
      roots.push(root);
      return new OverlayFs({ root, mountPoint: "/" });
    },
  ],
];

describe.each(filesystems)("%s set-ID bits after a write", (_, create) => {
  it("clears set-ID bits the way bash does", async () => {
    const bash = new Bash({ fs: create(), cwd: "/" });
    const result = await bash.exec(SCRIPT);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(BASH_OUTPUT);
  });
});
