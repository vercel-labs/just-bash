import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

describe("rg Grep tool argument and error boundaries", () => {
  for (const color of ["never", "auto", "always", "ansi"]) {
    for (const flag of [`--color ${color}`, `--color=${color}`]) {
      it(`accepts ${flag} with plain text output`, async () => {
        const bash = new Bash({ files: { "/a.ts": "Permission\n" } });
        const result = await bash.exec(
          `rg -n --heading ${flag} -- Permission /a.ts`,
        );
        expect(result.stdout).toBe("1:Permission\n");
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
      });
    }
  }

  const errors = [
    ["--color purple", "rg: invalid --color value: purple\n"],
    ["--color=", "rg: invalid --color value: \n"],
    ["--max-count -1", "rg: invalid --max-count value: -1\n"],
    ["--max-count 1.5", "rg: invalid --max-count value: 1.5\n"],
    ["--max-count 2junk", "rg: invalid --max-count value: 2junk\n"],
    ["-C -1", "rg: invalid -C value: -1\n"],
    ["-C 1.5", "rg: invalid -C value: 1.5\n"],
    ["-C junk", "rg: invalid -C value: junk\n"],
    ["--type nonexistent", "rg: unrecognized file type: nonexistent\n"],
    ["--glob '['", "rg: glob '[' has an unclosed character class\n"],
  ];
  for (const [flags, stderr] of errors) {
    it(`reports ${flags} as an error, not no matches`, async () => {
      const bash = new Bash({ files: { "/a.ts": "Permission\n" } });
      const result = await bash.exec(
        `rg --color never ${flags} -- Permission /a.ts`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(stderr);
      expect(result.exitCode).toBe(2);
    });
  }

  for (const flag of ["--color", "--max-count", "--glob", "--type", "-C"]) {
    it(`rejects a missing value for ${flag}`, async () => {
      const bash = new Bash();
      const result = await bash.exec(`rg ${flag}`);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        flag.startsWith("--")
          ? `rg: unrecognized option '${flag}'\n`
          : "rg: invalid option -- 'C'\n",
      );
      expect(result.exitCode).toBe(2);
    });
  }

  it("keeps a --help option value as a literal pattern", async () => {
    const bash = new Bash({ files: { "/a.ts": "--help\n" } });
    const result = await bash.exec("rg -n -e --help /a.ts");
    expect(result.stdout).toBe("1:--help\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("resolves a custom type before validating it", async () => {
    const bash = new Bash({ files: { "/a.custom": "Permission\n" } });
    const result = await bash.exec(
      "rg -n --type custom --type-add 'custom:*.custom' -- Permission /a.custom",
    );
    expect(result.stdout).toBe("1:Permission\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("returns exit 2 for a missing path", async () => {
    const bash = new Bash();
    const result = await bash.exec("rg --color never -- Permission /missing");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rg: /missing: Unable to access path\n");
    expect(result.exitCode).toBe(2);
  });

  it("preserves matches when another path fails", async () => {
    const bash = new Bash({ files: { "/a.ts": "Permission\n" } });
    const result = await bash.exec(
      "rg -n --heading --color never -- Permission /a.ts /missing",
    );
    expect(result.stdout).toBe("/a.ts\n1:Permission\n");
    expect(result.stderr).toBe("rg: /missing: Unable to access path\n");
    expect(result.exitCode).toBe(2);
  });

  it("reports file read failures rather than silently skipping them", async () => {
    const fs = new InMemoryFs({ "/a.ts": "Permission\n" });
    vi.spyOn(fs, "readFileBuffer").mockRejectedValue(new Error("EACCES"));
    const bash = new Bash({ fs });
    const result = await bash.exec("rg -n --color never -- Permission /a.ts");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rg: /a.ts: Unable to read file\n");
    expect(result.exitCode).toBe(2);
  });

  it("reports directory read failures rather than no matches", async () => {
    const fs = new InMemoryFs({ "/dir/a.ts": "Permission\n" });
    vi.spyOn(fs, "readdirWithFileTypes").mockRejectedValue(new Error("EACCES"));
    const bash = new Bash({ fs });
    const result = await bash.exec("rg -n --color never -- Permission /dir");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rg: /dir: Unable to read directory\n");
    expect(result.exitCode).toBe(2);
  });

  it("keeps quiet-mode success when a match accompanies an error", async () => {
    const bash = new Bash({ files: { "/a.ts": "Permission\n" } });
    const result = await bash.exec(
      "rg -q --color never -- Permission /a.ts /missing",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rg: /missing: Unable to access path\n");
    expect(result.exitCode).toBe(0);
  });

  it("reports an invalid regex with the caller's full flags", async () => {
    const bash = new Bash({ files: { "/a.ts": "Permission\n" } });
    const result = await bash.exec(
      "rg -n --heading --color never -- '[' /a.ts",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rg: invalid regex: [\n");
    expect(result.exitCode).toBe(2);
  });

  it("preserves the documented smart-case default and explicit case controls", async () => {
    const bash = new Bash({ files: { "/a.ts": "Permission\n" } });
    const smart = await bash.exec("rg -n --color never -- permission /a.ts");
    expect(smart.stdout).toBe("1:Permission\n");
    expect(smart.stderr).toBe("");
    expect(smart.exitCode).toBe(0);
    const sensitive = await bash.exec(
      "rg -n -s --color never -- permission /a.ts",
    );
    expect(sensitive.stdout).toBe("");
    expect(sensitive.stderr).toBe("");
    expect(sensitive.exitCode).toBe(1);
  });
});
