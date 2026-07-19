import { describe, expect, it } from "vitest";
import { parseOptions } from "./tar-options.js";

describe("tar old-style option parsing", () => {
  it("consumes value-taking options in their original bundle order", () => {
    const parsed = parseOptions(["cCf", "source-dir", "archive.tar", "file"]);
    expect(parsed).toEqual({
      ok: true,
      options: expect.objectContaining({
        create: true,
        directory: "source-dir",
        file: "archive.tar",
      }),
      files: ["file"],
    });
  });

  it("consumes a distinct argv value for every value-taking letter", () => {
    const parsed = parseOptions([
      "cCTXf",
      "source-dir",
      "files.list",
      "exclude.list",
      "archive.tar",
      "payload",
    ]);
    expect(parsed).toEqual({
      ok: true,
      options: expect.objectContaining({
        create: true,
        directory: "source-dir",
        filesFrom: "files.list",
        excludeFrom: "exclude.list",
        file: "archive.tar",
      }),
      files: ["payload"],
    });
  });

  it("rejects a missing later option value instead of shifting operands", () => {
    const parsed = parseOptions(["cCf", "source-dir"]);
    expect(parsed).toMatchObject({
      ok: false,
      error: {
        stderr: "tar: option requires an argument -- 'f'\n",
        exitCode: 2,
      },
    });
  });
});
