import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3 utf8 stdin", () => {
  const KOREAN = "한글";
  const ACCENTED = "café";
  const CJK = "漢字";

  it("preserves UTF-8 SQL string literals piped via stdin", async () => {
    const env = new Bash();
    const sql =
      `CREATE TABLE t(k TEXT, a TEXT, c TEXT); ` +
      `INSERT INTO t VALUES('${KOREAN}','${ACCENTED}','${CJK}'); ` +
      "SELECT k, a, c FROM t;";

    const result = await env.exec(`echo "${sql}" | sqlite3 :memory:`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${KOREAN}|${ACCENTED}|${CJK}`);
  });

  it("inserts and reads back UTF-8 values correctly through sql.js execution", async () => {
    const env = new Bash();
    const insertSql =
      "CREATE TABLE messages(text TEXT); " +
      `INSERT INTO messages VALUES('${KOREAN} ${ACCENTED} ${CJK}');`;

    const insert = await env.exec(`echo "${insertSql}" | sqlite3 /utf8.db`);
    expect(insert.exitCode).toBe(0);

    const select = await env.exec('sqlite3 /utf8.db "SELECT text FROM messages"');
    expect(select.exitCode).toBe(0);
    expect(select.stdout).toContain(`${KOREAN} ${ACCENTED} ${CJK}`);
  });
});
