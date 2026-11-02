// Automa N7c: cookies come from an explicit host capability, never response headers.
import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../../Bash.js";
import { InMemoryFs } from "../../../fs/in-memory-fs/in-memory-fs.js";
import { createSecureFetch } from "../../../network/fetch.js";

const url = "https://api.example.com/data";
const jar =
  "# Netscape HTTP Cookie File\n#HttpOnly_api.example.com\tFALSE\t/\tTRUE\t0\tsid\tvalue\n";
const response = {
  status: 200,
  statusText: "OK",
  headers: { "set-cookie": "not=a-jar" },
  body: new TextEncoder().encode("ok"),
  url,
  cookieJar: jar,
};

describe("explicit cookie jar capability", () => {
  it.each([
    "-b sid=x",
    "-bsid=x",
    "--cookie sid=x",
    "--cookie=@jar",
    "-j",
    "--junk-session-cookies",
    "-H 'Cookie: sid=x'",
    "--header='cookie: sid=x'",
  ])("rejects %s before dispatch", async (arg) => {
    const fetch = vi.fn(async () => response);
    const shell = new Bash({ fetch });
    const result = await shell.exec(`curl ${arg} ${url}`);
    expect(result).toMatchObject({ stdout: "", exitCode: 2 });
    expect(result.stderr).toMatch(
      /^curl: (?:cookie input and session-cookie filtering|Cookie header overrides) are not supported\n$/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    "-c /jar",
    "-c/jar",
    "--cookie-jar /jar",
    "--cookie-jar=/jar",
  ])("writes complete host jar for %s", async (arg) => {
    const fetch = vi.fn(async () => response);
    const shell = new Bash({ fetch });
    expect(await shell.exec(`curl ${arg} ${url}`)).toMatchObject({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
    expect(await shell.fs.readFile("/jar")).toBe(jar);
    expect(fetch.mock.calls[0]).toMatchObject([
      url,
      { wantCookieJar: true, followRedirects: false },
    ]);
  });
  it("writes jar to stdout after transfer/write-out without creating a dash file", async () => {
    const shell = new Bash({ fetch: async () => response });
    expect(
      await shell.exec(`curl -c - -w '%{http_code}\n' ${url}`),
    ).toMatchObject({ stdout: `ok200\n${jar}`, stderr: "", exitCode: 0 });
    expect(await shell.fs.exists("/-")).toBe(false);
  });
  it("exports even for HTTP -f failure, preserving nonzero exit", async () => {
    const shell = new Bash({
      fetch: async () => ({ ...response, status: 403 }),
    });
    expect(
      await shell.exec(`curl -sf -c /jar -w '%{http_code}' ${url}`),
    ).toMatchObject({ stdout: "403", stderr: "", exitCode: 22 });
    expect(await shell.fs.readFile("/jar")).toBe(jar);
  });
  it("does not silently treat raw Set-Cookie as a jar", async () => {
    const shell = new Bash({
      fetch: async () => ({ ...response, cookieJar: undefined }),
    });
    expect(await shell.exec(`curl -c /jar ${url}`)).toMatchObject({
      stdout: "",
      stderr:
        "curl: (1) Cookie jar export is not supported by this transport\n",
      exitCode: 1,
    });
    expect(await shell.fs.exists("/jar")).toBe(false);
  });
  it("built-in transport rejects jar export before any network request", async () => {
    const fetch = createSecureFetch({ allowedUrlPrefixes: [url] });
    await expect(fetch(url, { wantCookieJar: true })).rejects.toThrow(
      "Cookie jar export is not supported",
    );
  });
  it("jar write failures are visible", async () => {
    const fs = new InMemoryFs();
    await fs.mkdir("/directory");
    vi.spyOn(fs, "writeFile").mockRejectedValue(
      new Error("EACCES: Permission denied"),
    );
    const shell = new Bash({ fs, fetch: async () => response });
    const result = await shell.exec(`curl -c /directory ${url}`);
    expect(result.exitCode).toBe(23);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^curl: \(\d+\).*\n$/);
  });
  it.each([
    "-c",
    "--cookie-jar=",
    "-c ''",
  ])("rejects missing jar destination %s", async (arg) => {
    const fetch = vi.fn(async () => response);
    const shell = new Bash({ fetch });
    expect(await shell.exec(`curl ${url} ${arg}`)).toMatchObject({
      stdout: "",
      stderr: "curl: option --cookie-jar: requires a non-empty parameter\n",
      exitCode: 2,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    "-o /combined",
    "-D /combined -o /dev/null",
  ])("finalizes the cookie jar after a colliding output: %s", async (flags) => {
    const shell = new Bash({ fetch: async () => response });
    const result = await shell.exec(`curl -s -c /combined ${flags} ${url}`);
    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await shell.fs.readFile("/combined")).toBe(jar);
  });
  it("finalizes a colliding header/jar file after an HTTP -f failure", async () => {
    const shell = new Bash({
      fetch: async () => ({ ...response, status: 403 }),
    });
    const result = await shell.exec(
      `curl -sf -c /combined -D /combined ${url}`,
    );
    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 22 });
    expect(await shell.fs.readFile("/combined")).toBe(jar);
  });
  it.each([
    "-o /denied",
    "-D /denied",
  ])("exports an available jar but preserves ordinary output failure: %s", async (flags) => {
    const fs = new InMemoryFs();
    const write = fs.writeFile.bind(fs);
    let deniedWrites = 0;
    vi.spyOn(fs, "writeFile").mockImplementation(
      async (path, content, options) => {
        // Header files are first truncated before dispatch. Fail their final
        // header write instead so this exercise has an available response jar.
        if (path === "/denied" && content !== "") {
          deniedWrites++;
          throw new Error("EACCES: output denied");
        }
        return write(path, content, options);
      },
    );
    const shell = new Bash({ fs, fetch: async () => response });
    const result = await shell.exec(`curl -sS -c /jar ${flags} ${url}`);
    expect(result).toMatchObject({
      stdout: "",
      stderr: "curl: (23) EACCES: output denied\n",
      exitCode: 23,
    });
    expect(await fs.readFile("/jar")).toBe(jar);
    expect(deniedWrites).toBe(1);
  });
  it("does not retry an uncertain jar write or hide a second write failure", async () => {
    const fs = new InMemoryFs();
    const writes: string[] = [];
    vi.spyOn(fs, "writeFile").mockImplementation(async (path) => {
      writes.push(path);
      throw new Error(`EACCES: ${path}`);
    });
    const result = await new Bash({ fs, fetch: async () => response }).exec(
      `curl -sS -c /jar -o /body ${url}`,
    );
    expect(result).toMatchObject({
      stdout: "",
      stderr: "curl: (23) EACCES: /body; cookie jar: EACCES: /jar\n",
      exitCode: 23,
    });
    expect(writes).toEqual(["/body", "/jar"]);
  });
  it("does not finalize a jar after Stop during an output write", async () => {
    const fs = new InMemoryFs();
    const controller = new AbortController();
    const writes: string[] = [];
    vi.spyOn(fs, "writeFile").mockImplementation(async (path) => {
      writes.push(path);
      controller.abort();
      throw new Error("output interrupted");
    });
    const result = await new Bash({ fs, fetch: async () => response }).exec(
      `curl -c /jar -o /body ${url}`,
      { signal: controller.signal },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(writes).toEqual(["/body"]);
    expect(await fs.exists("/jar")).toBe(false);
  });
});
