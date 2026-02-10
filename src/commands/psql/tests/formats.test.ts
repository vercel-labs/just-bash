/**
 * Tests for psql output formats
 *
 * Tests require PostgreSQL running on localhost:5432
 */

import { beforeAll, describe, expect, it } from "vitest";
import { Bash } from "../../../Bash.js";
import {
  getTestNetworkConfigWithCreds,
  isPostgresAvailable,
} from "./test-helpers.js";

describe("psql output formats", () => {
  let pgAvailable = false;

  beforeAll(async () => {
    pgAvailable = await isPostgresAvailable();
    if (!pgAvailable) {
      console.warn(
        "\n⚠️  PostgreSQL not available - skipping psql format tests\n",
      );
    }
  });

  describe("aligned format (default)", () => {
    it("should output aligned table", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        "psql -h localhost -c \"SELECT 1 as num, 'hello' as text\"",
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("num");
      expect(result.stdout).toContain("text");
      expect(result.stdout).toContain("---"); // Separator line
      expect(result.stdout).toContain("(1 row)");
    });

    it("should align columns properly", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -c "SELECT 1 as a, 2 as b"',
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(" | "); // Column separator
    });
  });

  describe("unaligned format (-A)", () => {
    it("should output unaligned with pipe separator", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -A -c "SELECT 1 as a, 2 as b"',
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("a|b");
      expect(result.stdout).toContain("1|2");
    });

    it("should support custom field separator (-F)", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -A -F "," -c "SELECT 1 as a, 2 as b"',
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("a,b");
      expect(result.stdout).toContain("1,2");
    });
  });

  describe("CSV format (--csv)", () => {
    it("should output valid CSV", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        "psql -h localhost --csv -c \"SELECT 1 as num, 'hello' as text\"",
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("num,text");
      expect(result.stdout).toContain("1,hello");
    });

    it("should escape CSV special characters", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        "psql -h localhost --csv -c \"SELECT 'a,b' as val1, 'c\\\"d' as val2\"",
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('"a,b"'); // Quoted because of comma
      expect(result.stdout).toContain('"c""d"'); // Double quote escaped as two double quotes
    });
  });

  describe("JSON format (--json)", () => {
    it("should output valid JSON array", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        "psql -h localhost --json -c \"SELECT 1 as id, 'test' as name\"",
      );

      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json).toEqual([{ id: 1, name: "test" }]);
    });

    it("should handle multiple rows in JSON", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost --json -c "SELECT n FROM generate_series(1,3) as n"',
      );

      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    });
  });

  describe("HTML format (-H)", () => {
    it("should output HTML table", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -H -c "SELECT 1 as num"',
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("<table>");
      expect(result.stdout).toContain("<th>num</th>");
      expect(result.stdout).toContain("<td>1</td>");
      expect(result.stdout).toContain("</table>");
    });

    it("should escape HTML entities", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        "psql -h localhost -H -c \"SELECT '<script>' as val\"",
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("&lt;script&gt;");
    });
  });

  describe("tuples-only mode (-t)", () => {
    it("should suppress headers and footer", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -t -c "SELECT 1 as num"',
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("num"); // No header
      expect(result.stdout).not.toContain("row"); // No footer
      expect(result.stdout).toContain("1");
    });
  });

  describe("quiet mode (-q)", () => {
    it("should suppress row count", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -q -c "SELECT 1 as num"',
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("row");
    });
  });

  describe("NULL values", () => {
    it("should handle NULL in aligned format", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -c "SELECT NULL as val"',
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("val");
    });

    it("should handle NULL in JSON format", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost --json -c "SELECT NULL as val"',
      );

      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json).toEqual([{ val: null }]);
    });
  });
});
