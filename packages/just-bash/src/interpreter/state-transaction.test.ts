import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("isolated shell-state transaction", () => {
  it("restores every mutable namespace changed by a PATH script", async () => {
    const bash = new Bash({
      env: { PATH: "/bin" },
      files: {
        "/tmp/.keep": "",
        "/bin/mutate": [
          "value=child",
          "items[0]=child",
          "declare -n childref=value",
          "readonly childonly=1",
          "declare -i number=7",
          "declare -l lower=MIXED",
          "declare -u upper=mixed",
          "export childexport=1",
          "complete -W 'child words' tool",
          "childfn() { echo child; }",
          "shopt -s nullglob",
          "cd /tmp",
        ].join("\n"),
      },
    });

    const result = await bash.exec(
      [
        "value=parent",
        "items[0]=parent",
        "complete -W 'parent words' tool",
        "chmod +x /bin/mutate",
        "mutate",
        'printf \'%s|%s|%s|\' "$value" "${items[0]}" "$PWD"',
        "complete -p tool",
        "declare -p childref childonly number lower upper childexport 2>/dev/null || true",
        "type childfn 2>/dev/null || true",
        "shopt -q nullglob; echo $?",
      ].join("; "),
    );

    expect(result.stdout).toBe(
      "parent|parent|/|complete -W 'parent words' tool\n1\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("rolls back state when a PATH script exits early", async () => {
    const bash = new Bash({
      env: { PATH: "/bin" },
      files: {
        "/bin/stop": "value=child; declare -A leaked=([x]=y); exit 17",
      },
    });

    const result = await bash.exec(
      'value=parent; chmod +x /bin/stop; stop; printf \'%s|%s\' "$value" "${leaked[x]}"',
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(17);
    const after = await bash.exec('printf \'%s|%s\' "$value" "${leaked[x]}"');
    expect(after.stdout).toBe("|");
    expect(after.stderr).toBe("");
  });
});
