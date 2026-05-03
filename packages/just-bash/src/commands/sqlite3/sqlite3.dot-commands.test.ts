/**
 * Dot-command tests for sqlite3.
 *
 * Real sqlite3 supports CLI dot-commands (`.tables`, `.schema`, `.mode csv`,
 * `.read script.sql`, ...). The Braintrust trace catalogue showed agents
 * never used them — but as we add them as a parity feature, we pin behavior
 * here. D-numbers map to docs/sqlite3-invocation-shapes.md.
 *
 * Limitations encoded in the tests below:
 *   - Formatter mutations (`.mode`, `.headers`, `.separator`) are global
 *     within a single sqlite3 invocation. Last write wins. Real sqlite3
 *     applies them incrementally.
 *   - `.tables` output is one-name-per-line, not real sqlite3's 3-column
 *     space-padded format.
 *   - `.import` and `.dump` are intentionally unsupported (separate issues).
 */
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3 dot-commands", () => {
  describe("D1: .tables", () => {
    it("lists user tables, excludes sqlite_*", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite 'CREATE TABLE orders(id INT); CREATE TABLE refunds(id INT)'",
      );
      const result = await env.exec('sqlite3 /db.sqlite ".tables"');
      expect(result.stdout).toBe("orders\nrefunds\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("filters by LIKE pattern", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite 'CREATE TABLE orders(id INT); CREATE TABLE order_items(id INT); CREATE TABLE refunds(id INT)'",
      );
      const result = await env.exec("sqlite3 /db.sqlite \".tables 'order%'\"");
      expect(result.stdout).toBe("order_items\norders\n");
      expect(result.exitCode).toBe(0);
    });

    it("returns empty for empty database", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 :memory: ".tables"');
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("D2: .schema", () => {
    it("emits CREATE statements with trailing semicolons", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite 'CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT NOT NULL)'",
      );
      const result = await env.exec('sqlite3 /db.sqlite ".schema users"');
      expect(result.stdout).toBe(
        "CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT NOT NULL);\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("with no pattern dumps all schema", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite 'CREATE TABLE a(x); CREATE TABLE b(y); CREATE INDEX idx_b ON b(y);'",
      );
      const result = await env.exec('sqlite3 /db.sqlite ".schema"');
      expect(result.stdout).toBe(
        "CREATE TABLE a(x);\nCREATE TABLE b(y);\nCREATE INDEX idx_b ON b(y);\n",
      );
      expect(result.exitCode).toBe(0);
    });
  });

  describe("D3: .headers on/off", () => {
    it(".headers on shows header before the SELECT", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite \"CREATE TABLE t(id INT, name TEXT); INSERT INTO t VALUES (1, 'a')\"",
      );
      const script = `.headers on\nSELECT id, name FROM t`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.stdout).toBe("id|name\n1|a\n");
      expect(result.exitCode).toBe(0);
    });

    it(".header (singular) is an alias", async () => {
      const env = new Bash();
      await env.exec(
        'sqlite3 /db.sqlite "CREATE TABLE t(x INT); INSERT INTO t VALUES (42)"',
      );
      const script = `.header on\nSELECT * FROM t`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.stdout).toBe("x\n42\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("D4: .mode", () => {
    it(".mode csv produces comma-separated output", async () => {
      const env = new Bash();
      await env.exec(
        `sqlite3 /db.sqlite "CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES (1, 'hello'), (2, 'world')"`,
      );
      const script = `.mode csv\nSELECT * FROM t`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.stdout).toBe("1,hello\n2,world\n");
      expect(result.exitCode).toBe(0);
    });

    it(".mode tabs produces TSV", async () => {
      const env = new Bash();
      await env.exec(
        `sqlite3 /db.sqlite "CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES (1, 'x')"`,
      );
      const script = `.mode tabs\nSELECT * FROM t`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.stdout).toBe("1\tx\n");
      expect(result.exitCode).toBe(0);
    });

    it(".mode json produces JSON array", async () => {
      const env = new Bash();
      await env.exec(
        `sqlite3 /db.sqlite "CREATE TABLE t(id INT); INSERT INTO t VALUES (7)"`,
      );
      const script = `.mode json\nSELECT id FROM t`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.stdout).toBe('[{"id":7}]\n');
      expect(result.exitCode).toBe(0);
    });

    it("rejects unknown mode", async () => {
      const env = new Bash();
      const script = `.mode parquet\nSELECT 1`;
      const result = await env.exec(`sqlite3 :memory: '${script}'`);
      expect(result.stderr).toBe("Error: unknown mode: parquet\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("D5: .separator", () => {
    it(".separator , overrides the column separator", async () => {
      const env = new Bash();
      await env.exec(
        `sqlite3 /db.sqlite "CREATE TABLE t(a INT, b INT); INSERT INTO t VALUES (1, 2)"`,
      );
      const script = `.separator ,\nSELECT * FROM t`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.stdout).toBe("1,2\n");
      expect(result.exitCode).toBe(0);
    });

    it("requires an argument", async () => {
      const env = new Bash();
      const script = `.separator\nSELECT 1`;
      const result = await env.exec(`sqlite3 :memory: '${script}'`);
      expect(result.stderr).toBe("Error: .separator requires an argument\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("D6: .nullvalue", () => {
    it(".nullvalue NULL substitutes for NULL fields", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite 'CREATE TABLE t(x); INSERT INTO t VALUES (NULL), (1)'",
      );
      const script = `.nullvalue NULL\nSELECT * FROM t ORDER BY x`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.stdout).toBe("NULL\n1\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("D7: .read", () => {
    it("inlines a script file", async () => {
      const env = new Bash();
      await env.exec(
        `cat > /workspace/setup.sql <<'EOF'
CREATE TABLE t(x INT);
INSERT INTO t VALUES (10);
INSERT INTO t VALUES (20);
EOF`,
      );
      const script = `.read /workspace/setup.sql\nSELECT SUM(x) FROM t`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.stdout).toBe("30\n");
      expect(result.exitCode).toBe(0);
    });

    it("nested .read works (recursive expansion)", async () => {
      const env = new Bash();
      await env.exec(
        `cat > /workspace/inner.sql <<'EOF'
CREATE TABLE t(x INT);
INSERT INTO t VALUES (5);
EOF`,
      );
      await env.exec(
        `cat > /workspace/outer.sql <<'EOF'
.read /workspace/inner.sql
INSERT INTO t VALUES (15);
EOF`,
      );
      const script = `.read /workspace/outer.sql\nSELECT SUM(x) FROM t`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.stdout).toBe("20\n");
      expect(result.exitCode).toBe(0);
    });

    it("errors on missing file", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: ".read /workspace/does_not_exist.sql"',
      );
      expect(result.stderr).toContain("Error: cannot open");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("D8: .import (unsupported)", () => {
    it.todo("loads CSV into a table — see github issue: not yet implemented");
  });

  describe("D9: .dump (unsupported)", () => {
    it.todo(
      "dumps schema + INSERT statements — see github issue: not yet implemented",
    );
  });

  describe("explicitly unsupported dot-commands surface a clear error", () => {
    for (const cmd of [
      ".import",
      ".dump",
      ".clone",
      ".save",
      ".restore",
      ".backup",
      ".open",
      ".shell",
      ".system",
    ]) {
      it(`${cmd} is rejected with "not supported by just-bash sqlite3"`, async () => {
        const env = new Bash();
        const result = await env.exec(`sqlite3 :memory: '${cmd} foo bar'`);
        expect(result.stderr).toBe(
          `Error: ${cmd} is not supported by just-bash sqlite3\n`,
        );
        expect(result.exitCode).toBe(1);
      });
    }
  });

  describe("unknown dot-command", () => {
    it("returns sqlite3-shaped error", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 :memory: ".bogus arg1 arg2"');
      expect(result.stderr).toBe(
        'Error: unknown command or invalid arguments: "bogus". Enter ".help" for help\n',
      );
      expect(result.exitCode).toBe(1);
    });
  });

  describe("interleaved mode + query", () => {
    it("`.mode csv` followed by SELECT then `.mode list` — last mode wins (documented limitation)", async () => {
      const env = new Bash();
      await env.exec(
        `sqlite3 /db.sqlite "CREATE TABLE t(a INT, b INT); INSERT INTO t VALUES (1, 2)"`,
      );
      const script = `.mode csv\nSELECT * FROM t;\n.mode list\nSELECT * FROM t`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.stdout).toBe("1|2\n1|2\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe(".quit / .exit", () => {
    it(".quit stops processing — SQL after it is dropped", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite 'CREATE TABLE t(x INT); INSERT INTO t VALUES (1)'",
      );
      const script = `SELECT * FROM t;\n.quit\nDROP TABLE t`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
      const after = await env.exec(
        "sqlite3 /db.sqlite \"SELECT name FROM sqlite_master WHERE type='table'\"",
      );
      expect(after.stdout).toBe("t\n");
    });

    it(".exit behaves the same as .quit", async () => {
      const env = new Bash();
      await env.exec("sqlite3 /db.sqlite 'CREATE TABLE t(x INT)'");
      const script = `.exit\nDROP TABLE t`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.exitCode).toBe(0);
      const after = await env.exec(
        "sqlite3 /db.sqlite \"SELECT name FROM sqlite_master WHERE type='table'\"",
      );
      expect(after.stdout).toBe("t\n");
    });

    it(".quit inside a .read'd file stops the outer script too", async () => {
      const env = new Bash();
      await env.exec("sqlite3 /db.sqlite 'CREATE TABLE t(x INT)'");
      await env.exec(
        `cat > /workspace/mid.sql <<'EOF'
INSERT INTO t VALUES (1);
.quit
INSERT INTO t VALUES (2);
EOF`,
      );
      const script = `.read /workspace/mid.sql\nINSERT INTO t VALUES (3)`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.exitCode).toBe(0);
      const after = await env.exec(
        'sqlite3 /db.sqlite "SELECT x FROM t ORDER BY x"',
      );
      expect(after.stdout).toBe("1\n");
    });
  });
});
