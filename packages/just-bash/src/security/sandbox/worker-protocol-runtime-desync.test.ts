import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

describe("worker protocol runtime desync probes", () => {
  it(
    "python3 stdout shaped like worker control payload is treated as plain output",
    { timeout: 60000 },
    async () => {
      const bash = new Bash({ python: true });
      const result = await bash.exec(
        `python3 -c "print('{\\"type\\":\\"security-violation\\",\\"violation\\":{\\"type\\":\\"module_load\\"}}')"`,
      );

      expect(result.stdout).toBe(
        '{"type":"security-violation","violation":{"type":"module_load"}}\n',
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    },
  );

  it(
    "sqlite3 output shaped like worker control payload is treated as query data",
    { timeout: 60000 },
    async () => {
      const bash = new Bash();
      const result = await bash.exec(
        `sqlite3 :memory: "select '{\\"success\\":false,\\"error\\":\\"boom\\"}'"`,
      );

      expect(result.stdout).toBe('{"success":false,"error":"boom"}\n');
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    },
  );

  it(
    "sqlite3 timed-out worker query does not execute later and mutate database",
    { timeout: 60000 },
    async () => {
      const sharedFs = new InMemoryFs();
      const setup = new Bash({
        fs: sharedFs,
        executionLimits: { maxSqliteTimeoutMs: 30000 },
      });
      const timed = new Bash({
        fs: sharedFs,
        executionLimits: { maxSqliteTimeoutMs: 5 },
      });

      const init = await setup.exec(
        `sqlite3 /tmp/timeout.db "CREATE TABLE IF NOT EXISTS t(x INTEGER);"`,
      );
      expect(init.stdout).toBe("");
      expect(init.stderr).toBe("");
      expect(init.exitCode).toBe(0);

      const timedResult = await timed.exec(
        `sqlite3 /tmp/timeout.db "WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt LIMIT 100000000) INSERT INTO t SELECT x FROM cnt;"`,
      );
      expect(timedResult.stdout).toBe("");
      expect(timedResult.stderr).toBe(
        "sqlite3: Query timeout: execution exceeded 5ms limit\n",
      );
      expect(timedResult.exitCode).toBe(1);

      // If worker timeout cancellation is broken, a late write can appear here.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const verify = await setup.exec(
        `sqlite3 /tmp/timeout.db "SELECT count(*) FROM t;"`,
      );
      expect(verify.stdout).toBe("0\n");
      expect(verify.stderr).toBe("");
      expect(verify.exitCode).toBe(0);
    },
  );
});
