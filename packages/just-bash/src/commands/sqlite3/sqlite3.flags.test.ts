/**
 * Flag tests for sqlite3 — pins the X-numbered flags from the trace catalogue
 * (-init, -batch). The other flags (-header, -separator, -bail, -echo, -cmd,
 * etc.) are covered in sqlite3.options.test.ts.
 */
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3 flags", () => {
  describe("X1: -init <file>", () => {
    it("runs the init script before the main SQL", async () => {
      const env = new Bash();
      await env.exec(
        `cat > /workspace/init.sql <<'EOF'
CREATE TABLE t(x INT);
INSERT INTO t VALUES (10), (20), (30);
EOF`,
      );
      const result = await env.exec(
        'sqlite3 -init /workspace/init.sql /db.sqlite "SELECT SUM(x) FROM t"',
      );
      expect(result.stdout).toBe("60\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("init runs even with stdin SQL", async () => {
      const env = new Bash();
      await env.exec(
        `cat > /workspace/init.sql <<'EOF'
CREATE TABLE t(x INT);
INSERT INTO t VALUES (1), (2);
EOF`,
      );
      const result = await env.exec(
        `echo "SELECT COUNT(*) FROM t" | sqlite3 -init /workspace/init.sql /db.sqlite`,
      );
      expect(result.stdout).toBe("2\n");
      expect(result.exitCode).toBe(0);
    });

    it("missing init file errors with exit 1", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -init /workspace/nope.sql :memory: "SELECT 1"',
      );
      expect(result.stderr).toContain("cannot open -init file");
      expect(result.exitCode).toBe(1);
    });

    it("missing argument errors", async () => {
      const env = new Bash();
      const result = await env.exec("sqlite3 -init");
      expect(result.stderr).toBe("sqlite3: Error: missing argument to -init\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("X2: -batch", () => {
    it("is accepted as a no-op (just-bash is always non-interactive)", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 -batch :memory: "SELECT 1"');
      expect(result.stdout).toBe("1\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("can be combined with other flags", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -batch -header :memory: \"CREATE TABLE t(name TEXT); INSERT INTO t VALUES ('a'); SELECT * FROM t\"",
      );
      expect(result.stdout).toBe("name\na\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("interplay: -init + .read + dot-commands", () => {
    it("init.sql can itself contain dot-commands", async () => {
      const env = new Bash();
      await env.exec(
        `cat > /workspace/sub.sql <<'EOF'
CREATE TABLE sub(x INT);
INSERT INTO sub VALUES (100);
EOF`,
      );
      await env.exec(
        `cat > /workspace/init.sql <<'EOF'
.read /workspace/sub.sql
.headers on
EOF`,
      );
      const result = await env.exec(
        'sqlite3 -init /workspace/init.sql /db.sqlite "SELECT x FROM sub"',
      );
      expect(result.stdout).toBe("x\n100\n");
      expect(result.exitCode).toBe(0);
    });
  });
});
