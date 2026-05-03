/**
 * Invocation-shape tests for sqlite3.
 *
 * Each test mirrors a shape catalogued from a Braintrust review of ~924
 * reasoning-agent spans across the four flowglad-pay-agent* projects.
 * The S-numbers (S1..S11) match docs/sqlite3-invocation-shapes.md.
 *
 * If a test here fails, an agent in production has hit (or will hit) the
 * same failure. Either patch the wrapper or open a triage issue.
 */
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3 invocation shapes", () => {
  describe("S1: version smoke test", () => {
    it("sqlite3 :memory: with SELECT sqlite_version()", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "SELECT sqlite_version();"',
      );
      expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("-version flag", async () => {
      const env = new Bash();
      const result = await env.exec("sqlite3 -version");
      expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("S3: one-liner sqlite3 <db> '<SQL>'", () => {
    it("simple SELECT against :memory:", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "CREATE TABLE t(x INT); INSERT INTO t VALUES(1),(2),(3); SELECT COUNT(*) FROM t;"',
      );
      expect(result.stdout).toBe("3\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("introspection via sqlite_master", async () => {
      const env = new Bash();
      const setup = await env.exec(
        'sqlite3 /db.sqlite "CREATE TABLE orders(id INT); CREATE TABLE refunds(id INT)"',
      );
      expect(setup.exitCode).toBe(0);
      const result = await env.exec(
        "sqlite3 /db.sqlite \"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;\"",
      );
      expect(result.stdout).toBe("orders\nrefunds\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("S4: multi-statement single positional arg", () => {
    it("CREATE + INSERT + SELECT in one quoted arg", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 /db.sqlite \"CREATE TABLE t(x TEXT); INSERT INTO t VALUES('hello'); SELECT * FROM t;\"",
      );
      expect(result.stdout).toBe("hello\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("S5: script redirect sqlite3 <db> < script.sql", () => {
    it("schema + INSERTs piped from a workspace .sql file", async () => {
      const env = new Bash();
      const write = await env.exec(
        'printf \'CREATE TABLE vendor_spend (vendor TEXT, amount_cents INTEGER);\\nINSERT INTO vendor_spend VALUES ("acme", 1000);\\nINSERT INTO vendor_spend VALUES ("globex", 2500);\\n\' > /workspace/load.sql',
      );
      expect(write.exitCode).toBe(0);

      const load = await env.exec(
        "sqlite3 /out/report.db < /workspace/load.sql",
      );
      expect(load.stdout).toBe("");
      expect(load.stderr).toBe("");
      expect(load.exitCode).toBe(0);

      const verify = await env.exec(
        'sqlite3 /out/report.db "SELECT vendor, amount_cents FROM vendor_spend ORDER BY vendor"',
      );
      expect(verify.stdout).toBe("acme|1000\nglobex|2500\n");
      expect(verify.stderr).toBe("");
      expect(verify.exitCode).toBe(0);
    });
  });

  describe("S6: stdin pipe echo '<SQL>' | sqlite3 <db>", () => {
    it("echoed CREATE through pipe persists to db", async () => {
      const env = new Bash();
      const create = await env.exec(
        'echo "CREATE TABLE vendor_spend (vendor TEXT, amount_cents INTEGER, date TEXT, category TEXT);" | sqlite3 /report.db',
      );
      expect(create.exitCode).toBe(0);

      const verify = await env.exec(
        "sqlite3 /report.db \"SELECT name FROM sqlite_master WHERE type='table'\"",
      );
      expect(verify.stdout).toBe("vendor_spend\n");
      expect(verify.exitCode).toBe(0);
    });

    it("smoke test: SELECT 1; via pipe", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "SELECT 1;" | sqlite3 :memory: && echo "sqlite3 works"',
      );
      expect(result.stdout).toBe("1\nsqlite3 works\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe('S7: command substitution sqlite3 <db> "$(cat file.sql)"', () => {
    it("reads SQL via $(cat ...) and runs it", async () => {
      const env = new Bash();
      const write = await env.exec(
        "printf 'CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (7); SELECT x FROM t;' > /workspace/load_all_v2.sql",
      );
      expect(write.exitCode).toBe(0);

      const result = await env.exec(
        'sqlite3 /out/report.db "$(cat /workspace/load_all_v2.sql)" && echo "SUCCESS"',
      );
      expect(result.stdout).toBe("7\nSUCCESS\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("S8: TSV with headers via -header -separator $'\\t'", () => {
    // Note: just-bash mirrors real sqlite3's full IEEE-754 float precision
    // (see sqlite3.fixtures.test.ts, products.db where 999.99 -> 999.99000000000001).
    // ROUND(...,2) does not produce clean two-decimal output here.
    it("dumps header row + tab-separated data, integer aggregates clean", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite \"CREATE TABLE refunds(note TEXT, amount_cents INT); INSERT INTO refunds VALUES('damaged', 1250), ('damaged', 725), ('lost', 9999)\"",
      );

      const result = await env.exec(
        "sqlite3 -header -separator $'\\t' /db.sqlite \"SELECT note, COUNT(*) AS count, SUM(amount_cents) AS total_cents FROM refunds GROUP BY note ORDER BY count DESC;\"",
      );
      expect(result.stdout).toBe(
        "note\tcount\ttotal_cents\ndamaged\t2\t1975\nlost\t1\t9999\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("S9: TSV without headers via -separator $'\\t'", () => {
    it("dumps tab-separated data, no header", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite \"CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES (1, 'one'), (2, 'two')\"",
      );

      const result = await env.exec(
        "sqlite3 -separator $'\\t' /db.sqlite \"SELECT a, b FROM t ORDER BY a\"",
      );
      expect(result.stdout).toBe("1\tone\n2\ttwo\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("S10: redirect output to .tsv file", () => {
    it("writes query result to /workspace/flavor_picks.tsv", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite \"CREATE TABLE picks(flavor TEXT, picks INT); INSERT INTO picks VALUES ('mint', 12), ('vanilla', 8)\"",
      );

      const dump = await env.exec(
        "sqlite3 -header -separator $'\\t' /db.sqlite \"SELECT flavor, picks FROM picks ORDER BY picks DESC\" > /workspace/flavor_picks.tsv",
      );
      expect(dump.stdout).toBe("");
      expect(dump.stderr).toBe("");
      expect(dump.exitCode).toBe(0);

      const cat = await env.exec("cat /workspace/flavor_picks.tsv");
      expect(cat.stdout).toBe("flavor\tpicks\nmint\t12\nvanilla\t8\n");
      expect(cat.exitCode).toBe(0);
    });
  });

  describe("S11: per-statement loop (sequential invocations)", () => {
    it("multiple sqlite3 calls accumulate against the same db", async () => {
      const env = new Bash();
      const stmts = [
        "CREATE TABLE t(x INT)",
        "INSERT INTO t VALUES (1)",
        "INSERT INTO t VALUES (2)",
        "INSERT INTO t VALUES (3)",
      ];
      for (const stmt of stmts) {
        const r = await env.exec(`sqlite3 /loop.db "${stmt}"`);
        expect(r.stderr).toBe("");
        expect(r.exitCode).toBe(0);
      }
      const result = await env.exec('sqlite3 /loop.db "SELECT SUM(x) FROM t"');
      expect(result.stdout).toBe("6\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("relative-path database (out/report.db)", () => {
    it("works with a relative db path from cwd", async () => {
      const env = new Bash({ cwd: "/work" });
      await env.exec("mkdir -p /work/out");
      const create = await env.exec(
        'sqlite3 out/report.db "CREATE TABLE t(x); INSERT INTO t VALUES(11); SELECT * FROM t"',
      );
      expect(create.stdout).toBe("11\n");
      expect(create.exitCode).toBe(0);
    });
  });
});
