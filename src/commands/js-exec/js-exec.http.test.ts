import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec http operations", () => {
  it("should error when network is not configured", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "try { fetch('http://example.com'); } catch(e) { console.log('error: ' + e.message); }"`,
    );
    expect(result.stdout).toContain("error:");
    expect(result.stdout).toContain("Network access not configured");
    expect(result.exitCode).toBe(0);
  });
});
