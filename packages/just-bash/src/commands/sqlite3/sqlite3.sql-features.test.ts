/**
 * SQL feature tests for sqlite3 — pin the language features actual agents
 * use against this wrapper. F-numbers map to docs/sqlite3-invocation-shapes.md.
 *
 * If a future sql.js bump silently drops one of these, agents in production
 * will start producing wrong output. These tests catch that.
 */
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3 SQL features", () => {
  describe("F1: CREATE TABLE … AS SELECT (materialized reports)", () => {
    it("materializes monthly revenue rollup", async () => {
      const env = new Bash();
      await env.exec(
        `sqlite3 /db.sqlite "CREATE TABLE orders(id INT, created_at TEXT, financial_status TEXT, total_cents INT);
         INSERT INTO orders VALUES
           (1,'2026-01-15','paid',1000),
           (2,'2026-01-20','paid',2000),
           (3,'2026-02-05','paid',1500),
           (4,'2026-02-10','refunded',500);"`,
      );

      const create = await env.exec(
        "sqlite3 /db.sqlite \"CREATE TABLE monthly_revenue AS SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS orders, SUM(total_cents) AS revenue_cents FROM orders WHERE financial_status='paid' GROUP BY month ORDER BY month;\"",
      );
      expect(create.exitCode).toBe(0);

      const verify = await env.exec(
        'sqlite3 /db.sqlite "SELECT month, orders, revenue_cents FROM monthly_revenue ORDER BY month"',
      );
      expect(verify.stdout).toBe("2026-01|2|3000\n2026-02|1|1500\n");
      expect(verify.exitCode).toBe(0);
    });
  });

  describe("F2: bulk INSERT in a script-redirected .sql file", () => {
    it("loads a multi-row INSERT block via < script.sql (heredoc)", async () => {
      const env = new Bash();
      const write = await env.exec(
        `cat > /workspace/load_customers.sql <<'EOF'
CREATE TABLE customers(id INT, email TEXT);
INSERT INTO customers VALUES (1, 'a@x.com');
INSERT INTO customers VALUES (2, 'b@x.com');
INSERT INTO customers VALUES (3, 'c@x.com');
EOF`,
      );
      expect(write.exitCode).toBe(0);

      const load = await env.exec(
        "sqlite3 /db.sqlite < /workspace/load_customers.sql",
      );
      expect(load.stderr).toBe("");
      expect(load.exitCode).toBe(0);

      const verify = await env.exec(
        'sqlite3 /db.sqlite "SELECT COUNT(*) FROM customers"',
      );
      expect(verify.stdout).toBe("3\n");
      expect(verify.exitCode).toBe(0);
    });
  });

  describe("F3: window functions", () => {
    it("SUM(...) OVER (PARTITION BY ...)", async () => {
      const env = new Bash();
      await env.exec(
        `sqlite3 /db.sqlite "CREATE TABLE sales(region TEXT, amount INT); INSERT INTO sales VALUES ('NA',100),('NA',200),('EU',300),('EU',400);"`,
      );

      const result = await env.exec(
        'sqlite3 -header /db.sqlite "SELECT region, amount, SUM(amount) OVER (PARTITION BY region) AS region_total FROM sales ORDER BY region, amount"',
      );
      expect(result.stdout).toBe(
        "region|amount|region_total\nEU|300|700\nEU|400|700\nNA|100|300\nNA|200|300\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("ROW_NUMBER() OVER (ORDER BY ...)", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite \"CREATE TABLE t(name TEXT); INSERT INTO t VALUES ('c'),('a'),('b');\"",
      );

      const result = await env.exec(
        'sqlite3 /db.sqlite "SELECT ROW_NUMBER() OVER (ORDER BY name) AS rn, name FROM t"',
      );
      expect(result.stdout).toBe("1|a\n2|b\n3|c\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("F4: common table expressions (CTE)", () => {
    it("simple WITH ... SELECT", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite \"CREATE TABLE picks(flavor TEXT); INSERT INTO picks VALUES ('mint'),('mint'),('vanilla');\"",
      );

      const result = await env.exec(
        'sqlite3 /db.sqlite "WITH flavor_demand AS (SELECT flavor, COUNT(*) AS n FROM picks GROUP BY flavor) SELECT flavor, n FROM flavor_demand ORDER BY n DESC, flavor"',
      );
      expect(result.stdout).toBe("mint|2\nvanilla|1\n");
      expect(result.exitCode).toBe(0);
    });

    it("recursive WITH RECURSIVE for fibonacci", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "WITH RECURSIVE fib(n, a, b) AS (SELECT 1, 0, 1 UNION ALL SELECT n+1, b, a+b FROM fib WHERE n < 8) SELECT a FROM fib"',
      );
      expect(result.stdout).toBe("0\n1\n1\n2\n3\n5\n8\n13\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("F5: strftime() date arithmetic", () => {
    it("%Y-%m grouping", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"SELECT strftime('%Y-%m', '2026-04-30 12:00:00')\"",
      );
      expect(result.stdout).toBe("2026-04\n");
      expect(result.exitCode).toBe(0);
    });

    it("%Y-W%W weekly grouping", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"SELECT strftime('%Y-W%W', '2026-04-30')\"",
      );
      expect(result.stdout).toBe("2026-W17\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("F6: sqlite_master introspection", () => {
    it("lists tables ordered by name", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite 'CREATE TABLE z(x); CREATE TABLE a(x); CREATE TABLE m(x);'",
      );
      const result = await env.exec(
        "sqlite3 /db.sqlite \"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\"",
      );
      expect(result.stdout).toBe("a\nm\nz\n");
      expect(result.exitCode).toBe(0);
    });

    it("returns CREATE TABLE DDL via sqlite_master.sql", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite 'CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT NOT NULL);'",
      );
      const result = await env.exec(
        "sqlite3 /db.sqlite \"SELECT sql FROM sqlite_master WHERE type='table' AND name='users'\"",
      );
      expect(result.stdout).toBe(
        "CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT NOT NULL)\n",
      );
      expect(result.exitCode).toBe(0);
    });
  });

  describe("F7: aggregations and scalar subqueries", () => {
    it("CASE WHEN aggregate", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite \"CREATE TABLE orders(status TEXT, amount INT); INSERT INTO orders VALUES ('paid', 100), ('refunded', 50), ('paid', 200);\"",
      );
      const result = await env.exec(
        "sqlite3 -header /db.sqlite \"SELECT SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) AS revenue, SUM(CASE WHEN status='refunded' THEN amount ELSE 0 END) AS refunds FROM orders\"",
      );
      expect(result.stdout).toBe("revenue|refunds\n300|50\n");
      expect(result.exitCode).toBe(0);
    });

    it("scalar subquery for percent-of-total", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite \"CREATE TABLE picks(flavor TEXT); INSERT INTO picks VALUES ('mint'),('mint'),('mint'),('vanilla');\"",
      );
      const result = await env.exec(
        'sqlite3 /db.sqlite "SELECT flavor, COUNT(*) * 100 / (SELECT COUNT(*) FROM picks) AS pct FROM picks GROUP BY flavor ORDER BY pct DESC"',
      );
      expect(result.stdout).toBe("mint|75\nvanilla|25\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("X4: PRAGMA statements", () => {
    it("PRAGMA table_info(t)", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite 'CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT);'",
      );
      const result = await env.exec(
        'sqlite3 /db.sqlite "PRAGMA table_info(t)"',
      );
      expect(result.stdout).toBe("0|id|INTEGER|0||1\n1|name|TEXT|0||0\n");
      expect(result.exitCode).toBe(0);
    });

    it("PRAGMA foreign_keys=ON; SELECT", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "PRAGMA foreign_keys=ON; PRAGMA foreign_keys"',
      );
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("indices, views, triggers", () => {
    it("CREATE INDEX is queryable via sqlite_master", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite 'CREATE TABLE t(x INT); CREATE INDEX idx_t_x ON t(x);'",
      );
      const result = await env.exec(
        "sqlite3 /db.sqlite \"SELECT name, type FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'\"",
      );
      expect(result.stdout).toBe("idx_t_x|index\n");
      expect(result.exitCode).toBe(0);
    });

    it("CREATE VIEW + SELECT through it", async () => {
      const env = new Bash();
      await env.exec(
        'sqlite3 /db.sqlite "CREATE TABLE t(x INT); INSERT INTO t VALUES (1),(2),(3); CREATE VIEW v AS SELECT x*x AS sq FROM t"',
      );
      const result = await env.exec(
        'sqlite3 /db.sqlite "SELECT sq FROM v ORDER BY sq"',
      );
      expect(result.stdout).toBe("1\n4\n9\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("transactions", () => {
    it("BEGIN; INSERT; COMMIT; round-trips", async () => {
      const env = new Bash();
      await env.exec("sqlite3 /db.sqlite 'CREATE TABLE t(x INT)'");
      const txn = await env.exec(
        "sqlite3 /db.sqlite 'BEGIN; INSERT INTO t VALUES (1); INSERT INTO t VALUES (2); COMMIT;'",
      );
      expect(txn.exitCode).toBe(0);
      const result = await env.exec(
        'sqlite3 /db.sqlite "SELECT SUM(x) FROM t"',
      );
      expect(result.stdout).toBe("3\n");
      expect(result.exitCode).toBe(0);
    });
  });
});
