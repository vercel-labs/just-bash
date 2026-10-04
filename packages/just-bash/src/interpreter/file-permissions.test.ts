import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

const createBash = (): Bash =>
  new Bash({
    files: {
      "/data.txt": "original\n",
      "/secret.sh": "echo secret\n",
      "/s.sh": "echo script\n",
    },
  });

describe("shell file permissions", () => {
  it("reports denied reads from cat", async () => {
    const bash = createBash();
    const result = await bash.exec("chmod 000 /data.txt; cat /data.txt");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "cat: /data.txt: Permission denied\n",
      exitCode: 1,
    });
  });

  it("reports denied reads from input redirection", async () => {
    const bash = createBash();
    const result = await bash.exec("chmod 000 /data.txt; cat < /data.txt");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: /data.txt: Permission denied\n",
      exitCode: 1,
    });
  });

  it("does not turn a denied read-write open into a write-only open", async () => {
    const bash = createBash();
    const result = await bash.exec("chmod 000 /data.txt; cat <> /data.txt");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: /data.txt: Permission denied\n",
      exitCode: 1,
    });
  });

  it("reports denied reads from bash FILE with status 126", async () => {
    const bash = createBash();
    const result = await bash.exec("chmod 000 /secret.sh; bash /secret.sh");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: /secret.sh: Permission denied\n",
      exitCode: 126,
    });
  });

  it("reports denied reads from sh FILE with status 126", async () => {
    const bash = createBash();
    const result = await bash.exec("chmod 000 /secret.sh; sh /secret.sh");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "sh: /secret.sh: Permission denied\n",
      exitCode: 126,
    });
  });

  it("reports denied reads from source", async () => {
    const bash = createBash();
    const result = await bash.exec("chmod 000 /secret.sh; source /secret.sh");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: /secret.sh: Permission denied\n",
      exitCode: 1,
    });
  });

  it("reports denied reads from dot source", async () => {
    const bash = createBash();
    const result = await bash.exec("chmod 000 /secret.sh; . /secret.sh");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: /secret.sh: Permission denied\n",
      exitCode: 1,
    });
  });

  it("preserves files when truncation is denied", async () => {
    const bash = createBash();
    const result = await bash.exec(
      "chmod 444 /data.txt; echo x > /data.txt; cat /data.txt",
    );

    expect(result).toMatchObject({
      stdout: "original\n",
      stderr: "bash: /data.txt: Permission denied\n",
      exitCode: 0,
    });
  });

  it("preserves files when append redirection is denied", async () => {
    const bash = createBash();
    const result = await bash.exec(
      "chmod 444 /data.txt; echo x >> /data.txt; cat /data.txt",
    );

    expect(result).toMatchObject({
      stdout: "original\n",
      stderr: "bash: /data.txt: Permission denied\n",
      exitCode: 0,
    });
  });

  it("reports denied writes from tee", async () => {
    const bash = createBash();
    const result = await bash.exec(
      "chmod 444 /data.txt; echo x | tee /data.txt",
    );

    expect(result).toMatchObject({
      stdout: "x\n",
      stderr: "tee: /data.txt: Permission denied\n",
      exitCode: 1,
    });
    expect(await bash.readFile("/data.txt")).toBe("original\n");
  });

  it("reports denied executable script reads with status 126", async () => {
    const bash = createBash();
    const result = await bash.exec("chmod 111 /s.sh; /s.sh");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: /s.sh: Permission denied\n",
      exitCode: 126,
    });
  });

  it("restores reads and writes after chmod restores owner permissions", async () => {
    const bash = createBash();
    const result = await bash.exec(
      "chmod 000 /data.txt; chmod 644 /data.txt; cat /data.txt",
    );

    expect(result).toMatchObject({
      stdout: "original\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
