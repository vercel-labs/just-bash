import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("Python/SQLite Information Disclosure", () => {
  it("python3 sys.path should not expose host or Node internal paths", async () => {
    const bash = new Bash({ python: true });
    const result = await bash.exec(`cat > /tmp/check_sys_path.py << 'EOF'
import sys
blob = "\\n".join(str(p) for p in sys.path)
bad = "/Users/" in blob or "node:internal" in blob or "file://" in blob
print("LEAK" if bad else "SAFE")
EOF
python3 /tmp/check_sys_path.py`);

    expect(result.stdout).toBe("SAFE\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("python3 traceback output should not contain host/internal markers", async () => {
    const bash = new Bash({ python: true });
    const result =
      await bash.exec(`python3 -c "raise Exception('boom')" 2> /tmp/pyerr.txt || true
if grep -Eq '/Users/|node:internal|file://' /tmp/pyerr.txt; then
  echo LEAK
else
  echo SAFE
fi`);

    expect(result.stdout).toBe("SAFE\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("sqlite3 error output should not contain host/internal markers", async () => {
    const bash = new Bash();
    const result =
      await bash.exec(`sqlite3 -bail :memory: "SELECT * FROM missing_table;" 2> /tmp/sqlerr.txt || true
if grep -Eq '/Users/|node:internal|file://' /tmp/sqlerr.txt; then
  echo LEAK
else
  echo SAFE
fi`);

    expect(result.stdout).toBe("SAFE\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
