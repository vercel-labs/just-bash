import { describe, expect, it } from "vitest";
import { sanitizeHostErrorMessage } from "./sanitize-error.js";

describe("sanitizeErrorMessage", () => {
  it("scrubs additional host paths and file URLs that previously leaked", () => {
    const input =
      "ENOENT: open '/Users/alice/project.js' then '/workspace/secret/app.js' then '/root/.ssh/id_rsa' via file:///srv/app/main.js\n    at open (node:fs:1:1)";

    expect(sanitizeHostErrorMessage(input)).toBe(
      "ENOENT: open '<path>' then '<path>' then '<path>' via <path>",
    );
  });
});
