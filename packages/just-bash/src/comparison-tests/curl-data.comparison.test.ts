import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

const execFileAsync = promisify(execFile);

describe("curl data options - real curl comparison", () => {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const address = server.address() as AddressInfo;
      const url = new URL(
        request.url ?? "/",
        `http://127.0.0.1:${address.port}`,
      );
      const body = Buffer.concat(chunks).toString("utf8");
      const summary = {
        method: request.method,
        path: url.pathname,
        query: [...url.searchParams.entries()],
        body: body ? [...new URLSearchParams(body).entries()] : [],
        contentType: request.headers["content-type"] ?? null,
      };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(summary));
    });
  });

  let baseUrl: string;
  let realCurlCwd: string;

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    realCurlCwd = await mkdtemp(join(tmpdir(), "just-bash-curl-"));
    await writeFile(join(realCurlCwd, "payload.txt"), "a=1\n");
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(realCurlCwd, { recursive: true, force: true });
  });

  async function runRealCurl(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("curl", ["-sS", ...args], {
      cwd: realCurlCwd,
      encoding: "utf8",
    });
    return stdout;
  }

  function createEnv(files?: Record<string, string>): Bash {
    return new Bash({
      files,
      network: {
        allowedUrlPrefixes: [baseUrl],
        allowedMethods: ["GET", "POST"],
        denyPrivateRanges: false,
      },
    });
  }

  it("matches -G query aggregation", async () => {
    const real = await runRealCurl([
      "-G",
      `${baseUrl}/echo?fixed=1`,
      "--data-urlencode",
      "query=a b*",
      "-d",
      "raw=1",
    ]);
    const result = await createEnv().exec(
      `curl -sS -G '${baseUrl}/echo?fixed=1' --data-urlencode 'query=a b*' -d 'raw=1'`,
    );

    expect(result).toMatchObject({ stdout: real, stderr: "", exitCode: 0 });
  });

  it("matches ordered inline and file-backed POST data", async () => {
    const real = await runRealCurl([
      "-d",
      "@payload.txt",
      "--data-urlencode",
      "q=a b*",
      "--data-raw",
      "c=3",
      `${baseUrl}/echo`,
    ]);
    const result = await createEnv({ "/payload.txt": "a=1\n" }).exec(
      `curl -sS -d @/payload.txt --data-urlencode 'q=a b*' --data-raw 'c=3' '${baseUrl}/echo'`,
    );

    expect(result).toMatchObject({ stdout: real, stderr: "", exitCode: 0 });
  });

  it("matches -G combined with an explicit request method", async () => {
    const real = await runRealCurl([
      "-X",
      "POST",
      "-G",
      "--data-urlencode",
      "q=1",
      `${baseUrl}/echo`,
    ]);
    const result = await createEnv().exec(
      `curl -sS -X POST -G --data-urlencode 'q=1' '${baseUrl}/echo'`,
    );

    expect(result).toMatchObject({ stdout: real, stderr: "", exitCode: 0 });
  });
});
