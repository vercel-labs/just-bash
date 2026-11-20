import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("array assignment defaults", () => {
  it.each([
    "@",
    "*",
  ])("rejects unset whole-array targets after expanding the default (%s)", async (subscript) => {
    const bash = new Bash();
    const result = await bash.exec(
      `: "\${a[${subscript}]:=$(echo evaluated >&2)}"; echo reached`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `evaluated\nbash: a[${subscript}]: bad array subscript\n`,
    );
    expect(result.exitCode).toBe(1);
  });

  it("selects a default when quoted array-star elements join to empty", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'IFS=; a=("" ""); : "${a[*]:=$(echo evaluated >&2)}"; echo reached',
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("evaluated\nbash: a[*]: bad array subscript\n");
    expect(result.exitCode).toBe(1);
  });
});
