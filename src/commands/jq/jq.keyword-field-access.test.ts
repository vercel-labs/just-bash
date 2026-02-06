import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq keyword field access", () => {
  describe("field names that are keywords should be accessible with dot notation", () => {
    it("should access .label field", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"label\":\"hello\"}' | jq '.label'",
      );
      expect(result.stdout).toBe('"hello"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should access .and field", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"and\":true}' | jq '.and'",
      );
      expect(result.stdout).toBe("true\n");
      expect(result.exitCode).toBe(0);
    });

    it("should access .or field", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"or\":false}' | jq '.or'",
      );
      expect(result.stdout).toBe("false\n");
      expect(result.exitCode).toBe(0);
    });

    it("should access .not field", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"not\":42}' | jq '.not'",
      );
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });

    it("should access .if field", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"if\":\"value\"}' | jq '.if'",
      );
      expect(result.stdout).toBe('"value"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should access .try field", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"try\":1}' | jq '.try'",
      );
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should access .catch field", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"catch\":2}' | jq '.catch'",
      );
      expect(result.stdout).toBe("2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should access .reduce field", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"reduce\":\"data\"}' | jq '.reduce'",
      );
      expect(result.stdout).toBe('"data"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should access .foreach field", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"foreach\":\"items\"}' | jq '.foreach'",
      );
      expect(result.stdout).toBe('"items"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should access .def field", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"def\":\"definition\"}' | jq '.def'",
      );
      expect(result.stdout).toBe('"definition"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should access .break field", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"break\":\"stop\"}' | jq '.break'",
      );
      expect(result.stdout).toBe('"stop"\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe("chained keyword field access", () => {
    it("should access nested .label field", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"data\":{\"label\":\"nested\"}}' | jq '.data.label'",
      );
      expect(result.stdout).toBe('"nested"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should access .label in compact output", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo '{\"label\":\"x\",\"value\":1}' | jq -c '{lab: .label, val: .value}'",
      );
      expect(result.stdout).toBe('{\"lab\":\"x\",\"val\":1}\n');
      expect(result.exitCode).toBe(0);
    });
  });
});
