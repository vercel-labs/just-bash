import { describe, expect, it, vi } from "vitest";
import { Bash } from "../Bash.js";
import { HttpFs } from "../fs/http-fs/http-fs.js";
import { mount } from "../fs/mount.js";

function mockFetch(files: Record<string, string>) {
  return vi.fn(async (url: string) => {
    for (const [path, content] of Object.entries(files)) {
      if (url.endsWith(path)) {
        return new Response(content, { status: 200 });
      }
    }
    return new Response("Not Found", { status: 404 });
  });
}

function createBashWithReadonlyMount(served: Record<string, string> = {}) {
  const files = Object.keys(served).map((p) =>
    p.startsWith("/") ? p.slice(1) : p,
  );
  const fetch = mockFetch(served);
  const fs = mount({
    "/ro": new HttpFs("https://cdn.test", files, { fetch }),
  });
  return new Bash({ fs });
}

describe("redirections to read-only filesystem", () => {
  describe("> (truncate)", () => {
    it("reports error and exits 1", async () => {
      const bash = createBashWithReadonlyMount();
      const r = await bash.exec("echo hello > /ro/file.txt");

      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("bash: /ro/file.txt: Read-only file system\n");
      expect(r.exitCode).toBe(1);
    });

    it("does not crash the interpreter", async () => {
      const bash = createBashWithReadonlyMount();
      const r1 = await bash.exec("echo hello > /ro/file.txt");
      expect(r1.exitCode).toBe(1);

      const r2 = await bash.exec("echo still works");
      expect(r2.stdout).toBe("still works\n");
      expect(r2.exitCode).toBe(0);
    });
  });

  describe(">> (append)", () => {
    it("reports error and exits 1", async () => {
      const bash = createBashWithReadonlyMount({ "/data.txt": "old" });
      const r = await bash.exec("echo more >> /ro/data.txt");

      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("bash: /ro/data.txt: Read-only file system\n");
      expect(r.exitCode).toBe(1);
    });
  });

  describe("2> (stderr redirect)", () => {
    it("reports error and exits 1", async () => {
      const bash = createBashWithReadonlyMount();
      const r = await bash.exec("echo err >&2 2> /ro/err.log");

      expect(r.stderr).toBe("bash: /ro/err.log: Read-only file system\n");
      expect(r.exitCode).toBe(1);
    });
  });

  describe("&> (both stdout and stderr)", () => {
    it("reports error and exits 1", async () => {
      const bash = createBashWithReadonlyMount();
      const r = await bash.exec("echo hello &> /ro/out.log");

      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("bash: /ro/out.log: Read-only file system\n");
      expect(r.exitCode).toBe(1);
    });
  });

  describe("&>> (append both)", () => {
    it("reports error and exits 1", async () => {
      const bash = createBashWithReadonlyMount();
      const r = await bash.exec("echo hello &>> /ro/out.log");

      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("bash: /ro/out.log: Read-only file system\n");
      expect(r.exitCode).toBe(1);
    });
  });

  describe("reads still work", () => {
    it("can cat from read-only mount alongside failed write", async () => {
      const bash = createBashWithReadonlyMount({ "/data.txt": "content" });

      const r1 = await bash.exec("cat /ro/data.txt");
      expect(r1.stdout).toBe("content");
      expect(r1.exitCode).toBe(0);

      const r2 = await bash.exec("echo nope > /ro/data.txt");
      expect(r2.exitCode).toBe(1);

      const r3 = await bash.exec("cat /ro/data.txt");
      expect(r3.stdout).toBe("content");
      expect(r3.exitCode).toBe(0);
    });
  });

  describe("cross-mount redirect works", () => {
    it("can pipe from readonly to writable", async () => {
      const bash = createBashWithReadonlyMount({
        "/source.txt": "hello from remote",
      });

      const r = await bash.exec(
        "cat /ro/source.txt > /tmp/local.txt && cat /tmp/local.txt",
      );
      expect(r.stdout).toBe("hello from remote");
      expect(r.exitCode).toBe(0);
    });
  });
});
