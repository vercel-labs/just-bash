import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { remoteFs } from "../../test-utils/remote-fs.js";
import { InMemoryFs } from "../in-memory-fs/in-memory-fs.js";
import { MountableFs } from "./mountable-fs.js";

describe("mounted search capabilities", () => {
  it.each([
    "grep -rn",
    "rg -s",
  ])("combines accelerated and ordinary mounts: %s", async (command) => {
    const remote = remoteFs({ "/a": "foo\n", "/b": "miss\n" });
    const fs = new MountableFs({
      base: new InMemoryFs({ "/base": "foo\n" }),
      mounts: [
        { mountPoint: "/remote", filesystem: remote.fs },
        { mountPoint: "/local", filesystem: new InMemoryFs({ "/c": "foo\n" }) },
      ],
    });
    const result = await new Bash({ fs }).exec(
      `${command} foo /base /remote /local`,
    );
    expect(result.stdout).toBe(
      command.startsWith("grep")
        ? "/base:1:foo\n/remote/a:1:foo\n/local/c:1:foo\n"
        : "/base:1:foo\n/local/c:1:foo\n/remote/a:1:foo\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(remote.batches).toEqual([["/a"]]);
    expect(remote.searches.map((request) => request.paths)).toEqual([
      ["/a", "/b"],
    ]);
  });

  it("keeps ordinary mount reads within the existing memory budget", async () => {
    const fs = new MountableFs({
      mounts: [
        {
          mountPoint: "/local",
          filesystem: new InMemoryFs({ "/a": "a".repeat(30) }),
        },
      ],
    });
    const remote = remoteFs({ "/a": "foo" });
    fs.mount("/remote", remote.fs);
    expect(fs.readMany).toBeDefined();
    fs.unmount("/remote");
    expect(fs.readMany).toBeUndefined();
    const result = await new Bash({
      fs,
      executionLimits: { maxLiveBytes: 70, maxInputBytes: 1000 },
    }).exec("rg -q a /local/a");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(
      await new MountableFs({ base: remote.fs }).readMany?.(["/a"]),
    ).toEqual([
      { status: "fulfilled", value: new TextEncoder().encode("foo") },
    ]);
  });

  it("keeps per-path results and duplicate aliases when a backend is mounted twice", async () => {
    const remote = remoteFs({ "/a": "foo\n" });
    const fs = new MountableFs({
      mounts: [
        { mountPoint: "/one", filesystem: remote.fs },
        { mountPoint: "/two", filesystem: remote.fs },
      ],
    });
    const paths = ["/two/a", "/one/missing", "/bad\0", "/one/a"];
    const results = await fs.readMany?.(paths);
    expect(results?.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
      "rejected",
      "fulfilled",
    ]);
    expect(await fs.searchCandidates({ paths, anyOf: ["foo"] })).toEqual(paths);
  });
});
