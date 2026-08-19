import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { assertExecResultSafe } from "../fuzzing/oracles/assertions.js";

// js-exec worker requires stripTypeScriptTypes (Node >= 22.6).
const nodeMajor = Number(process.versions.node.split(".")[0]);

describe.skipIf(nodeMajor < 22)("js-exec host runtime breakout probes", () => {
  it("keeps Function-constructor blocked on host-bridged function objects", async () => {
    const env = new Bash({ javascript: true });

    const result = await env.exec(`js-exec -c "
const cp = require('child_process');
const checks = [
  ['console.log', console.log],
  ['process.exit', process.exit],
  ['fs.readFileSync', fs.readFileSync],
  ['child_process.execSync', cp.execSync],
];
for (const [name, fn] of checks) {
  try {
    fn.constructor('return 1337')();
    console.log(name + ':ALLOWED');
  } catch (e) {
    console.log(name + ':' + String(e && e.message ? e.message : e));
  }
}
"`);

    expect(result.stdout).toBe(
      [
        "console.log:Function constructor is not allowed",
        "process.exit:Function constructor is not allowed",
        "fs.readFileSync:Function constructor is not allowed",
        "child_process.execSync:Function constructor is not allowed",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("blocks nested js-exec when invoked through Symbol.for('jb:exec') bridge", async () => {
    const env = new Bash({
      javascript: true,
      files: {
        "/tmp/symbol-nested.js": `
require('fs').writeFileSync('/tmp/jb_symbol_bridge_marker','1')
`,
      },
    });

    const result = await env.exec(`js-exec -c "
const marker = '/tmp/jb_symbol_bridge_marker';
fs.rmSync(marker, { force: true });
const execBridge = globalThis[Symbol.for('jb:exec')];
const r = execBridge('js-exec /tmp/symbol-nested.js');
console.log('SYMBOL_EXIT=' + String(r.exitCode));
console.log('SYMBOL_ERR=' + String(r.stderr).trim());
console.log('SYMBOL_MARKER=' + String(fs.existsSync(marker)));
"`);

    expect(result.stdout).toBe(
      [
        "SYMBOL_EXIT=1",
        "SYMBOL_ERR=js-exec: recursive invocation is not supported",
        "SYMBOL_MARKER=false",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    assertExecResultSafe(result);
  });

  it("does not allow child_process.spawnSync('node', ...) to execute host Node.js", async () => {
    const env = new Bash({ javascript: true });

    const result = await env.exec(`js-exec -c "
const cp = require('child_process');
const marker = '/tmp/jb_host_node_exec_marker';
fs.rmSync(marker, { force: true });
const r = cp.spawnSync('node', [
  '-e',
  \\"require('fs').writeFileSync('/tmp/jb_host_node_exec_marker','1')\\",
]);
const err = String(r.stderr);
console.log('NODE_STATUS=' + String(r.status));
console.log('NODE_BLOCKED=' + String(err.includes('this sandbox uses js-exec instead of node')));
console.log('NODE_MARKER=' + String(fs.existsSync(marker)));
"`);

    expect(result.stdout).toBe(
      ["NODE_STATUS=1", "NODE_BLOCKED=true", "NODE_MARKER=false", ""].join(
        "\n",
      ),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    assertExecResultSafe(result);
  });

  it("does not allow path-qualified or wrapper-based host runtime execution from js-exec", async () => {
    const env = new Bash({ javascript: true });

    const result = await env.exec(`js-exec -c "
const cp = require('child_process');
const marker = '/tmp/jb_host_node_exec_marker_paths';
fs.rmSync(marker, { force: true });
const probes = [
  ['plain-node', 'node', ['-e', \\"require('fs').writeFileSync('/tmp/jb_host_node_exec_marker_paths','1')\\"]],
  ['usr-bin-node', '/usr/bin/node', ['-e', \\"require('fs').writeFileSync('/tmp/jb_host_node_exec_marker_paths','1')\\"]],
  ['bin-node', '/bin/node', ['-e', \\"require('fs').writeFileSync('/tmp/jb_host_node_exec_marker_paths','1')\\"]],
  ['env-node', 'env', ['node', '-e', \\"require('fs').writeFileSync('/tmp/jb_host_node_exec_marker_paths','1')\\"]],
  ['usr-bin-env-node', '/usr/bin/env', ['node', '-e', \\"require('fs').writeFileSync('/tmp/jb_host_node_exec_marker_paths','1')\\"]],
  ['bash-c-usr-bin-node', 'bash', ['-c', \\"/usr/bin/node -e \\\\\\"require('fs').writeFileSync('/tmp/jb_host_node_exec_marker_paths','1')\\\\\\"\\"]],
  ['nodejs-alias', 'nodejs', ['-e', \\"require('fs').writeFileSync('/tmp/jb_host_node_exec_marker_paths','1')\\"]],
  ['deno-alias', 'deno', ['eval', \\"Deno.writeTextFileSync('/tmp/jb_host_node_exec_marker_paths','1')\\"]],
  ['bun-alias', 'bun', ['-e', \\"require('fs').writeFileSync('/tmp/jb_host_node_exec_marker_paths','1')\\"]],
];
for (const [name, cmd, args] of probes) {
  let r;
  try {
    r = cp.spawnSync(cmd, args);
  } catch {
    console.log(name + ':safe=true');
    continue;
  }
  const err = String(r.stderr || '');
  const unavailable = r.status === 127 || err.includes('command not found');
  const blocked = err.includes('this sandbox uses js-exec instead of node');
  console.log(name + ':safe=' + String(unavailable || blocked));
}
console.log('MARKER=' + String(fs.existsSync(marker)));
"`);

    expect(result.stdout).toBe(
      [
        "plain-node:safe=true",
        "usr-bin-node:safe=true",
        "bin-node:safe=true",
        "env-node:safe=true",
        "usr-bin-env-node:safe=true",
        "bash-c-usr-bin-node:safe=true",
        "nodejs-alias:safe=true",
        "deno-alias:safe=true",
        "bun-alias:safe=true",
        "MARKER=false",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    assertExecResultSafe(result);
  });
});
