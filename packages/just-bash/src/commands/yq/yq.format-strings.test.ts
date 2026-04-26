/**
 * Tests for yq format string operators (@base64, @uri, @csv, etc.)
 */
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("yq format strings", () => {
  it("@base64 encodes string", async () => {
    const bash = new Bash();
    const result = await bash.exec("echo '\"hello\"' | yq -o json '@base64'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('"aGVsbG8="\n');
  });

  it("@base64d decodes string", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      "echo '\"aGVsbG8=\"' | yq -o json '@base64d'",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('"hello"\n');
  });

  it("@uri encodes string", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      "echo '\"hello world\"' | yq -o json '@uri'",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('"hello%20world"\n');
  });

  it("@csv formats array", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'echo \'["a","b","c"]\' | yq -o json \'@csv\'',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('"a,b,c"\n');
  });

  it("@csv escapes values with commas", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'echo \'["a","b,c","d"]\' | yq -o json \'@csv\'',
    );
    expect(result.exitCode).toBe(0);
    // CSV output: a,"b,c",d  (quoted because b,c contains comma)
    // As JSON string: "a,\"b,c\",d"
    expect(result.stdout).toBe('"a,\\"b,c\\",d"\n');
  });

  it("@tsv formats array", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'echo \'["a","b","c"]\' | yq -o json \'@tsv\'',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('"a\\tb\\tc"\n');
  });

  it("@json converts to JSON string", async () => {
    const bash = new Bash();
    const result = await bash.exec("echo '{\"a\":1}' | yq -o json '@json'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('"{\\"a\\":1}"\n');
  });

  it("@html escapes special characters", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      "echo '\"<script>alert(1)</script>\"' | yq -o json '@html'",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('"&lt;script&gt;alert(1)&lt;/script&gt;"\n');
  });

  it("@sh escapes for shell", async () => {
    const bash = new Bash();
    const result = await bash.exec("echo '\"hello world\"' | yq -o json '@sh'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("\"'hello world'\"\n");
  });

  it("@sh escapes single quotes", async () => {
    const bash = new Bash();
    const result = await bash.exec("echo '\"it'\"'\"'s\"' | yq -o json '@sh'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("\"'it'\\\\''s'\"\n");
  });

  it("@text converts to string", async () => {
    const bash = new Bash();
    const result = await bash.exec("echo '\"test\"' | yq -o json '@text'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('"test"\n');
  });

  // Edge cases
  describe("edge cases", () => {
    it("@base64 with unicode", async () => {
      const bash = new Bash();
      // "héllo" in base64
      const result = await bash.exec("echo '\"héllo\"' | yq -o json '@base64'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"aMOpbGxv"\n');
    });

    it("@base64 on non-string returns null", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo '123' | yq -o json '@base64'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("null\n");
    });

    it("@base64 on array returns null", async () => {
      const bash = new Bash();
      const result = await bash.exec(
        "echo '[\"a\",\"b\"]' | yq -o json '@base64'",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("null\n");
    });

    it("@csv with null values", async () => {
      const bash = new Bash();
      const result = await bash.exec(
        "echo '[\"a\",null,\"c\"]' | yq -o json '@csv'",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"a,,c"\n');
    });

    it("@csv with numbers", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo '[1,2,3]' | yq -o json '@csv'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"1,2,3"\n');
    });

    it("@csv with empty array", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo '[]' | yq -o json '@csv'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('""\n');
    });

    it("@csv with quotes in values", async () => {
      const bash = new Bash();
      // Input: ["a", 'b"c', "d"]
      // CSV should double the quotes: a,"b""c",d
      const result = await bash.exec(
        'echo \'["a","b\\"c","d"]\' | yq -o json \'@csv\'',
      );
      expect(result.exitCode).toBe(0);
      // CSV: a,"b""c",d -> JSON: "a,\"b\"\"c\",d"
      expect(result.stdout).toBe('"a,\\"b\\"\\"c\\",d"\n');
    });

    it("@csv on non-array returns null", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo '\"test\"' | yq -o json '@csv'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("null\n");
    });

    it("@uri encodes all special characters", async () => {
      const bash = new Bash();
      const result = await bash.exec(
        "echo '\"a=1&b=2?c#d\"' | yq -o json '@uri'",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"a%3D1%26b%3D2%3Fc%23d"\n');
    });

    it("@html escapes ampersand", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo '\"a & b\"' | yq -o json '@html'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"a &amp; b"\n');
    });

    it("@html on non-string returns null", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo '123' | yq -o json '@html'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("null\n");
    });

    it("@sh on non-string returns null", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo '123' | yq -o json '@sh'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("null\n");
    });

    it("@text on null returns empty string", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo 'null' | yq -o json '@text'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('""\n');
    });

    it("@text on number converts to string", async () => {
      const bash = new Bash();
      const result = await bash.exec("echo '42' | yq -o json '@text'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"42"\n');
    });
  });
});
