// Local HTTP fixture compares stable fields with real curl; timings stay measured.
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Bash } from "../../../Bash.js";

const exec = promisify(execFile);
const counts = new Map<string, number>();
const server = createServer((req, res) => {
  const path = req.url ?? "/";
  counts.set(path, (counts.get(path) ?? 0) + 1);
  if (path.endsWith("/slow")) {
    const timer = setTimeout(() => res.end("late"), 100);
    res.on("close", () => clearTimeout(timer));
  } else if (path.endsWith("/redirect")) {
    res.writeHead(302, { Location: "/final" });
    res.end();
  } else {
    res.writeHead(path.endsWith("/500") ? 500 : 200, {
      "Content-Type": "text/plain",
    });
    res.end("body");
  }
});
let base = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("HTTP fixture unavailable");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function native(args: string[]) {
  try {
    const result = await exec("curl", args);
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const result = error as { stdout: string; stderr: string; code: number };
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
    };
  }
}
function shell() {
  return new Bash({
    defenseInDepth: false,
    network: { allowedUrlPrefixes: [base] },
  });
}
describe("curl native transfer differential", () => {
  it("retries 500 twice and emits the final status with the same request count", async () => {
    const [reference, candidate] = await Promise.all([
      native([
        "-s",
        "--retry",
        "2",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        `${base}/native/500`,
      ]),
      shell().exec(
        `curl -s --retry 2 -o /body -w '%{http_code}' ${base}/candidate/500`,
      ),
    ]);
    expect(candidate).toMatchObject(reference);
    expect(reference).toEqual({ stdout: "500", stderr: "", exitCode: 0 });
    expect(counts.get("/native/500")).toBe(3);
    expect(counts.get("/candidate/500")).toBe(3);
  }, 10000);
  it("max-time aborts the live slow response with exit 28", async () => {
    const [reference, candidate] = await Promise.all([
      native(["-s", "-m", "0.02", `${base}/native/slow`]),
      shell().exec(`curl -s -m 0.02 ${base}/candidate/slow`),
    ]);
    expect(candidate).toMatchObject(reference);
    expect(reference).toEqual({ stdout: "", stderr: "", exitCode: 28 });
  });
  it("redirects remain opt-in and final URL/body metrics match curl", async () => {
    const args = [
      "-sL",
      "-w",
      "|%{http_code}|%{size_download}|%{url_effective}",
      `${base}/redirect`,
    ];
    const reference = await native(args);
    const candidate = await shell().exec(
      `curl -sL -w '|%{http_code}|%{size_download}|%{url_effective}' ${base}/redirect`,
    );
    expect(candidate).toMatchObject(reference);
    expect(reference.stdout).toBe(`body|200|4|${base}/final`);
    expect(
      await shell().exec(`curl -s -w '%{http_code}' ${base}/redirect`),
    ).toMatchObject({ stdout: "302", stderr: "", exitCode: 0 });
  });
});
