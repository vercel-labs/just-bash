import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { assertExecResultSafe } from "../fuzzing/oracles/assertions.js";

// js-exec worker requires stripTypeScriptTypes (Node >= 22.6).
const nodeMajor = Number(process.versions.node.split(".")[0]);

describe.skipIf(nodeMajor < 22)("js-exec recursion guard bypass probes", () => {
  it("blocks nested js-exec via child_process.execSync", async () => {
    const env = new Bash({ javascript: true });

    const result = await env.exec(`js-exec -c "
const cp = require('child_process');
try {
  cp.execSync('js-exec -c \\"console.log(123)\\"');
  console.log('DIRECT_ALLOWED');
} catch (e) {
  console.log('DIRECT_BLOCKED');
  console.log('DIRECT_ERR=' + String(e && e.stderr ? e.stderr : e));
}
"`);

    expect(result.stdout).toBe(
      [
        "DIRECT_BLOCKED",
        "DIRECT_ERR=js-exec: recursive invocation is not supported",
        "",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    assertExecResultSafe(result);
  });

  it("blocks nested js-exec through timeout wrapper", async () => {
    const env = new Bash({ javascript: true });

    const result = await env.exec(`js-exec -c "
const cp = require('child_process');
const marker = '/tmp/jb_nested_timeout_marker';
if (fs.existsSync(marker)) fs.rmSync(marker, { force: true });
const r = cp.spawnSync('timeout', [
  '1',
  'js-exec',
  '-c',
  \\"require('fs').writeFileSync('/tmp/jb_nested_timeout_marker','1')\\"
]);
console.log('TIMEOUT_STATUS=' + String(r.status));
console.log('TIMEOUT_STDERR=' + String(r.stderr));
console.log('TIMEOUT_MARKER=' + String(fs.existsSync(marker)));
"`);

    expect(result.stdout).toBe(
      [
        "TIMEOUT_STATUS=1",
        "TIMEOUT_STDERR=js-exec: recursive invocation is not supported",
        "",
        "TIMEOUT_MARKER=false",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    assertExecResultSafe(result);
  });

  it("blocks nested js-exec via spawnSync structured args", async () => {
    const env = new Bash({ javascript: true });

    const result = await env.exec(`js-exec -c "
const cp = require('child_process');
const marker = '/tmp/jb_nested_spawn_marker';
if (fs.existsSync(marker)) fs.rmSync(marker, { force: true });
const r = cp.spawnSync('js-exec', [
  '-c',
  \\"require('fs').writeFileSync('/tmp/jb_nested_spawn_marker','1')\\"
]);
console.log('SPAWN_STATUS=' + String(r.status));
console.log('SPAWN_STDERR=' + String(r.stderr));
console.log('SPAWN_MARKER=' + String(fs.existsSync(marker)));
"`);

    expect(result.stdout).toBe(
      [
        "SPAWN_STATUS=1",
        "SPAWN_STDERR=js-exec: recursive invocation is not supported",
        "",
        "SPAWN_MARKER=false",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    assertExecResultSafe(result);
  });

  it(
    "blocks nested js-exec when launched in background through bash -c",
    { timeout: 30000 },
    async () => {
      const env = new Bash({
        javascript: true,
        executionLimits: { maxJsTimeoutMs: 1500 },
        files: {
          "/tmp/nested-bg.js": `
require('fs').writeFileSync('/tmp/jb_nested_bg_marker','1')
`,
          "/tmp/probe-bg.js": `
const cp = require('child_process');
const marker = '/tmp/jb_nested_bg_marker';
fs.rmSync(marker, { force: true });
const nested = "js-exec /tmp/nested-bg.js & wait";
const r = cp.spawnSync('bash', ['-c', nested]);
console.log('BG_STATUS=' + String(r.status));
console.log('BG_STDERR=' + String(r.stderr));
console.log('BG_MARKER=' + String(fs.existsSync(marker)));
`,
        },
      });

      const started = Date.now();
      const result = await env.exec("js-exec /tmp/probe-bg.js");
      const elapsedMs = Date.now() - started;

      expect(result.stdout).toBe(
        [
          "BG_STATUS=0",
          "BG_STDERR=js-exec: recursive invocation is not supported",
          "",
          "BG_MARKER=false",
          "",
        ].join("\n"),
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(elapsedMs).toBeLessThan(5000);
      assertExecResultSafe(result);
    },
  );

  it(
    "blocks nested js-exec when backgrounded without wait",
    { timeout: 30000 },
    async () => {
      const env = new Bash({
        javascript: true,
        executionLimits: { maxJsTimeoutMs: 1500 },
        files: {
          "/tmp/nested-bg-nowait.js": `
require('fs').writeFileSync('/tmp/jb_nested_bg_nowait_marker','1')
`,
          "/tmp/probe-bg-nowait.js": `
const cp = require('child_process');
const marker = '/tmp/jb_nested_bg_nowait_marker';
const nestedOut = '/tmp/jb_nested_bg_nowait.out';
const nestedErr = '/tmp/jb_nested_bg_nowait.err';
fs.rmSync(marker, { force: true });
fs.rmSync(nestedOut, { force: true });
fs.rmSync(nestedErr, { force: true });
const nested = "js-exec /tmp/nested-bg-nowait.js > /tmp/jb_nested_bg_nowait.out 2> /tmp/jb_nested_bg_nowait.err &";
const r = cp.spawnSync('bash', ['-c', nested]);
cp.spawnSync('sleep', ['0.2']);
console.log('NOWAIT_STATUS=' + String(r.status));
console.log('NOWAIT_STDERR=' + String(r.stderr));
console.log('NOWAIT_MARKER=' + String(fs.existsSync(marker)));
console.log('NOWAIT_NOUT=' + String(fs.existsSync(nestedOut) ? fs.readFileSync(nestedOut, 'utf8').trim() : 'NOOUT'));
console.log('NOWAIT_NERR=' + String(fs.existsSync(nestedErr) ? fs.readFileSync(nestedErr, 'utf8').trim() : 'NOERR'));
`,
        },
      });

      const started = Date.now();
      const result = await env.exec("js-exec /tmp/probe-bg-nowait.js");
      const elapsedMs = Date.now() - started;

      expect(result.stdout).toBe(
        [
          "NOWAIT_STATUS=1",
          "NOWAIT_STDERR=",
          "NOWAIT_MARKER=false",
          "NOWAIT_NOUT=",
          "NOWAIT_NERR=js-exec: recursive invocation is not supported",
          "",
        ].join("\n"),
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(elapsedMs).toBeLessThan(5000);
      assertExecResultSafe(result);
    },
  );

  it(
    "blocks delayed nested js-exec launched from background subshell",
    { timeout: 30000 },
    async () => {
      const env = new Bash({
        javascript: true,
        executionLimits: { maxJsTimeoutMs: 2000 },
        files: {
          "/tmp/nested-bg-delayed.js": `
require('fs').writeFileSync('/tmp/jb_nested_bg_delayed_marker','1')
`,
          "/tmp/probe-bg-delayed.js": `
const cp = require('child_process');
const marker = '/tmp/jb_nested_bg_delayed_marker';
const nestedOut = '/tmp/jb_nested_bg_delayed.out';
const nestedErr = '/tmp/jb_nested_bg_delayed.err';
fs.rmSync(marker, { force: true });
fs.rmSync(nestedOut, { force: true });
fs.rmSync(nestedErr, { force: true });
const nested = "(sleep 0.2; js-exec /tmp/nested-bg-delayed.js > /tmp/jb_nested_bg_delayed.out 2> /tmp/jb_nested_bg_delayed.err) &";
const r = cp.spawnSync('bash', ['-c', nested]);
cp.spawnSync('sleep', ['0.6']);
console.log('DELAY_STATUS=' + String(r.status));
console.log('DELAY_STDERR=' + String(r.stderr));
console.log('DELAY_MARKER=' + String(fs.existsSync(marker)));
console.log('DELAY_NOUT=' + String(fs.existsSync(nestedOut) ? fs.readFileSync(nestedOut, 'utf8').trim() : 'NOOUT'));
console.log('DELAY_NERR=' + String(fs.existsSync(nestedErr) ? fs.readFileSync(nestedErr, 'utf8').trim() : 'NOERR'));
`,
        },
      });

      const started = Date.now();
      const result = await env.exec("js-exec /tmp/probe-bg-delayed.js");
      const elapsedMs = Date.now() - started;

      expect(result.stdout).toBe(
        [
          "DELAY_STATUS=1",
          "DELAY_STDERR=",
          "DELAY_MARKER=false",
          "DELAY_NOUT=",
          "DELAY_NERR=js-exec: recursive invocation is not supported",
          "",
        ].join("\n"),
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(elapsedMs).toBeLessThan(7000);
      assertExecResultSafe(result);
    },
  );

  it("blocks nested js-exec from Promise microtask bridge callback", async () => {
    const env = new Bash({ javascript: true });

    const result = await env.exec(`js-exec -c "
const marker = '/tmp/jb_nested_promise_marker';
fs.rmSync(marker, { force: true });
const execBridge = globalThis[Symbol.for('jb:exec')];
Promise.resolve().then(() => {
  const r = execBridge(\\"js-exec -c \\\\\\"require('fs').writeFileSync('/tmp/jb_nested_promise_marker','1')\\\\\\"\\");
  console.log('PROMISE_EXIT=' + String(r.exitCode));
  console.log('PROMISE_ERR=' + String(r.stderr).trim());
  console.log('PROMISE_MARKER=' + String(fs.existsSync(marker)));
});
"`);

    expect(result.stdout).toBe(
      [
        "PROMISE_EXIT=1",
        "PROMISE_ERR=js-exec: recursive invocation is not supported",
        "PROMISE_MARKER=false",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    assertExecResultSafe(result);
  });
});
