/**
 * Virtual Filesystem Example
 *
 * Demonstrates how to create synthetic filesystems whose content is
 * generated at runtime by async hooks — the shell never knows the
 * content is virtual.
 * Run with: npx tsx main.ts
 */

import { Bash, MountableFs, VirtualFs } from "just-bash";
import { metricsApiSource, reportDbSource } from "./sources.js";

const bash = new Bash({
  fs: new MountableFs({
    mounts: [
      {
        mountPoint: "/reports",
        filesystem: new VirtualFs(
          reportDbSource({ userId: "alice" }),
        ),
      },
      {
        mountPoint: "/metrics",
        filesystem: new VirtualFs(
          metricsApiSource({ cluster: "production" }),
        ),
      },
    ],
  }),
});

async function run(cmd: string) {
  const result = await bash.exec(cmd);
  console.log(`$ ${cmd}`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.log();
  return result;
}

// ── demos ──────────────────────────────────────────────────

async function demoReports() {
  console.log("=== 1. List sprint reports ===\n");
  await run("ls /reports");

  console.log("=== 2. Read a single report ===\n");
  await run("cat /reports/sprint-24");

  console.log("=== 3. Search for errors across all reports ===\n");
  await run("grep ERROR /reports/sprint-23 /reports/sprint-24 /reports/sprint-25");

  console.log("=== 4. Count lines per report ===\n");
  await run("wc -l /reports/sprint-23 /reports/sprint-24 /reports/sprint-25");
}

async function demoMetrics() {
  console.log("=== 5. Browse the metrics tree ===\n");
  await run("ls /metrics");
  await run("ls /metrics/cpu");

  console.log("=== 6. Read cluster status ===\n");
  await run("cat /metrics/status.json");

  console.log("=== 7. Read individual node metrics ===\n");
  await run("cat /metrics/cpu/node-2.txt");
  await run("cat /metrics/memory/node-2.txt");

  console.log("=== 8. Find critical nodes ===\n");
  await run("grep critical /metrics/cpu/node-1.txt /metrics/cpu/node-2.txt /metrics/cpu/node-3.txt");
}

async function demoPipelines() {
  console.log("=== 9. Pipeline: extract latency values ===\n");
  await run("cat /reports/sprint-23 /reports/sprint-24 /reports/sprint-25 | grep latency");

  console.log("=== 10. Pipeline: count warnings across all reports ===\n");
  await run("cat /reports/sprint-23 /reports/sprint-24 /reports/sprint-25 | grep WARN | wc -l");
}

async function demoWriteHooks() {
  console.log("=== 11. Write a new report (writeFile hook) ===\n");
  await run("echo '# Sprint 26 — New Features' > /reports/sprint-26");
  await run("ls /reports");
  await run("cat /reports/sprint-26");

  console.log("=== 12. Append to an existing report (appendFile hook) ===\n");
  await run("echo '- P95 latency: 80ms' >> /reports/sprint-26");
  await run("cat /reports/sprint-26");

  console.log("=== 13. Delete a report (rm hook) ===\n");
  await run("rm /reports/sprint-26");
  await run("ls /reports");

  console.log("=== 14. Write to metrics fails (no write hooks) ===\n");
  const result = await bash.exec("echo test > /metrics/cpu/fake.txt").catch((e) => e);
  console.log(`$ echo test > /metrics/cpu/fake.txt`);
  console.log(`→ ${result instanceof Error ? result.message : "unexpected success"}\n`);
}

async function main() {
  await demoReports();
  await demoMetrics();
  await demoPipelines();
  await demoWriteHooks();
}

main().catch(console.error);
