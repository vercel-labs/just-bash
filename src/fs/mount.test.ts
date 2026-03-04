import { describe, expect, it, vi } from "vitest";
import { Bash } from "../Bash.js";
import { HttpFs } from "./http-fs/http-fs.js";
import { InMemoryFs } from "./in-memory-fs/in-memory-fs.js";
import { mount } from "./mount.js";

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

describe("mount", () => {
  it("creates a MountableFs with InMemoryFs base by default", async () => {
    const fs = mount({});

    expect(await fs.exists("/")).toBe(true);
    expect(await fs.exists("/dev/null")).toBe(true);
    expect(await fs.exists("/bin")).toBe(true);
  });

  it("uses a custom base when / is provided", async () => {
    const base = new InMemoryFs({ "/custom.txt": "hi" });
    const fs = mount({ "/": base });

    expect(await fs.readFile("/custom.txt")).toBe("hi");
    // custom base doesn't get auto-initialised
    expect(await fs.exists("/dev/null")).toBe(false);
  });

  it("mounts HttpFs at a path", async () => {
    const fetch = mockFetch({ "/readme.txt": "hello from http" });
    const httpFs = new HttpFs("https://cdn.test", ["readme.txt"], { fetch });

    const fs = mount({ "/remote": httpFs });

    expect(await fs.readFile("/remote/readme.txt")).toBe("hello from http");
    expect(await fs.readdir("/remote")).toEqual(["readme.txt"]);
  });

  it("composes multiple mounts", async () => {
    const fetch = mockFetch({
      "/a.txt": "file-a",
      "/b.txt": "file-b",
    });

    const fs = mount({
      "/alpha": new HttpFs("https://a.test", ["a.txt"], { fetch }),
      "/beta": new HttpFs("https://b.test", ["b.txt"], { fetch }),
    });

    expect(await fs.readFile("/alpha/a.txt")).toBe("file-a");
    expect(await fs.readFile("/beta/b.txt")).toBe("file-b");
    expect(await fs.exists("/dev/null")).toBe(true);
  });

  it("works end-to-end with Bash", async () => {
    const fetch = mockFetch({
      "/greeting.txt": "Hello from the network",
    });

    const fs = mount({
      "/data": new HttpFs("https://cdn.test", ["greeting.txt"], { fetch }),
    });

    const bash = new Bash({ fs });
    const result = await bash.exec("cat /data/greeting.txt");

    expect(result.stdout).toBe("Hello from the network");
    expect(result.exitCode).toBe(0);
  });

  it("allows writes to the base while remote is read-only", async () => {
    const fetch = mockFetch({ "/info.txt": "remote data" });

    const fs = mount({
      "/remote": new HttpFs("https://cdn.test", ["info.txt"], { fetch }),
    });

    await fs.writeFile("/tmp/local.txt", "local data");
    expect(await fs.readFile("/tmp/local.txt")).toBe("local data");
    expect(await fs.readFile("/remote/info.txt")).toBe("remote data");

    await expect(fs.writeFile("/remote/new.txt", "nope")).rejects.toThrow(
      "EROFS",
    );
  });

  it("supports ls on mounted HttpFs directories via Bash", async () => {
    const fetch = mockFetch({
      "/alpha.txt": "a",
      "/beta.txt": "b",
    });

    const fs = mount({
      "/data": new HttpFs("https://cdn.test", ["alpha.txt", "beta.txt"], {
        fetch,
      }),
    });

    const bash = new Bash({ fs });
    const result = await bash.exec("ls /data");

    expect(result.stdout).toBe("alpha.txt\nbeta.txt\n");
    expect(result.exitCode).toBe(0);
  });

  it("supports piping from mounted files", async () => {
    const fetch = mockFetch({
      "/numbers.txt": "3\n1\n2\n",
    });

    const fs = mount({
      "/data": new HttpFs("https://cdn.test", ["numbers.txt"], { fetch }),
    });

    const bash = new Bash({ fs });
    const result = await bash.exec("cat /data/numbers.txt | sort");

    expect(result.stdout).toBe("1\n2\n3\n");
    expect(result.exitCode).toBe(0);
  });

  it("supports grep on mounted files", async () => {
    const fetch = mockFetch({
      "/log.txt": "INFO: started\nERROR: disk full\nINFO: done\n",
    });

    const fs = mount({
      "/logs": new HttpFs("https://cdn.test", ["log.txt"], { fetch }),
    });

    const bash = new Bash({ fs });
    const result = await bash.exec("grep ERROR /logs/log.txt");

    expect(result.stdout).toBe("ERROR: disk full\n");
    expect(result.exitCode).toBe(0);
  });

  it("supports wc on mounted files", async () => {
    const fetch = mockFetch({
      "/data.csv": "a,b,c\n1,2,3\n4,5,6\n",
    });

    const fs = mount({
      "/data": new HttpFs("https://cdn.test", ["data.csv"], { fetch }),
    });

    const bash = new Bash({ fs });
    const result = await bash.exec("wc -l /data/data.csv");

    expect(result.stdout).toBe("3 /data/data.csv\n");
    expect(result.exitCode).toBe(0);
  });
});
