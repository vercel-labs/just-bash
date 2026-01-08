/**
 * Tests for xan multi-file commands: cat, join, merge
 * These operations work with multiple CSV files
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xan cat", () => {
  it("concatenates multiple files with same headers", async () => {
    const bash = new Bash({
      files: {
        "/a.csv": "id,name\n1,alice\n2,bob\n",
        "/b.csv": "id,name\n3,charlie\n",
      },
    });
    const result = await bash.exec("xan cat /a.csv /b.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,name\n1,alice\n2,bob\n3,charlie\n");
  });

  it("errors on mismatched headers without -p", async () => {
    const bash = new Bash({
      files: {
        "/a.csv": "id,name\n1,alice\n",
        "/b.csv": "id,email\n2,bob@x.com\n",
      },
    });
    const result = await bash.exec("xan cat /a.csv /b.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("headers do not match");
  });

  it("pads missing columns with -p", async () => {
    const bash = new Bash({
      files: {
        "/a.csv": "id,name\n1,alice\n",
        "/b.csv": "id,email\n2,bob@x.com\n",
      },
    });
    const result = await bash.exec("xan cat -p /a.csv /b.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,name,email\n1,alice,\n2,,bob@x.com\n");
  });

  it("errors with no files", async () => {
    const bash = new Bash({});
    const result = await bash.exec("xan cat");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no files");
  });
});

describe("xan join", () => {
  it("performs inner join", async () => {
    const bash = new Bash({
      files: {
        "/left.csv": "id,name\n1,alice\n2,bob\n3,charlie\n",
        "/right.csv": "user_id,score\n1,100\n2,85\n4,90\n",
      },
    });
    const result = await bash.exec("xan join id /left.csv user_id /right.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "id,name,user_id,score\n1,alice,1,100\n2,bob,2,85\n",
    );
  });

  it("performs left join with --left", async () => {
    const bash = new Bash({
      files: {
        "/left.csv": "id,name\n1,alice\n2,bob\n3,charlie\n",
        "/right.csv": "user_id,score\n1,100\n2,85\n",
      },
    });
    const result = await bash.exec(
      "xan join --left id /left.csv user_id /right.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "id,name,user_id,score\n1,alice,1,100\n2,bob,2,85\n3,charlie,,\n",
    );
  });

  it("performs right join with --right", async () => {
    const bash = new Bash({
      files: {
        "/left.csv": "id,name\n1,alice\n",
        "/right.csv": "user_id,score\n1,100\n2,85\n",
      },
    });
    const result = await bash.exec(
      "xan join --right id /left.csv user_id /right.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "id,name,user_id,score\n1,alice,1,100\n,,2,85\n",
    );
  });

  it("performs full outer join with --full", async () => {
    const bash = new Bash({
      files: {
        "/left.csv": "id,name\n1,alice\n2,bob\n",
        "/right.csv": "user_id,score\n2,85\n3,90\n",
      },
    });
    const result = await bash.exec(
      "xan join --full id /left.csv user_id /right.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "id,name,user_id,score\n1,alice,,\n2,bob,2,85\n,,3,90\n",
    );
  });

  it("uses default value with -D", async () => {
    const bash = new Bash({
      files: {
        "/left.csv": "id,name\n1,alice\n2,bob\n",
        "/right.csv": "user_id,score\n1,100\n",
      },
    });
    const result = await bash.exec(
      "xan join --left -D 'N/A' id /left.csv user_id /right.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "id,name,user_id,score\n1,alice,1,100\n2,bob,N/A,N/A\n",
    );
  });

  it("handles one-to-many joins", async () => {
    const bash = new Bash({
      files: {
        "/users.csv": "id,name\n1,alice\n",
        "/orders.csv": "user_id,item\n1,book\n1,pen\n1,paper\n",
      },
    });
    const result = await bash.exec(
      "xan join id /users.csv user_id /orders.csv",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "id,name,user_id,item\n1,alice,1,book\n1,alice,1,pen\n1,alice,1,paper\n",
    );
  });

  it("deduplicates shared column names", async () => {
    const bash = new Bash({
      files: {
        "/left.csv": "id,name,status\n1,alice,active\n2,bob,inactive\n",
        "/right.csv": "id,status,score\n1,verified,100\n2,pending,85\n",
      },
    });
    const result = await bash.exec("xan join id /left.csv id /right.csv");
    expect(result.exitCode).toBe(0);
    // 'status' appears in both files - should only appear once (from left file)
    // 'id' is the join key - should only appear once
    expect(result.stdout).toBe(
      "id,name,status,score\n1,alice,active,100\n2,bob,inactive,85\n",
    );
  });

  it("errors on missing key column", async () => {
    const bash = new Bash({
      files: {
        "/a.csv": "id,name\n1,alice\n",
        "/b.csv": "user_id,score\n1,100\n",
      },
    });
    const result = await bash.exec(
      "xan join nonexistent /a.csv user_id /b.csv",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "xan join: column 'nonexistent' not found in first file\n",
    );
  });
});

describe("xan merge", () => {
  it("merges multiple files with same headers", async () => {
    const bash = new Bash({
      files: {
        "/a.csv": "id,val\n1,a\n3,c\n",
        "/b.csv": "id,val\n2,b\n4,d\n",
      },
    });
    const result = await bash.exec("xan merge /a.csv /b.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,val\n1,a\n3,c\n2,b\n4,d\n");
  });

  it("sorts merged data with -s", async () => {
    const bash = new Bash({
      files: {
        "/a.csv": "id,val\n1,a\n3,c\n",
        "/b.csv": "id,val\n2,b\n4,d\n",
      },
    });
    const result = await bash.exec("xan merge -s id /a.csv /b.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("id,val\n1,a\n2,b\n3,c\n4,d\n");
  });

  it("errors on mismatched headers", async () => {
    const bash = new Bash({
      files: {
        "/a.csv": "id,name\n1,alice\n",
        "/b.csv": "id,email\n2,bob@x.com\n",
      },
    });
    const result = await bash.exec("xan merge /a.csv /b.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("same headers");
  });

  it("requires at least 2 files", async () => {
    const bash = new Bash({
      files: { "/a.csv": "id,val\n1,a\n" },
    });
    const result = await bash.exec("xan merge /a.csv");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("usage");
  });
});
