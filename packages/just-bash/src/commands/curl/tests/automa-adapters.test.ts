// Automa modifications: N00b regressions from curl inline and shell-flags adapters.
import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../../Bash.js";
import type { SecureFetch } from "../../../network/types.js";
import { generateMultipartBody, parseFormField } from "../form.js";

const bytes = new Uint8Array([0, 255, 128, 120, 10]);
const response = {
  status: 200,
  statusText: "OK",
  headers: { "content-type": "text/plain" },
  url: "https://example.test/data",
  body: new TextEncoder().encode("body\n"),
};

describe("Automa curl adapters", () => {
  it("preserves multipart file bytes and attribute ordering", () => {
    const field = parseFormField(
      "blob=@raw;type=application/octet-stream;filename=custom.bin",
    );
    expect(field).toEqual({
      name: "blob",
      value: "@raw",
      filename: "custom.bin",
      contentType: "application/octet-stream",
    });
    if (!field) throw new Error("expected parsed field");
    const { body, boundary } = generateMultipartBody(
      [field],
      new Map([["raw", bytes]]),
    );
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="blob"; filename="custom.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    expect(body.slice(0, head.length)).toEqual(head);
    expect(body.slice(head.length, head.length + bytes.length)).toEqual(bytes);
    expect(
      new TextDecoder().decode(body.slice(head.length + bytes.length)),
    ).toBe(`\r\n--${boundary}--\r\n`);
  });
  it("uses bytes for uploads and never dispatches a missing multipart file", async () => {
    const fetch = vi.fn<SecureFetch>(async () => response);
    const shell = new Bash({ cwd: "/", files: { "/raw": bytes }, fetch });
    expect(
      await shell.exec("curl -T raw https://example.test/data"),
    ).toMatchObject({ stdout: "body\n", stderr: "", exitCode: 0 });
    expect(fetch.mock.calls[0]?.[1]?.body).toEqual(bytes);
    fetch.mockClear();
    const result = await shell.exec(
      "curl -F blob=@missing https://example.test/data",
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("makes redirects opt-in and treats -o - as stdout", async () => {
    const fetch = vi.fn<SecureFetch>(async () => response);
    const shell = new Bash({ fetch });
    expect(
      await shell.exec("curl -o - https://example.test/data"),
    ).toMatchObject({ stdout: "body\n", stderr: "", exitCode: 0 });
    expect(fetch.mock.calls[0]?.[1]?.followRedirects).toBe(false);
    await shell.exec("curl -L https://example.test/data");
    expect(fetch.mock.calls[1]?.[1]?.followRedirects).toBe(true);
  });
  it("retains dumped stdout headers if writing the body fails", async () => {
    const fetch = vi.fn<SecureFetch>(async () => response);
    const shell = new Bash({ fetch });
    shell.fs.writeFile = async () => {
      throw new Error("EACCES: denied");
    };
    const result = await shell.exec(
      "curl -D - -o output https://example.test/data",
    );
    expect(result.stdout).toBe(
      "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n\r\n",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
