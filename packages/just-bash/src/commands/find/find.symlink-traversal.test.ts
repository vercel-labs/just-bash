import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

async function setup() {
  const bash = new Bash({
    files: { "/w/real/s.txt": "x\n", "/w/a.txt": "a\n" },
  });
  await bash.exec("ln -s /w/real /w/link; ln -s /missing /w/broken");
  return bash;
}

describe("symlink traversal and find regex", () => {
  it("expands ordinary globs through symlinked directories", async () => {
    const result = await (await setup()).exec(
      "echo /w/*/s.txt; echo /w/*/../link/s.txt",
    );
    expect(result).toMatchObject({
      stdout:
        "/w/link/s.txt /w/real/s.txt\n/w/link/../link/s.txt /w/real/../link/s.txt\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("honors trailing slashes and -H/-L without changing the default", async () => {
    const result = await (await setup()).exec(
      "find /w/link/ -maxdepth 1; find -H /w/link -name s.txt; find -L /w -name s.txt | sort; find /w/link -name s.txt; find -P /w/broken; find -H /w/broken; find -L /w/broken; find /w/link/ -printf '%P\\n'",
    );
    expect(result).toMatchObject({
      stdout:
        "/w/link/\n/w/link/s.txt\n/w/link/s.txt\n/w/link/s.txt\n/w/real/s.txt\n/w/broken\n/w/broken\n/w/broken\n\ns.txt\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("reports directory loops while still visiting separate aliases", async () => {
    const bash = await setup();
    await bash.exec("ln -s /w/real /w/real/loop");
    expect(
      await bash.exec("find -L /w/link /w/real -name s.txt"),
    ).toMatchObject({
      stdout: "/w/link/s.txt\n/w/real/s.txt\n",
      stderr:
        "find: /w/link/loop: File system loop detected\nfind: /w/real/loop: File system loop detected\n",
      exitCode: 1,
    });
  });

  it("requires regex predicates to match the entire path", async () => {
    const result = await (await setup()).exec(
      "find /w -regex '.*\\.tx'; find /w -size +0c -regex '.*\\.tx'; find /w -iregex '.*\\.TXT' | sort",
    );
    expect(result).toMatchObject({
      stdout: "/w/a.txt\n/w/real/s.txt\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
