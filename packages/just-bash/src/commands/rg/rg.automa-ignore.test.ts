// Automa modification: N00b selected-tool glob filtering preserves ignore rules.
import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";

const create = (files: Record<string, string>) =>
  new Bash({ files, cwd: "/workspace", defenseInDepth: false });

describe("Automa private recursive ignore filter", () => {
  it("preserves native positive-glob override unless the caller opts in", async () => {
    const bash = create({
      "/workspace/.gitignore": "ignored.ts\n",
      "/workspace/ignored.ts": "needle\n",
      "/workspace/visible.ts": "needle\n",
      "/workspace/upper.TS": "needle\n",
    });
    expect(await bash.exec("rg --files --sort path -g '*.ts'")).toMatchObject({
      stdout: "ignored.ts\nvisible.ts\n",
      stderr: "",
      exitCode: 0,
    });
    expect(
      await bash.exec(
        "rg --files --sort path --automa-respect-ignore -g '*.ts'",
      ),
    ).toMatchObject({ stdout: "visible.ts\n", stderr: "", exitCode: 0 });
    expect(
      await bash.exec("rg -n -H --automa-respect-ignore -g '*.ts' needle ."),
    ).toMatchObject({
      stdout: "./visible.ts:1:needle\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("combines path globs with nested ignore files and their negations", async () => {
    const bash = create({
      "/workspace/src/.gitignore": "*.ts\n!keep.ts\n",
      "/workspace/src/drop.ts": "needle\n",
      "/workspace/src/keep.ts": "needle\n",
      "/workspace/src/deep/drop.ts": "needle\n",
      "/workspace/src/deep/keep.ts": "needle\n",
      "/workspace/other/keep.ts": "needle\n",
    });
    expect(
      await bash.exec(
        "rg --files --sort path --automa-respect-ignore -g 'src/**/*.ts'",
      ),
    ).toMatchObject({
      stdout: "src/deep/keep.ts\nsrc/keep.ts\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("prunes ignored directories despite a matching glob and visits each remaining directory once", async () => {
    const bash = create({
      "/workspace/.gitignore": "blocked/\n",
      "/workspace/blocked/hidden.ts": "needle\n",
      "/workspace/src/visible.ts": "needle\n",
    });
    const readdir = vi.spyOn(bash.fs, "readdirWithFileTypes");
    expect(
      await bash.exec(
        "rg --files --automa-respect-ignore -g blocked -g '*.ts'",
      ),
    ).toMatchObject({ stdout: "src/visible.ts\n", stderr: "", exitCode: 0 });
    expect(readdir.mock.calls.map(([directory]) => directory).sort()).toEqual([
      "/workspace",
      "/workspace/src",
    ]);
  });

  it("keeps glob order, hidden-file overrides and type overrides intact", async () => {
    const bash = create({
      "/workspace/.gitignore": "ignored.ts\n",
      "/workspace/ignored.ts": "needle\n",
      "/workspace/.hidden.ts": "needle\n",
      "/workspace/a.ts": "needle\n",
      "/workspace/b.ts": "needle\n",
    });
    expect(
      await bash.exec("rg --files --sort path --automa-respect-ignore"),
    ).toMatchObject({ stdout: "a.ts\nb.ts\n", stderr: "", exitCode: 0 });
    for (const [flags, stdout] of [
      ["-g '*.ts' -g '!b.ts' -g b.ts", ".hidden.ts\na.ts\nb.ts\n"],
      ["-g '*.ts' -g b.ts -g '!b.ts'", ".hidden.ts\na.ts\n"],
      ["-g '*.ts' -t js", ".hidden.ts\na.ts\nb.ts\n"],
    ]) {
      expect(
        await bash.exec(
          `rg --files --sort path --automa-respect-ignore ${flags}`,
        ),
      ).toMatchObject({ stdout, stderr: "", exitCode: 0 });
    }
  });

  it("applies existing dot-ignore rules without changing explicit-file selection", async () => {
    const bash = create({
      "/workspace/.ignore": "ignored.ts\n",
      "/workspace/.rgignore": "other.ts\n",
      "/workspace/ignored.ts": "needle\n",
      "/workspace/other.ts": "needle\n",
      "/workspace/visible.ts": "needle\n",
    });
    expect(
      await bash.exec("rg --files --automa-respect-ignore -g '*.ts'"),
    ).toMatchObject({ stdout: "visible.ts\n", stderr: "", exitCode: 0 });
    expect(
      await bash.exec(
        "rg --files --automa-respect-ignore -g '*.ts' ignored.ts",
      ),
    ).toMatchObject({ stdout: "ignored.ts\n", stderr: "", exitCode: 0 });
  });

  it("retains existing glob validation errors", async () => {
    const bash = create({ "/workspace/visible.ts": "needle\n" });
    expect(
      await bash.exec("rg --files --automa-respect-ignore -g '['"),
    ).toMatchObject({
      stdout: "",
      stderr: "rg: glob '[' has an unclosed character class\n",
      exitCode: 2,
    });
  });
});
