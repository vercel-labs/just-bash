// Automa N7: byte fidelity, last-attempt metrics and cumulative retry bounds.
import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../../Bash.js";
import { applyWriteOut } from "../response-formatting.js";

const url = "https://example.com/path";
const response = () => ({
  status: 200,
  statusText: "OK",
  headers: {},
  body: new TextEncoder().encode("body"),
  url,
});

describe("curl reviewed transfer boundaries", () => {
  it("encodes Unicode write-out text once next to raw body and cookie bytes", async () => {
    const jar = "# Netscape HTTP Cookie File\nsite\tFALSE\t/\tFALSE\t0\tn\té\n";
    const shell = new Bash({
      fetch: async () => ({ ...response(), cookieJar: jar }),
    });
    const result = await shell.exec(`curl -c - -w '完成\n' ${url} > /out`);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(await shell.fs.readFileBuffer("/out")).toEqual(
      new TextEncoder().encode(`body完成\n${jar}`),
    );
  });

  it("does not interpret response values as replacement or format syntax", () => {
    expect(
      applyWriteOut("%{content_type}|%{url_effective}\\n%{size_download}", {
        status: 200,
        headers: { "content-type": "%{url_effective}" },
        url: "https://example.com/$&/%{size_download}?x=\\n",
        bodyLength: 4,
      }),
    ).toBe("%{url_effective}|https://example.com/$&/%{size_download}?x=\\n\n4");
  });

  it("uses the attempted normalized GET query in failure write-out", async () => {
    const shell = new Bash({
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const result = await shell.exec(
      "curl -sG -d x=1 -w '失败:%{url_effective}|%{http_code}' example.com/path",
    );
    expect(result).toMatchObject({
      stdout: `失败:${url}?x=1|000`,
      stderr: "",
      exitCode: 7,
    });
  });

  it.each([
    "response",
    "request",
    "cookies",
  ])("charges %s bytes from discarded/repeated attempts to the same input budget", async (kind) => {
    const fetch = vi.fn(async () => ({
      ...response(),
      status: 503,
      body: new Uint8Array(kind === "response" ? 600 : 0),
      cookieJar: kind === "cookies" ? "x".repeat(600) : undefined,
    }));
    const shell = new Bash({
      fetch,
      executionLimitProfile: "hardened",
      executionLimits: { maxInputBytes: 1000 },
    });
    const data = kind === "request" ? `-d '${"x".repeat(600)}'` : "";
    const result = await shell.exec(
      `curl --retry 4 ${data} ${url} || true; echo BAD`,
    );
    expect(result.exitCode, result.stderr).not.toBe(0);
    expect(result.stdout).not.toContain("BAD");
    expect(result.executionFailure?.kind).toBe("resource-limit");
    expect(fetch).toHaveBeenCalledTimes(kind === "request" ? 1 : 2);
  });

  it.each([
    "Permission denied",
    "Network transfer exceeds 32 MiB",
    "Shell cookie export failed",
  ])("never retries host rejection %s", async (message) => {
    const fetch = vi.fn(async () => {
      throw new Error(message);
    });
    const shell = new Bash({ fetch });
    expect((await shell.exec(`curl --retry 5 ${url}`)).exitCode).not.toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "-X",
    "--request",
    "-H",
    "--header",
    "-d",
    "--data",
    "--data-raw",
    "--data-binary",
    "--data-urlencode",
    "-F",
    "--form",
    "-u",
    "--user",
    "-A",
    "--user-agent",
    "-e",
    "--referer",
    "-T",
    "--upload-file",
    "-o",
    "--output",
    "-w",
    "--write-out",
  ])("rejects missing %s argument before dispatch", async (option) => {
    const fetch = vi.fn(async () => response());
    const result = await new Bash({ fetch }).exec(`curl ${url} ${option}`);
    expect(result).toMatchObject({ stdout: "", exitCode: 2 });
    expect(result.stderr).toContain("requires parameter");
    expect(fetch).not.toHaveBeenCalled();
  });
});
