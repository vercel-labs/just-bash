/**
 * Dot-command tests for sqlite3.
 *
 * Real sqlite3 supports CLI dot-commands (`.tables`, `.schema`, `.mode csv`,
 * `.read script.sql`, ...). The Braintrust trace catalogue showed agents
 * reach for these by reflex; the preprocessor pins behavior here.
 * D-numbers map to docs/sqlite3-invocation-shapes.md.
 *
 * Contract (see dot-commands.ts for the full rationale):
 *
 *   - The scanner is char-level and tracks SQL string literals and
 *     comments, so `.foo` inside `'…'`, `"…"`, `-- …`, or `/* … *​/`
 *     is left intact. Boundaries are start-of-input, `;`, `\n`.
 *
 *   - `.tables`, `.schema`, `.indexes`/`.indices`, `.databases`, `.help`
 *     translate to equivalent SQL or SELECTs.
 *
 *   - `.headers` / `.header` (on/off), `.mode <mode>`, `.separator <s>`,
 *     `.nullvalue <text>` mutate formatter state for downstream SQL.
 *     Bad arguments surface a preprocessor error.
 *
 *   - `.echo` / `.timer` / `.changes` / `.bail` / `.show` / `.eqp` /
 *     `.width` / `.prompt` / `.print` / `.explain` are silently dropped.
 *
 *   - `.read FILE` opens the file and inlines its contents (recursive,
 *     bounded by MAX_READ_DEPTH); missing files / bad args surface a
 *     preprocessor error.
 *
 *   - `.dump` / `.save` / `.import` / `.backup` / `.restore` / `.open` /
 *     `.clone` / `.output` / `.shell` / `.system` / `.cd` / `.load` /
 *     `.iotrace` / `.log` / `.excel` aren't implemented; each emits an
 *     in-band SELECT carrying an actionable hint.
 *
 *   - `.quit` / `.exit` terminate preprocessing.
 *
 *   - Unknown dot-commands fall through verbatim so sql.js produces its
 *     native `near ".": syntax error`.
 *
 *   - Without -bail, preprocessor errors are appended to stdout (in-band
 *     with SQL output) and the invocation still exits 1; with -bail the
 *     error goes to stderr and we short-circuit the SQL execution.
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

    it("filters by quoted LIKE pattern", async () => {
      const env = new Bash();
      await env.exec(
        "sqlite3 /db.sqlite 'CREATE TABLE orders(id INT); CREATE TABLE order_items(id INT); CREATE TABLE refunds(id INT)'",
      );
      const result = await env.exec("sqlite3 /db.sqlite \".tables 'order%'\"");
      expect(result.stdout).toBe("order_items\norders\n");
      expect(result.exitCode).toBe(0);
    });

    it("converts shell-style `*` to SQL `%`", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "CREATE TABLE users(id INT); CREATE TABLE orders(id INT); .tables user*"',
      );
      expect(result.stdout.trim()).toBe("users");
      expect(result.exitCode).toBe(0);
    });

    it("converts shell-style `?` to SQL `_`", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "CREATE TABLE ab(id INT); CREATE TABLE abc(id INT); .tables a?"',
      );
      expect(result.stdout.trim()).toBe("ab");
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

    it("rejects unknown argument", async () => {
      const env = new Bash();
      const script = `.headers maybe\nSELECT 1`;
      const result = await env.exec(`sqlite3 :memory: '${script}'`);
      expect(result.stdout).toContain(
        "Error: unknown argument to .headers: maybe",
      );
      expect(result.exitCode).toBe(1);
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

    it("rejects unknown mode without -bail (in-band on stdout)", async () => {
      const env = new Bash();
      const script = `.mode parquet\nSELECT 1`;
      const result = await env.exec(`sqlite3 :memory: '${script}'`);
      expect(result.stdout).toContain("Error: unknown mode: parquet");
      expect(result.exitCode).toBe(1);
    });

    it("with -bail, .mode parquet errors to stderr and short-circuits", async () => {
      const env = new Bash();
      const script = `.mode parquet\nSELECT 1`;
      const result = await env.exec(`sqlite3 -bail :memory: '${script}'`);
      expect(result.stderr).toBe("Error: unknown mode: parquet\n");
      expect(result.stdout).toBe("");
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
      expect(result.stdout).toContain("Error: .separator requires an argument");
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

    it("errors on missing file with `cannot open` matching real sqlite3", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: ".read /workspace/does_not_exist.sql"',
      );
      expect(result.stdout).toContain("cannot open");
      expect(result.stdout).toContain("/workspace/does_not_exist.sql");
      expect(result.exitCode).toBe(1);
    });

    it("errors on missing argument", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 :memory: ".read"');
      expect(result.stdout).toContain("Error: usage: .read FILE");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("D8: not-implemented family (in-band SELECT)", () => {
    it.each([
      [".dump", "query sqlite_master"],
      [".save /tmp/x.db", "redirect with shell"],
      [".backup /tmp/x.db", "redirect with shell"],
      [".import data.csv t", "INSERTs from a SQL script"],
      [".clone other.db", "INSERT INTO ... SELECT"],
      [".restore /tmp/x.db", "open the file directly"],
      [".open other.db", "open the file directly"],
      [".output /tmp/x.txt", "redirect output with shell"],
      [".shell ls", "use bash for shell commands"],
      [".system ls", "use bash for shell commands"],
      [".cd /tmp", "use bash 'cd'"],
      [".load ext.so", "extension loading is disabled"],
    ])("%s emits an in-band SELECT with an actionable hint", async (invocation, hintFragment) => {
      const env = new Bash();
      const result = await env.exec(`sqlite3 :memory: '${invocation}'`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(invocation.split(/\s+/, 1)[0]);
      expect(result.stdout).toContain("is not implemented in just-bash");
      expect(result.stdout).toContain(hintFragment);
    });
  });

  describe("D9: silent no-op metacommands", () => {
    it.each([
      ".echo on",
      ".timer off",
      ".changes on",
      ".bail off",
      ".show",
      ".eqp on",
      ".width 10 20",
      ".print hello",
      ".explain on",
    ])("%s is silently dropped", async (cmd) => {
      const env = new Bash();
      const script = `${cmd}\nSELECT 1`;
      const result = await env.exec(`sqlite3 :memory: '${script}'`);
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("D10: unknown dot-commands fall through to sql.js", () => {
    it(".bogus_command produces sql.js's native syntax error", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 :memory: ".bogus_command"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("syntax error");
    });
  });

  describe("D11: SQL string literals and comments are preserved", () => {
    it("does not corrupt single-quoted string literals containing dot-command-like text", async () => {
      const env = new Bash();
      const result = await env.exec(
        `sqlite3 :memory: "CREATE TABLE t(s TEXT); INSERT INTO t VALUES('node.js'); SELECT * FROM t"`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("node.js");
    });

    it("does not corrupt multiline single-quoted literals containing `\\n.tables`", async () => {
      // Real regression case: a newline-prefixed dot-command-like fragment
      // inside a string literal would be picked up by a line-based scanner
      // and rewritten into a SELECT against sqlite_master, mangling the row.
      const env = new Bash();
      const result = await env.exec(
        `sqlite3 :memory: <<'SQL'\nCREATE TABLE t(s TEXT);\nINSERT INTO t VALUES('a\n.tables');\nSELECT s FROM t;\nSQL`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("a\n.tables");
    });

    it("does not translate dot-commands inside SQL `--` line comments", async () => {
      const env = new Bash();
      const result = await env.exec(
        `sqlite3 :memory: <<'SQL'\n-- .read foo.sql\nSELECT 1;\nSQL`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("1");
    });

    it("does not translate dot-commands inside SQL `/* */` block comments", async () => {
      const env = new Bash();
      const result = await env.exec(
        `sqlite3 :memory: <<'SQL'\n/* .read foo.sql */\nSELECT 1;\nSQL`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("1");
    });
  });

  describe("D12: inline `;`-separated dot-commands and SQL", () => {
    it("formatter mutations on the same line apply to subsequent SQL", async () => {
      // The scanner recognizes each `;`-separated segment as its own
      // boundary. `.headers on; .mode csv;` flips header and mode, then
      // CREATE/INSERT/SELECT runs with both applied.
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: ".headers on; .mode csv; CREATE TABLE t(x); INSERT INTO t VALUES(42); SELECT * FROM t;"',
      );
      expect(result.stdout).toBe("x\n42\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("D13: .help", () => {
    it("emits the supported-commands summary", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 :memory: ".help"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Supported dot commands");
      expect(result.stdout).toContain(".tables");
      expect(result.stdout).toContain(".mode");
    });
  });

  describe("D14: .quit / .exit terminate preprocessing", () => {
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

  describe("D15: scanner edge cases (review-pinned regressions)", () => {
    it("a `;`-terminated drop does not leak an empty statement into the output", async () => {
      // The scanner consumes the trailing `;` after a dropped command
      // (`.headers on;` etc.) so `-echo` doesn't show a leading orphan
      // `;` and downstream consumers of the emitted SQL don't see an
      // empty statement.
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -echo :memory: ".headers on; SELECT 1"',
      );
      // -echo prints the SQL exactly as sent to the worker. We want no
      // leading `;` (empty statement) and no leading whitespace either.
      expect(result.stdout.startsWith(";")).toBe(false);
      expect(result.exitCode).toBe(0);
    });

    it("a chained drop after a consumed `;` re-recognizes the next dot-command", async () => {
      // After `.headers on;`'s trailing `;` is consumed, the scanner
      // must treat the next char as if at a fresh boundary so `.mode csv`
      // is also recognized. Pinned via the formatter mutation it should
      // produce.
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: ".headers on; .mode csv; CREATE TABLE t(x); INSERT INTO t VALUES (42); SELECT * FROM t;"',
      );
      // Both .headers on and .mode csv applied → CSV with header row.
      expect(result.stdout).toBe("x\n42\n");
      expect(result.exitCode).toBe(0);
    });

    it("a block comment does not leave the scanner at a boundary", async () => {
      // `;` then `/* … */` then `.tables` (no intervening newline) used
      // to fire the dot-command branch because the block-comment handler
      // didn't reset atBoundary. `.tables` here must NOT be rewritten —
      // sql.js will syntax-error on it instead.
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 :memory: "SELECT 1;/* note */.tables"',
      );
      // `.tables` falls through verbatim → sql.js syntax error in stdout.
      expect(result.stdout).toContain("1");
      expect(result.stdout).toContain("syntax error");
      expect(result.exitCode).toBe(0);
    });

    it("a block comment on its own line followed by a newline still allows .tables on the next line", async () => {
      // Sanity: with a `\n` between `*/` and the next line, the boundary
      // detection on `\n` re-arms atBoundary, so `.tables` on the next
      // line IS recognized. The block-comment-doesn't-reset-atBoundary
      // fix targets the same-line case only.
      const env = new Bash();
      await env.exec("sqlite3 /db.sqlite 'CREATE TABLE alpha(x INT)'");
      const script = `/* preamble */\n.tables`;
      const result = await env.exec(`sqlite3 /db.sqlite '${script}'`);
      expect(result.stdout.trim()).toBe("alpha");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("D16: interleaved .mode + query (last write wins)", () => {
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
});
