import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const dataRoot = process.argv[2] ?? ".deepsec/data/just-bash";
const requestedBatch = process.argv[3];

async function jsonFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await jsonFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".json")) result.push(path);
  }
  return result;
}

const runFiles = await jsonFiles(join(dataRoot, "runs"));
const runs = [];
for (const path of runFiles) {
  const run = JSON.parse(await readFile(path, "utf8"));
  if (run.type === "revalidate") runs.push(run);
}
if (runs.length === 0) throw new Error("No revalidation runs found");

const latestMinute = runs
  .map((run) => run.createdAt.slice(0, 16))
  .sort()
  .at(-1);
const batchKey = requestedBatch ?? latestMinute;
const batch = runs.filter(
  (run) => run.runId.startsWith(batchKey) || run.createdAt.startsWith(batchKey),
);
if (batch.length === 0) {
  throw new Error(`No revalidation runs match ${batchKey}`);
}

const incompleteRuns = batch.filter(
  (run) => run.phase !== "done" || !run.completedAt,
);
const completedBatch = batch.filter(
  (run) => run.phase === "done" && run.completedAt,
);

const expected = {
  total: 0,
  fixed: 0,
  "true-positive": 0,
  "false-positive": 0,
  uncertain: 0,
  duplicate: 0,
};
const expectedByRun = new Map();
for (const run of completedBatch) {
  const counts = {
    total: run.stats.findingsRevalidated,
    fixed: run.stats.fixed,
    "true-positive": run.stats.truePositives,
    "false-positive": run.stats.falsePositives,
    uncertain: run.stats.uncertain,
    duplicate: run.stats.duplicates,
  };
  expectedByRun.set(run.runId, counts);
  for (const key of Object.keys(expected)) expected[key] += counts[key] ?? 0;
}

const runIds = new Set(completedBatch.map((run) => run.runId));
const actual = Object.fromEntries(Object.keys(expected).map((key) => [key, 0]));
const actualByRun = new Map(
  completedBatch.map((run) => [
    run.runId,
    Object.fromEntries(Object.keys(expected).map((key) => [key, 0])),
  ]),
);
const identities = new Set();
for (const path of await jsonFiles(join(dataRoot, "files"))) {
  const file = JSON.parse(await readFile(path, "utf8"));
  for (const finding of file.findings ?? []) {
    const revalidation = finding.revalidation;
    if (!revalidation || !runIds.has(revalidation.runId)) continue;
    const identity = `${file.filePath}\0${finding.vulnSlug}\0${finding.title}`;
    if (identities.has(identity)) {
      throw new Error(`Duplicate latest annotation: ${identity}`);
    }
    identities.add(identity);
    actual.total++;
    actual[revalidation.verdict] = (actual[revalidation.verdict] ?? 0) + 1;
    const runCounts = actualByRun.get(revalidation.runId);
    runCounts.total++;
    runCounts[revalidation.verdict] =
      (runCounts[revalidation.verdict] ?? 0) + 1;
  }
}

const mismatches = [];
for (const run of incompleteRuns) {
  mismatches.push(`${run.runId} phase: expected done, found ${run.phase}`);
}
for (const [runId, expectedCounts] of expectedByRun) {
  const actualCounts = actualByRun.get(runId);
  for (const key of Object.keys(expected)) {
    if (expectedCounts[key] !== actualCounts[key]) {
      mismatches.push(
        `${runId} ${key}: expected ${expectedCounts[key]}, retained ${actualCounts[key]}`,
      );
    }
  }
}
for (const key of Object.keys(expected)) {
  if (expected[key] !== actual[key]) {
    mismatches.push(
      `batch ${key}: expected ${expected[key]}, retained ${actual[key]}`,
    );
  }
}

const summary = `${completedBatch.length}/${batch.length} completed shards, ${expected.total} completed results (${expected.fixed} fixed, ${expected["true-positive"]} true-positive, ${expected["false-positive"]} false-positive)`;
if (mismatches.length > 0) {
  console.error(`DeepSec revalidation integrity FAILED: ${summary}`);
  for (const mismatch of mismatches) console.error(`- ${mismatch}`);
  process.exitCode = 1;
} else {
  console.log(`DeepSec revalidation integrity passed: ${summary}`);
}
