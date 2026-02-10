/**
 * Tests for psql command
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import type { SecurePostgresConnect } from "../../network/index.js";

// Mock postgres connection
function createMockPostgresConnect(
  mockResults?: Record<
    string,
    Array<Record<string, unknown>> | { error: string }
  >,
): SecurePostgresConnect {
  return async (_options) => {
    const results = mockResults || {};

    return {
      // biome-ignore lint/suspicious/noExplicitAny: Mock function
      unsafe: async (sql: string): Promise<any> => {
        const trimmedSql = sql.trim();
        if (results[trimmedSql]) {
          const result = results[trimmedSql];
          if ("error" in result) {
            throw new Error(result.error);
          }
          return result;
        }
        // Default: return empty array
        return [];
      },
      end: async () => {
        // No-op for mock
      },
    } as never;
  };
}

describe("psql command", () => {
  it("should show help with --help", async () => {
    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    const result = await bash.exec("psql --help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("psql");
    expect(result.stdout).toContain("PostgreSQL interactive terminal");
    expect(result.stdout).toContain("-h, --host");
  });

  it("should not be available when PostgreSQL access not configured", async () => {
    const bash = new Bash();

    const result = await bash.exec('psql -h localhost -c "SELECT 1"');
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("command not found");
  });

  it("should error when host is not specified", async () => {
    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    const result = await bash.exec('psql -c "SELECT 1"');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no host specified");
  });

  it("should error when no SQL is provided", async () => {
    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    const result = await bash.exec("psql -h localhost");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no SQL provided");
  });

  it("should execute a simple query with aligned output", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 1 as num": [{ num: 1 }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec('psql -h localhost -c "SELECT 1 as num"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("num");
    expect(result.stdout).toContain("1");
    expect(result.stdout).toContain("(1 row)");
  });

  it("should execute query with unaligned output", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 1 as a, 2 as b": [{ a: 1, b: 2 }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      'psql -h localhost -A -c "SELECT 1 as a, 2 as b"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("a|b");
    expect(result.stdout).toContain("1|2");
  });

  it("should execute query with CSV output", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 'hello' as msg, 123 as num": [{ msg: "hello", num: 123 }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      "psql -h localhost --csv -c \"SELECT 'hello' as msg, 123 as num\"",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("msg,num");
    expect(result.stdout).toContain("hello,123");
  });

  it("should execute query with JSON output", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 1 as id, 'test' as name": [{ id: 1, name: "test" }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      "psql -h localhost --json -c \"SELECT 1 as id, 'test' as name\"",
    );
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json).toEqual([{ id: 1, name: "test" }]);
  });

  it("should execute query with HTML output", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 1 as num": [{ num: 1 }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec('psql -h localhost -H -c "SELECT 1 as num"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("<table>");
    expect(result.stdout).toContain("<th>num</th>");
    expect(result.stdout).toContain("<td>1</td>");
  });

  it("should support tuples-only mode", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 1 as num": [{ num: 1 }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec('psql -h localhost -t -c "SELECT 1 as num"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("num");
    expect(result.stdout).not.toContain("row");
    expect(result.stdout).toContain("1");
  });

  it("should support quiet mode", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 1 as num": [{ num: 1 }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec('psql -h localhost -q -c "SELECT 1 as num"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("row");
  });

  it("should execute multiple statements", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 1 as a": [{ a: 1 }],
      "SELECT 2 as b": [{ b: 2 }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      'psql -h localhost -c "SELECT 1 as a; SELECT 2 as b"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("a");
    expect(result.stdout).toContain("b");
  });

  it("should handle query errors", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT * FROM nonexistent": { error: "relation does not exist" },
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      'psql -h localhost -c "SELECT * FROM nonexistent"',
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("relation does not exist");
  });

  it("should support custom field separator", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 1 as a, 2 as b": [{ a: 1, b: 2 }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      'psql -h localhost -A -F "," -c "SELECT 1 as a, 2 as b"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("a,b");
    expect(result.stdout).toContain("1,2");
  });

  it("should handle NULL values", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT NULL as val": [{ val: null }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec('psql -h localhost -c "SELECT NULL as val"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("val");
  });

  it("should handle INSERT/UPDATE/DELETE without RETURNING", async () => {
    const mockConnect = createMockPostgresConnect({
      "INSERT INTO t VALUES (1)": [],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      'psql -h localhost -c "INSERT INTO t VALUES (1)"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Command completed successfully");
  });

  it("should support reading SQL from stdin", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 42 as answer": [{ answer: 42 }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      'echo "SELECT 42 as answer" | psql -h localhost',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("42");
  });

  it("should handle connection failure", async () => {
    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = async () => {
      throw new Error("Connection refused");
    };

    const result = await bash.exec('psql -h localhost -c "SELECT 1"');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Connection refused");
  });

  it("should support port parameter", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 1 as num": [{ num: 1 }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      'psql -h localhost -p 5433 -c "SELECT 1 as num"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1");
  });

  it("should support database parameter", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 1 as num": [{ num: 1 }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      'psql -h localhost -d testdb -c "SELECT 1 as num"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1");
  });

  it("should support username parameter", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 1 as num": [{ num: 1 }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      'psql -h localhost -U testuser -c "SELECT 1 as num"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1");
  });

  it("should handle CSV with special characters", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 'a,b' as val1, 'c\"d' as val2": [{ val1: "a,b", val2: 'c"d' }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      "psql -h localhost --csv -c \"SELECT 'a,b' as val1, 'c\\\"d' as val2\"",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"a,b"');
    expect(result.stdout).toContain('"c""d"');
  });

  it("should handle HTML with special characters", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT '<script>' as val": [{ val: "<script>" }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec(
      "psql -h localhost -H -c \"SELECT '<script>' as val\"",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("&lt;script&gt;");
  });

  it("should execute SQL from file with -f flag", async () => {
    const mockConnect = createMockPostgresConnect({
      "SELECT 'from file' as source": [{ source: "from file" }],
    });

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    // Create a SQL file
    await bash.writeFile("/tmp/test.sql", "SELECT 'from file' as source");

    const result = await bash.exec("psql -h localhost -f /tmp/test.sql");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("from file");
  });

  it("should error when file does not exist", async () => {
    const mockConnect = createMockPostgresConnect({});

    const bash = new Bash({
      network: {
        allowedPostgresHosts: ["localhost"],
      },
    });

    // @ts-expect-error - Accessing private field for testing
    bash.securePostgresConnect = mockConnect;

    const result = await bash.exec("psql -h localhost -f /tmp/nonexistent.sql");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("nonexistent.sql");
  });
});
