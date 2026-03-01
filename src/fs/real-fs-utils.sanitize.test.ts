import { describe, expect, it } from "vitest";
import { sanitizeErrorMessage } from "./real-fs-utils.js";

describe("sanitizeErrorMessage", () => {
  it("should strip /Users/ paths", () => {
    const msg =
      "ENOENT: no such file or directory, open '/Users/john/project/file.txt'";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("ENOENT: no such file or directory, open '<path>'");
    expect(result).not.toContain("/Users/");
  });

  it("should strip /home/ paths", () => {
    const msg = "Error reading /home/deploy/app/config.json";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("Error reading <path>");
    expect(result).not.toContain("/home/");
  });

  it("should strip /private/tmp/ paths", () => {
    const msg = "Cannot access /private/tmp/sandbox-12345/file.txt";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("Cannot access <path>");
    expect(result).not.toContain("/private/");
  });

  it("should strip /var/ paths", () => {
    const msg = "Permission denied: /var/log/app.log";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("Permission denied: <path>");
  });

  it("should strip /opt/ paths", () => {
    const msg = "Not found: /opt/homebrew/bin/node";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("Not found: <path>");
  });

  it("should strip Windows-style paths", () => {
    const msg = "Error at C:\\Users\\admin\\project\\file.js";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("Error at <path>");
    expect(result).not.toContain("C:\\");
  });

  it("should strip stack traces", () => {
    const msg =
      "TypeError: something failed\n    at Object.foo (/Users/x/app.js:10:5)\n    at Module._compile (node:internal/modules/cjs:1234:20)";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("TypeError: something failed");
    expect(result).not.toContain("at Object");
    expect(result).not.toContain("at Module");
  });

  it("should preserve virtual paths", () => {
    const msg = "ENOENT: no such file or directory '/foo/bar/baz.txt'";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("ENOENT: no such file or directory '/foo/bar/baz.txt'");
  });

  it("should preserve error codes", () => {
    const msg = "EACCES: permission denied, open '<path>'";
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain("EACCES");
  });

  it("should handle empty strings", () => {
    expect(sanitizeErrorMessage("")).toBe("");
  });

  it("should handle messages without paths", () => {
    const msg = "Something went wrong";
    expect(sanitizeErrorMessage(msg)).toBe("Something went wrong");
  });

  it("should handle multiple OS paths in one message", () => {
    const msg = "Cannot copy /Users/a/src to /home/b/dst";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("Cannot copy <path> to <path>");
  });

  it("should strip /usr/ paths", () => {
    const msg = "Binary not found: /usr/local/bin/python3";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("Binary not found: <path>");
  });

  it("should strip /nix/ paths", () => {
    const msg = "Error: /nix/store/abc123-node/bin/node failed";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("Error: <path> failed");
  });

  it("should strip /tmp/ paths", () => {
    const msg = "File exists: /tmp/lockfile.pid";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("File exists: <path>");
  });

  it("should strip /Library/ paths", () => {
    const msg = "Cannot read /Library/Preferences/com.apple.foo.plist";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("Cannot read <path>");
  });

  it("should strip /etc/ paths", () => {
    const msg = "ENOENT: /etc/hosts";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("ENOENT: <path>");
  });
});
