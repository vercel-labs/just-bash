import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { parseFileMode } from "./file-mode.js";

describe("shared file mode parser", () => {
  it.each([
    ["700", 0o644, false, 0o700],
    ["0000750", 0, false, 0o750],
    ["u=rw,g=r,o=", 0o777, false, 0o640],
    ["+X", 0o644, false, 0o644],
    ["+X", 0, true, 0o111],
    ["+X", 0o744, false, 0o755],
    ["a-x,a+X", 0o755, false, 0o644],
    ["au+x", 0o644, false, 0o755],
    ["u+t", 0o644, false, 0o644],
    ["o+t", 0o644, false, 0o1644],
  ] as const)("%s with %s (directory=%s)", (mode, current, directory, expected) => {
    expect(parseFileMode(mode, current, directory)).toBe(expected);
  });
  it.each(["888", "10000", "u+q", "755x", "", "u+r,"])("rejects %s", (mode) => {
    expect(() => parseFileMode(mode)).toThrow("Invalid mode");
  });
  it("chmod passes actual directory identity through recursive changes", async () => {
    const bash = new Bash({ files: { "/d/f": "x" } });
    expect(
      (await bash.exec("chmod -R a-x /d; chmod -R a+X /d; stat -c %a /d /d/f"))
        .stdout,
    ).toBe("755\n644\n");
  });
});
