import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../../Bash.js";
import { parseOptions } from "../parse.js";

const url = "https://api.example.com/data";
const response = (status = 200) => ({
  status,
  statusText: "OK",
  headers: {},
  body: new TextEncoder().encode("body"),
  url,
});

describe("curl N7 transfer controls", () => {
  it("retries only when explicitly requested and reports final metrics once", async () => {
    const fetch = vi.fn(async () => response(500));
    const shell = new Bash({ fetch });
    expect(
      await shell.exec(
        `curl -s --retry 2 -o /body -w '%{http_code} %{size_download} %{url_effective}' ${url}`,
      ),
    ).toMatchObject({ stdout: `500 4 ${url}`, stderr: "", exitCode: 0 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(await shell.fs.readFile("/body")).toBe("body");
  });
  it.each([
    400, 401, 403, 404, 501, 505,
  ])("does not retry HTTP %i", async (status) => {
    const fetch = vi.fn(async () => response(status));
    const shell = new Bash({ fetch });
    expect(await shell.exec(`curl -sf --retry 2 ${url}`)).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 22,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps host policy and resource rejection out of the retry loop", async () => {
    const fetch = vi.fn(async () => {
      throw new Error(
        "Network access denied: https://example.com/aborted/timeout",
      );
    });
    const shell = new Bash({ fetch });
    expect(await shell.exec(`curl -s --retry 2 ${url}`)).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 7,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retries a transport failure and recognizes serialized host timeout", async () => {
    let calls = 0;
    const shell = new Bash({
      fetch: async () => {
        if (++calls === 1) throw new TypeError("Failed to fetch");
        return response();
      },
    });
    expect(await shell.exec(`curl -s --retry 1 ${url}`)).toMatchObject({
      stdout: "body",
      stderr: "",
      exitCode: 0,
    });
    expect(calls).toBe(2);
    const timeout = new Bash({
      fetch: async () => {
        throw new Error("signal timed out");
      },
    });
    expect(await timeout.exec(`curl -s ${url}`)).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 28,
    });
  });
  it("Stop interrupts retry delay without dispatching again", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
      setTimeout(() => controller.abort(), 10);
      return response(503);
    });
    const shell = new Bash({ fetch });
    const result = await shell.exec(`curl -s --retry 10 ${url}; echo BAD`, {
      signal: controller.signal,
    });
    expect(result.stdout).not.toContain("BAD");
    expect(result.exitCode).not.toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds attempts with the existing execution budget", async () => {
    const fetch = vi.fn(async () => response(503));
    const shell = new Bash({
      fetch,
      executionLimitProfile: "hardened",
      executionLimits: { maxLoopIterations: 2 },
    });
    const result = await shell.exec(`curl --retry 3 ${url} || true; echo BAD`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("BAD");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("formats actual elapsed transfer time once on verbose/file output", async () => {
    const shell = new Bash({
      defenseInDepth: false,
      fetch: async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return response();
      },
    });
    const result = await shell.exec(
      `curl -v -o /body -w 'TIME:%{time_total}' ${url}`,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.match(/TIME:/g)).toHaveLength(1);
    const match = /TIME:(\d+\.\d{6})$/.exec(result.stdout);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(0.01);
  });
  it.each([
    "--retry=-1",
    "--retry=1.5",
    "--retry=Infinity",
    "-m bad",
    "-m -1",
    "--max-time=Infinity",
    "--connect-timeout=1oops",
  ])("rejects invalid %s", (option) => {
    expect(parseOptions(option.split(" "))).toMatchObject({
      stdout: "",
      exitCode: 2,
    });
  });
  it("keeps max-time and connection bounds independent of option order", () => {
    expect(parseOptions(["-m2", "--connect-timeout", "1"])).toMatchObject({
      timeoutMs: 2000,
      connectTimeoutMs: 1000,
    });
    expect(parseOptions(["--connect-timeout=1", "--max-time=2"])).toMatchObject(
      { timeoutMs: 2000, connectTimeoutMs: 1000 },
    );
  });
});
