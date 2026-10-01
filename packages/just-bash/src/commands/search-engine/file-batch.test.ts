import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { readBatch } from "../../fs/read-many.js";
import { remoteFs } from "../../test-utils/remote-fs.js";
import { getCandidates } from "./file-batch.js";

describe("search batch boundaries", () => {
  it.each([
    "grep -n",
    "rg -sn",
  ])("does not search unrequested candidates: %s", async (command) => {
    const remote = remoteFs({ "/a": "foo", "/outside": "foo" });
    remote.fs.searchCandidates = async () => ["/outside"];
    const result = await new Bash({ fs: remote.fs }).exec(`${command} foo /a`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
    expect(remote.batches).toEqual([]);
  });
  it("stops after cancellation without retrying reads", async () => {
    const remote = remoteFs({ "/a": "foo" });
    const controller = new AbortController();
    remote.fs.searchCandidates = async ({ signal }) => {
      expect(signal).toBe(controller.signal);
      controller.abort(new Error("stopped"));
      return [];
    };
    await expect(
      getCandidates(
        remote.fs,
        ["/a"],
        { needles: ["foo"], ignoreCase: false },
        controller.signal,
      ),
    ).rejects.toThrow("stopped");
    await expect(
      readBatch(remote.fs, ["/a"], controller.signal),
    ).rejects.toThrow("stopped");
    expect(remote.batches).toEqual([]);
  });
  it("rejects incomplete bulk results", async () => {
    const { fs } = remoteFs({ "/a": "foo" });
    fs.readMany = async () => [];
    await expect(readBatch(fs, ["/a"])).rejects.toThrow(
      "readMany must return one result per input path",
    );
  });
  it("uses ordinary reads if bulk reads are absent", async () => {
    const { fs } = remoteFs({ "/a": "foo" });
    fs.readMany = undefined;
    const read = fs.readFileBuffer.bind(fs);
    fs.readFileBuffer = (path) => {
      if (path === "/invalid") throw new Error("invalid path");
      return read(path);
    };
    expect(await readBatch(fs, ["/invalid", "/a", "/missing"])).toEqual([
      { status: "rejected", reason: new Error("invalid path") },
      { status: "fulfilled", value: new TextEncoder().encode("foo") },
      { status: "rejected", reason: expect.any(Error) },
    ]);
  });
});
