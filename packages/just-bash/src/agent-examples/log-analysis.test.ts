import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Log Analysis Scenario
 * An AI agent analyzing application logs to identify errors, patterns, and issues.
 */
describe("Agent Scenario: Log Analysis", () => {
  const createEnv = () =>
    new Bash({
      files: {
        "/logs/app.log": `2024-01-15 10:00:00 INFO  Application starting
2024-01-15 10:00:01 INFO  Database connected
2024-01-15 10:05:23 INFO  GET /api/users 200
2024-01-15 10:10:00 ERROR Connection timeout
2024-01-15 10:10:01 WARN  Retrying connection
2024-01-15 10:10:02 INFO  Database reconnected
2024-01-15 10:20:45 ERROR Auth failed user@example.com
2024-01-15 10:30:15 ERROR NullPointerException
`,
        "/logs/access.log": `192.168.1.50 GET /api/users 200
192.168.1.100 POST /api/login 401
192.168.1.100 POST /api/login 401
192.168.1.50 POST /api/orders 500
`,
      },
      cwd: "/logs",
    });

  it("should list available log files", async () => {
    const env = createEnv();
    const result = await env.exec("ls /logs");
    expect(result.stdout).toBe("access.log\napp.log\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find all ERROR entries in app log", async () => {
    const env = createEnv();
    const result = await env.exec("grep ERROR /logs/app.log");
    expect(result.stdout).toBe(`2024-01-15 10:10:00 ERROR Connection timeout
2024-01-15 10:20:45 ERROR Auth failed user@example.com
2024-01-15 10:30:15 ERROR NullPointerException
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find all WARN entries in app log", async () => {
    const env = createEnv();
    const result = await env.exec("grep WARN /logs/app.log");
    expect(result.stdout).toBe(
      "2024-01-15 10:10:01 WARN  Retrying connection\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should count errors", async () => {
    const env = createEnv();
    const result = await env.exec("grep -c ERROR /logs/app.log");
    expect(result.stdout).toBe("3\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find HTTP 500 errors in access log", async () => {
    const env = createEnv();
    const result = await env.exec("grep 500 /logs/access.log");
    expect(result.stdout).toBe("192.168.1.50 POST /api/orders 500\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should count failed login attempts (401)", async () => {
    const env = createEnv();
    const result = await env.exec("grep -c 401 /logs/access.log");
    expect(result.stdout).toBe("2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find requests from specific IP", async () => {
    const env = createEnv();
    const result = await env.exec('grep "192.168.1.100" /logs/access.log');
    expect(result.stdout).toBe(`192.168.1.100 POST /api/login 401
192.168.1.100 POST /api/login 401
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should get first few lines to check log format", async () => {
    const env = createEnv();
    const result = await env.exec("head -3 /logs/app.log");
    expect(result.stdout).toBe(`2024-01-15 10:00:00 INFO  Application starting
2024-01-15 10:00:01 INFO  Database connected
2024-01-15 10:05:23 INFO  GET /api/users 200
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should get recent log entries", async () => {
    const env = createEnv();
    const result = await env.exec("tail -2 /logs/app.log");
    expect(
      result.stdout,
    ).toBe(`2024-01-15 10:20:45 ERROR Auth failed user@example.com
2024-01-15 10:30:15 ERROR NullPointerException
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should count total log lines", async () => {
    const env = createEnv();
    const result = await env.exec("wc -l /logs/app.log");
    expect(result.stdout).toBe("8 /logs/app.log\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find errors using pipe", async () => {
    const env = createEnv();
    const result = await env.exec("cat /logs/app.log | grep ERROR");
    expect(result.stdout).toBe(`2024-01-15 10:10:00 ERROR Connection timeout
2024-01-15 10:20:45 ERROR Auth failed user@example.com
2024-01-15 10:30:15 ERROR NullPointerException
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find specific timestamp range", async () => {
    const env = createEnv();
    const result = await env.exec('grep "10:10" /logs/app.log');
    expect(result.stdout).toBe(`2024-01-15 10:10:00 ERROR Connection timeout
2024-01-15 10:10:01 WARN  Retrying connection
2024-01-15 10:10:02 INFO  Database reconnected
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should search case-insensitively for errors", async () => {
    const env = createEnv();
    const result = await env.exec("grep -i error /logs/app.log");
    expect(result.stdout).toBe(`2024-01-15 10:10:00 ERROR Connection timeout
2024-01-15 10:20:45 ERROR Auth failed user@example.com
2024-01-15 10:30:15 ERROR NullPointerException
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should show line numbers for errors", async () => {
    const env = createEnv();
    const result = await env.exec("grep -n ERROR /logs/app.log");
    expect(result.stdout).toBe(`4:2024-01-15 10:10:00 ERROR Connection timeout
7:2024-01-15 10:20:45 ERROR Auth failed user@example.com
8:2024-01-15 10:30:15 ERROR NullPointerException
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  // awk-based log analysis tests
  it("should extract timestamps using awk", async () => {
    const env = createEnv();
    const result = await env.exec("awk '{print $1, $2}' /logs/app.log");
    expect(result.stdout).toBe(`2024-01-15 10:00:00
2024-01-15 10:00:01
2024-01-15 10:05:23
2024-01-15 10:10:00
2024-01-15 10:10:01
2024-01-15 10:10:02
2024-01-15 10:20:45
2024-01-15 10:30:15
`);
    expect(result.exitCode).toBe(0);
  });

  it("should extract IP addresses from access log", async () => {
    const env = createEnv();
    const result = await env.exec("awk '{print $1}' /logs/access.log");
    expect(result.stdout).toBe(`192.168.1.50
192.168.1.100
192.168.1.100
192.168.1.50
`);
    expect(result.exitCode).toBe(0);
  });

  it("should extract HTTP status codes from access log", async () => {
    const env = createEnv();
    const result = await env.exec("awk '{print $4}' /logs/access.log");
    expect(result.stdout).toBe(`200
401
401
500
`);
    expect(result.exitCode).toBe(0);
  });

  it("should filter ERROR lines with awk pattern", async () => {
    const env = createEnv();
    const result = await env.exec("awk '/ERROR/' /logs/app.log");
    expect(result.stdout).toBe(`2024-01-15 10:10:00 ERROR Connection timeout
2024-01-15 10:20:45 ERROR Auth failed user@example.com
2024-01-15 10:30:15 ERROR NullPointerException
`);
    expect(result.exitCode).toBe(0);
  });

  it("should extract log level using awk", async () => {
    const env = createEnv();
    const result = await env.exec("awk '{print $3}' /logs/app.log");
    expect(result.stdout).toBe(`INFO
INFO
INFO
ERROR
WARN
INFO
ERROR
ERROR
`);
    expect(result.exitCode).toBe(0);
  });

  it("should print line numbers with awk NR", async () => {
    const env = createEnv();
    const result = await env.exec("awk '{print NR, $0}' /logs/access.log");
    expect(result.stdout).toBe(`1 192.168.1.50 GET /api/users 200
2 192.168.1.100 POST /api/login 401
3 192.168.1.100 POST /api/login 401
4 192.168.1.50 POST /api/orders 500
`);
    expect(result.exitCode).toBe(0);
  });

  it("should filter by line number with awk NR condition", async () => {
    const env = createEnv();
    const result = await env.exec("awk 'NR==2' /logs/access.log");
    expect(result.stdout).toBe("192.168.1.100 POST /api/login 401\n");
    expect(result.exitCode).toBe(0);
  });

  it("should extract request paths from access log", async () => {
    const env = createEnv();
    const result = await env.exec("awk '{print $3}' /logs/access.log");
    expect(result.stdout).toBe(`/api/users
/api/login
/api/login
/api/orders
`);
    expect(result.exitCode).toBe(0);
  });

  it("should use awk with pipe to filter and extract", async () => {
    const env = createEnv();
    const result = await env.exec(
      "grep ERROR /logs/app.log | awk '{print $2}'",
    );
    expect(result.stdout).toBe(`10:10:00
10:20:45
10:30:15
`);
    expect(result.exitCode).toBe(0);
  });

  it("should count fields with awk NF", async () => {
    const env = createEnv();
    const result = await env.exec("awk '{print NF}' /logs/access.log");
    expect(result.stdout).toBe(`4
4
4
4
`);
    expect(result.exitCode).toBe(0);
  });
});
