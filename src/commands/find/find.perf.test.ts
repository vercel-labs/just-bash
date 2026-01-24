import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { OverlayFs } from "../../fs/overlay-fs/index.js";
import type { TraceEvent } from "../../types.js";
import {
  evaluateExpressionWithPrune,
  evaluateSimpleExpression,
} from "./matcher.js";
import type { EvalContext, Expression } from "./types.js";

describe("find performance tracing", () => {
  it("should emit trace events for -path pattern with extension", async () => {
    // Create a filesystem with multiple levels and pulls directories
    const files: Record<string, string> = {};

    // Create a structure similar to the real use case
    for (let repo = 1; repo <= 10; repo++) {
      for (let pull = 1; pull <= 20; pull++) {
        files[`/repos/project${repo}/pulls/${pull}.json`] = "{}";
      }
      for (let issue = 1; issue <= 10; issue++) {
        files[`/repos/project${repo}/issues/${issue}.json`] = "{}";
      }
      files[`/repos/project${repo}/README.md`] = "# Project";
      files[`/repos/project${repo}/package.json`] = "{}";
      // Add some nested directories
      files[`/repos/project${repo}/src/index.ts`] = "";
      files[`/repos/project${repo}/src/utils/helpers.ts`] = "";
    }

    const events: TraceEvent[] = [];
    const env = new Bash({
      files,
      trace: (event) => events.push(event),
    });

    const result = await env.exec('find /repos -path "*/pulls/*.json" -type f');
    expect(result.exitCode).toBe(0);

    // Check we got 200 results (10 repos * 20 pulls)
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(200);

    // Analyze trace events
    const summary = events.find(
      (e) => e.category === "find" && e.name === "summary",
    );
    expect(summary).toBeDefined();
    console.log("\n--- Trace Summary for -path pattern ---");
    console.log(JSON.stringify(summary?.details, null, 2));

    // Verify we have timing data
    expect(summary?.details?.nodeCount).toBeGreaterThan(0);
    expect(summary?.details?.batchCount).toBeGreaterThan(0);
  });

  it("should emit trace events for -maxdepth with -name", async () => {
    // Create deeper structure
    const files: Record<string, string> = {};

    for (let repo = 1; repo <= 10; repo++) {
      files[`/repos/project${repo}/issues/1.json`] = "{}";
      files[`/repos/project${repo}/pulls/1.json`] = "{}";
      files[`/repos/project${repo}/src/deep/nested/file.ts`] = "";
    }

    const events: TraceEvent[] = [];
    const env = new Bash({
      files,
      trace: (event) => events.push(event),
    });

    const result = await env.exec(
      'find /repos -maxdepth 4 -type d -name "issues"',
    );
    expect(result.exitCode).toBe(0);

    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(10);

    // Analyze trace events
    const summary = events.find(
      (e) => e.category === "find" && e.name === "summary",
    );
    expect(summary).toBeDefined();
    console.log("\n--- Trace Summary for -maxdepth ---");
    console.log(JSON.stringify(summary?.details, null, 2));
  });

  it("should measure overhead breakdown", async () => {
    // Create a larger filesystem to see where time is really spent
    const files: Record<string, string> = {};

    // 50 repos with various structures
    for (let repo = 1; repo <= 50; repo++) {
      for (let pull = 1; pull <= 10; pull++) {
        files[`/repos/project${repo}/pulls/${pull}.json`] = "{}";
      }
      files[`/repos/project${repo}/src/index.ts`] = "";
      files[`/repos/project${repo}/src/utils/helpers.ts`] = "";
      files[`/repos/project${repo}/src/utils/format.ts`] = "";
      files[`/repos/project${repo}/package.json`] = "{}";
      files[`/repos/project${repo}/.git/config`] = "";
    }

    const events: TraceEvent[] = [];
    const env = new Bash({
      files,
      trace: (event) => events.push(event),
    });

    // Test the -path pattern query
    const result = await env.exec('find /repos -path "*/pulls/*.json" -type f');
    expect(result.exitCode).toBe(0);

    const summary = events.find(
      (e) => e.category === "find" && e.name === "summary",
    );
    expect(summary).toBeDefined();

    console.log("\n--- Overhead Breakdown (50 repos) ---");
    const details = summary?.details as Record<string, number>;
    const total = summary?.durationMs ?? 1;

    console.log(`Total time: ${total}ms`);
    console.log(
      `  Readdir: ${details.readdirTimeMs}ms (${((details.readdirTimeMs / total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Stat: ${details.statTimeMs}ms (${((details.statTimeMs / total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Eval: ${details.evalTimeMs}ms (${((details.evalTimeMs / total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Batch overhead: ${details.batchTimeMs}ms (${((details.batchTimeMs / total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Other: ${details.otherTimeMs}ms (${((details.otherTimeMs / total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Nodes: ${details.nodeCount}, Batches: ${details.batchCount}`,
    );
    console.log(
      `  Readdir calls: ${details.readdirCalls}, Stat calls: ${details.statCalls}`,
    );
    console.log(`  Eval calls: ${details.evalCalls}`);
  });

  it("should prune terminal directories (deep nesting)", async () => {
    // Create a structure where terminal directory pruning makes a big difference
    const files: Record<string, string> = {};

    // Create 10 "pulls" directories, each with files and deep subdirs
    for (let p = 1; p <= 10; p++) {
      // Direct files in pulls - these should be found
      for (let f = 1; f <= 5; f++) {
        files[`/repos/project${p}/pulls/${f}.json`] = "{}";
      }
      // Deep subdirectories inside pulls - these should NOT be traversed
      // Without optimization, we'd descend into all these dirs
      for (let sub = 1; sub <= 20; sub++) {
        files[`/repos/project${p}/pulls/archive/old${sub}/data.json`] = "{}";
        files[
          `/repos/project${p}/pulls/archive/old${sub}/deep/nested/file.json`
        ] = "{}";
      }
    }

    // Test without optimization (using -name which doesn't trigger pruning)
    const events1: TraceEvent[] = [];
    const env1 = new Bash({
      files,
      trace: (event) => events1.push(event),
    });
    await env1.exec('find /repos -type f -name "*.json"');
    const summary1 = events1.find(
      (e) => e.category === "find" && e.name === "summary",
    );

    // Test with optimization (using -path pattern)
    const events2: TraceEvent[] = [];
    const env2 = new Bash({
      files,
      trace: (event) => events2.push(event),
    });
    const result = await env2.exec(
      'find /repos -path "*/pulls/*.json" -type f',
    );
    const summary2 = events2.find(
      (e) => e.category === "find" && e.name === "summary",
    );

    console.log("\n--- Terminal Directory Pruning Test ---");
    console.log(
      `Without pruning: ${summary1?.details?.readdirCalls} readdir calls, ${summary1?.details?.nodeCount} nodes`,
    );
    console.log(
      `With pruning: ${summary2?.details?.readdirCalls} readdir calls, ${summary2?.details?.nodeCount} nodes`,
    );

    // The optimized version should visit fewer nodes
    expect((summary2?.details?.nodeCount as number) || 0).toBeLessThan(
      (summary1?.details?.nodeCount as number) || Infinity,
    );

    // Should find only the direct files in pulls (10 projects * 5 files = 50)
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(50);
    expect(result.exitCode).toBe(0);
  });

  it("should filter by extension in terminal directories", async () => {
    // Create files with mixed extensions in terminal directories
    const files: Record<string, string> = {};

    for (let p = 1; p <= 5; p++) {
      // JSON files - should be found
      files[`/repos/project${p}/pulls/1.json`] = "{}";
      files[`/repos/project${p}/pulls/2.json`] = "{}";
      // Non-JSON files - should be skipped early
      files[`/repos/project${p}/pulls/readme.txt`] = "";
      files[`/repos/project${p}/pulls/notes.md`] = "";
      files[`/repos/project${p}/pulls/config.yaml`] = "";
    }

    const events: TraceEvent[] = [];
    const env = new Bash({
      files,
      trace: (event) => events.push(event),
    });

    const result = await env.exec('find /repos -path "*/pulls/*.json" -type f');
    expect(result.exitCode).toBe(0);

    // Should only find the .json files (5 projects * 2 files = 10)
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(10);
    expect(lines.every((l) => l.endsWith(".json"))).toBe(true);

    const summary = events.find(
      (e) => e.category === "find" && e.name === "summary",
    );
    console.log("\n--- Extension Filter Test ---");
    console.log(
      `Nodes processed: ${summary?.details?.nodeCount}, Eval calls: ${summary?.details?.evalCalls}`,
    );

    // With extension filtering, we should process fewer nodes
    // (the non-.json files should be filtered before evaluation)
    // 5 projects + 5 pulls dirs + 10 json files = 20 nodes (not 25 with all files)
    expect((summary?.details?.nodeCount as number) || 0).toBeLessThanOrEqual(
      25,
    );
  });

  it("should trace against real filesystem (current project)", async () => {
    // Use OverlayFs to read from the actual project directory
    const fs = new OverlayFs({ root: process.cwd() });
    const mountPoint = fs.getMountPoint();

    const events: TraceEvent[] = [];
    const env = new Bash({
      fs,
      cwd: mountPoint,
      trace: (event) => events.push(event),
    });

    // Test the -path pattern query against real files
    console.log("\n--- Real Filesystem Test: -path pattern ---");
    const start1 = Date.now();
    const result1 = await env.exec(
      'find . -path "*/commands/*.ts" -type f | head -20',
    );
    const elapsed1 = Date.now() - start1;
    expect(result1.exitCode).toBe(0);

    const summary1 = events.find(
      (e) => e.category === "find" && e.name === "summary",
    );
    console.log(`Wall clock: ${elapsed1}ms`);
    console.log(JSON.stringify(summary1?.details, null, 2));

    // Clear events and test maxdepth
    events.length = 0;
    console.log("\n--- Real Filesystem Test: -maxdepth ---");
    const start2 = Date.now();
    const result2 = await env.exec(
      'find . -maxdepth 3 -type d -name "commands"',
    );
    const elapsed2 = Date.now() - start2;
    expect(result2.exitCode).toBe(0);

    const summary2 = events.find(
      (e) => e.category === "find" && e.name === "summary",
    );
    console.log(`Wall clock: ${elapsed2}ms`);
    console.log(JSON.stringify(summary2?.details, null, 2));
  });

  it("should compare fast-path vs regular evaluation", async () => {
    // Use in-memory filesystem for fast, stable tests
    const files: Record<string, string> = {};
    for (let i = 0; i < 500; i++) {
      files[`/src/dir${i % 50}/file${i}.ts`] = `content${i}`;
      files[`/src/dir${i % 50}/file${i}.js`] = `content${i}`;
    }

    // Test 1: Simple expression (fast-path) - only name/path/type
    const events1: TraceEvent[] = [];
    const env1 = new Bash({
      files,
      trace: (event) => events1.push(event),
    });

    console.log("\n--- Fast-path vs Regular Evaluation Comparison ---");

    const result1 = await env1.exec('find /src -name "*.ts" -type f');
    expect(result1.exitCode).toBe(0);

    const summary1 = events1.find(
      (e) => e.category === "find" && e.name === "summary",
    );
    const details1 = summary1?.details as Record<string, number>;

    // Test 2: Complex expression (no fast-path) - includes -mtime (stat-dependent)
    const events2: TraceEvent[] = [];
    const env2 = new Bash({
      files,
      trace: (event) => events2.push(event),
    });

    const result2 = await env2.exec(
      'find /src -name "*.ts" -type f -mtime -365',
    );
    expect(result2.exitCode).toBe(0);

    const summary2 = events2.find(
      (e) => e.category === "find" && e.name === "summary",
    );
    const details2 = summary2?.details as Record<string, number>;

    console.log("\nSimple expr (fast-path: -name + -type):");
    console.log(
      `  Nodes: ${details1.nodeCount}, Stat calls: ${details1.statCalls}`,
    );

    console.log("\nComplex expr (no fast-path: -name + -type + -mtime):");
    console.log(
      `  Nodes: ${details2.nodeCount}, Stat calls: ${details2.statCalls}`,
    );

    // Fast-path should have dramatically fewer stat calls
    // Simple expression: 1 stat (path check only)
    // Complex expression: 1000+ stats (every file needs mtime)
    expect(details1.statCalls).toBeLessThanOrEqual(2);
    expect(details2.statCalls).toBeGreaterThan(500);
  });

  it("should measure pure evaluation overhead (no stat calls)", async () => {
    // Micro-benchmark: directly compare evaluation functions
    // This isolates just the object allocation overhead

    // Create a simple expression: -name "*.ts" -type f
    const expr: Expression = {
      type: "and",
      left: { type: "name", pattern: "*.ts" },
      right: { type: "type", fileType: "f" },
    };

    // Test data - simulate evaluating many files (100K to see measurable difference)
    const testFiles = [];
    for (let i = 0; i < 100000; i++) {
      testFiles.push({
        name: i % 3 === 0 ? `file${i}.ts` : `file${i}.js`,
        relativePath: `/src/dir${i % 100}/file${i}.${i % 3 === 0 ? "ts" : "js"}`,
        isFile: true,
        isDirectory: false,
      });
    }

    // Add some directories
    for (let i = 0; i < 20000; i++) {
      testFiles.push({
        name: `dir${i}`,
        relativePath: `/src/dir${i}`,
        isFile: false,
        isDirectory: true,
      });
    }

    console.log("\n--- Pure Evaluation Overhead (no stat calls) ---");
    console.log(`Testing with ${testFiles.length} entries`);

    // Benchmark fast-path (no EvalContext object creation)
    const iterations = 20;
    let fastPathTotal = 0;
    let fastPathMatches = 0;

    for (let iter = 0; iter < iterations; iter++) {
      const start = performance.now();
      for (const file of testFiles) {
        const result = evaluateSimpleExpression(
          expr,
          file.name,
          file.relativePath,
          file.isFile,
          file.isDirectory,
        );
        if (result.matches) fastPathMatches++;
      }
      fastPathTotal += performance.now() - start;
    }

    // Benchmark regular path (with EvalContext object creation)
    let regularPathTotal = 0;
    let regularPathMatches = 0;
    const newerRefTimes = new Map<string, number>();

    for (let iter = 0; iter < iterations; iter++) {
      const start = performance.now();
      for (const file of testFiles) {
        const evalCtx: EvalContext = {
          name: file.name,
          relativePath: file.relativePath,
          isFile: file.isFile,
          isDirectory: file.isDirectory,
          isEmpty: false,
          mtime: Date.now(),
          size: 1024,
          mode: 0o644,
          newerRefTimes,
        };
        const result = evaluateExpressionWithPrune(expr, evalCtx);
        if (result.matches) regularPathMatches++;
      }
      regularPathTotal += performance.now() - start;
    }

    const fastAvg = fastPathTotal / iterations;
    const regularAvg = regularPathTotal / iterations;
    const savings = regularAvg - fastAvg;
    const savingsPercent = ((savings / regularAvg) * 100).toFixed(1);

    console.log(`\nFast-path (no EvalContext):  ${fastAvg.toFixed(2)}ms avg`);
    console.log(`Regular path (EvalContext):  ${regularAvg.toFixed(2)}ms avg`);
    console.log(`Savings: ${savings.toFixed(2)}ms (${savingsPercent}%)`);
    console.log(
      `Matches: ${fastPathMatches / iterations} (should equal ${regularPathMatches / iterations})`,
    );

    // Verify both produce same results (correctness only, timing is informational)
    expect(fastPathMatches).toBe(regularPathMatches);
  });

  it("should skip stat calls for printf with simple directives", async () => {
    // Create a filesystem with many files
    const files: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      files[`/data/file${i}.txt`] = `content${i}`;
    }

    // Test 1: printf with simple directives (%f %p) - should skip stat
    const events1: TraceEvent[] = [];
    const env1 = new Bash({
      files,
      trace: (event) => events1.push(event),
    });

    const result1 = await env1.exec('find /data -type f -printf "%f %p\\n"');
    expect(result1.exitCode).toBe(0);

    const summary1 = events1.find(
      (e) => e.category === "find" && e.name === "summary",
    );
    const statCalls1 = (summary1?.details?.statCalls as number) ?? 0;

    // Test 2: printf with stat-dependent directive (%s) - needs stat
    const events2: TraceEvent[] = [];
    const env2 = new Bash({
      files,
      trace: (event) => events2.push(event),
    });

    const result2 = await env2.exec('find /data -type f -printf "%f %s\\n"');
    expect(result2.exitCode).toBe(0);

    const summary2 = events2.find(
      (e) => e.category === "find" && e.name === "summary",
    );
    const statCalls2 = (summary2?.details?.statCalls as number) ?? 0;

    console.log("\n--- Printf stat optimization ---");
    console.log(`printf "%f %p" (simple): ${statCalls1} stat calls`);
    console.log(`printf "%f %s" (needs stat): ${statCalls2} stat calls`);

    // Simple printf should have minimal stat calls (just 1 for path verification)
    expect(statCalls1).toBeLessThanOrEqual(2);
    // Stat-dependent printf needs stat for each file
    expect(statCalls2).toBeGreaterThan(50);
  });
});

/**
 * Node visitation verification tests.
 * These tests use a well-defined filesystem structure and assert exact
 * node counts to verify optimizations are working correctly.
 */
describe("find node visitation verification", () => {
  /**
   * Creates a large, well-defined filesystem structure for testing.
   * Structure:
   *   /data/
   *     org1-5/
   *       repo1-10/
   *         pulls/
   *           1-5.json (files)
   *           archive/
   *             2024/ (deep subdirs)
   *               pr1-3.json
   *         issues/
   *           1-3.json
   *         src/
   *           index.ts
   *           lib/
   *             utils.ts
   *             helpers.ts
   *         package.json
   *         README.md
   *
   * Totals:
   * - 5 orgs × 10 repos = 50 repos
   * - Each repo has: pulls/, issues/, src/, src/lib/, pulls/archive/, pulls/archive/2024/
   *   = 6 directories per repo = 300 directories
   * - Plus /data/ and 5 org dirs = 306 total directories
   * - Files per repo: 5 pulls + 3 archive + 3 issues + 3 src files + 2 root = 16 files
   *   = 50 × 16 = 800 files
   */
  function createLargeFilesystem(): Record<string, string> {
    const files: Record<string, string> = {};

    for (let org = 1; org <= 5; org++) {
      for (let repo = 1; repo <= 10; repo++) {
        const base = `/data/org${org}/repo${repo}`;

        // Direct files in pulls/ - these are the target for */pulls/*.json
        for (let pr = 1; pr <= 5; pr++) {
          files[`${base}/pulls/${pr}.json`] = `{"pr": ${pr}}`;
        }

        // Archived PRs in deep subdirectory - should be skipped with terminal pruning
        for (let pr = 1; pr <= 3; pr++) {
          files[`${base}/pulls/archive/2024/pr${pr}.json`] =
            `{"archived": true}`;
        }

        // Issues
        for (let issue = 1; issue <= 3; issue++) {
          files[`${base}/issues/${issue}.json`] = `{"issue": ${issue}}`;
        }

        // Source files
        files[`${base}/src/index.ts`] = "export {}";
        files[`${base}/src/lib/utils.ts`] = "export const util = 1;";
        files[`${base}/src/lib/helpers.ts`] = "export const helper = 1;";

        // Root files
        files[`${base}/package.json`] = "{}";
        files[`${base}/README.md`] = "# Repo";
      }
    }

    return files;
  }

  function getTraceSummary(events: TraceEvent[]) {
    return events.find((e) => e.category === "find" && e.name === "summary");
  }

  it("should visit minimal nodes for -path '*/pulls/*.json' -type f", async () => {
    const files = createLargeFilesystem();
    const events: TraceEvent[] = [];
    const env = new Bash({
      files,
      trace: (event) => events.push(event),
    });

    const result = await env.exec('find /data -path "*/pulls/*.json" -type f');
    expect(result.exitCode).toBe(0);

    // Expected: 5 orgs × 10 repos × 5 direct PRs = 250 files
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(250);

    // All results should be direct children of pulls/, not in archive/
    expect(lines.every((l) => l.match(/\/pulls\/\d+\.json$/))).toBe(true);

    const summary = getTraceSummary(events);
    expect(summary).toBeDefined();

    // Terminal directory pruning prevents descending INTO pulls subdirs (archive/2024)
    // But we still visit sibling directories (issues, src) to check if they match.
    // What we SKIP with terminal pruning:
    // - 50 archive dirs + 50 2024 dirs = 100 dirs
    // - 150 archived PR files (3 per repo × 50 repos)
    // Full tree: 306 dirs + 800 files = 1106 nodes
    // With pruning: 1106 - 100 dirs - 150 archive files = 856 nodes (approx)
    // Plus extension filtering skips non-.json files in pulls: -50 repos × 0 = 0
    // (only .json files in pulls in our setup)
    const nodeCount = summary?.details?.nodeCount as number;

    // Verify pruning is working: should be less than full tree
    expect(nodeCount).toBeLessThan(1000);

    // Without terminal pruning, we'd visit everything (~1156 nodes with implicit dirs)
    console.log(
      `\n-path pattern: ${nodeCount} nodes visited (full tree would be ~1156)`,
    );
  });

  it("should visit minimal nodes for -maxdepth 3 -type d", async () => {
    const files = createLargeFilesystem();
    const events: TraceEvent[] = [];
    const env = new Bash({
      files,
      trace: (event) => events.push(event),
    });

    // maxdepth 3 from /data: /data(0), org*(1), repo*(2), pulls|issues|src(3)
    const result = await env.exec("find /data -maxdepth 3 -type d");
    expect(result.exitCode).toBe(0);

    // Expected directories at depth ≤3:
    // depth 0: /data (1)
    // depth 1: org1-5 (5)
    // depth 2: repo1-10 per org (50)
    // depth 3: pulls, issues, src per repo (150)
    // Total: 1 + 5 + 50 + 150 = 206
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(206);

    const summary = getTraceSummary(events);
    expect(summary).toBeDefined();

    // nodeCount includes directories we evaluate (may read children but filter by depth)
    // The full tree has 306 directories, so maxdepth should reduce this
    const nodeCount = summary?.details?.nodeCount as number;

    // With maxdepth, we evaluate dirs at depth 3 but don't process their children
    // This saves visiting: archive(50), 2024(50), lib(50) = 150 dirs at depth 4+
    // So we should visit fewer than full tree (306 dirs)
    expect(nodeCount).toBeLessThanOrEqual(306);

    console.log(
      `\n-maxdepth 3: ${nodeCount} nodes visited, ${lines.length} matched`,
    );
  });

  it("should visit all nodes for -name '*.json' (no path pruning)", async () => {
    const files = createLargeFilesystem();
    const events: TraceEvent[] = [];
    const env = new Bash({
      files,
      trace: (event) => events.push(event),
    });

    const result = await env.exec('find /data -name "*.json" -type f');
    expect(result.exitCode).toBe(0);

    // Expected: all .json files
    // pulls: 5 direct + 3 archive = 8 per repo = 400
    // issues: 3 per repo = 150
    // package.json: 1 per repo = 50
    // Total: 600 .json files
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(600);

    const summary = getTraceSummary(events);
    expect(summary).toBeDefined();

    // Without path pruning, we must visit the entire tree
    // Total: 306 dirs + 800 files = 1106 nodes
    const nodeCount = summary?.details?.nodeCount as number;
    const statCalls = summary?.details?.statCalls as number;
    const evalCalls = summary?.details?.evalCalls as number;
    const readdirCalls = summary?.details?.readdirCalls as number;
    expect(nodeCount).toBeGreaterThan(1000);

    console.log(
      `\n-name pattern: ${nodeCount} nodes, ${readdirCalls} readdir, ${statCalls} stat, ${evalCalls} eval`,
    );
  });

  it("should compare pruned vs unpruned for different queries", async () => {
    const files = createLargeFilesystem();

    // Query without terminal pruning: -name *.json (visits full tree)
    const events1: TraceEvent[] = [];
    const env1 = new Bash({
      files,
      trace: (event) => events1.push(event),
    });
    const result1 = await env1.exec('find /data -type f -name "*.json"');

    // Query WITH terminal pruning: -path "*/pulls/*.json" (skips archive subdirs)
    const events2: TraceEvent[] = [];
    const env2 = new Bash({
      files,
      trace: (event) => events2.push(event),
    });
    const result2 = await env2.exec(
      'find /data -path "*/pulls/*.json" -type f',
    );

    const lines1 = result1.stdout.trim().split("\n").filter(Boolean);
    const lines2 = result2.stdout.trim().split("\n").filter(Boolean);

    // First query finds ALL .json files: pulls(250+150) + issues(150) + package.json(50) = 600
    expect(lines1).toHaveLength(600);

    // Second query finds only direct children of pulls (terminal pruning)
    expect(lines2).toHaveLength(250);

    const summary1 = getTraceSummary(events1);
    const summary2 = getTraceSummary(events2);

    const nodeCount1 = summary1?.details?.nodeCount as number;
    const nodeCount2 = summary2?.details?.nodeCount as number;

    console.log("\n--- Pruning comparison ---");
    console.log(
      `-name pattern (full tree): ${nodeCount1} nodes, ${lines1.length} results`,
    );
    console.log(
      `-path pattern (terminal pruning): ${nodeCount2} nodes, ${lines2.length} results`,
    );

    // Pruned version should visit fewer nodes (skips archive/2024 dirs and their files)
    expect(nodeCount2).toBeLessThan(nodeCount1);
  });

  it("should verify readdir call counts with -maxdepth", async () => {
    const files = createLargeFilesystem();
    const events: TraceEvent[] = [];
    const env = new Bash({
      files,
      trace: (event) => events.push(event),
    });

    const result = await env.exec("find /data -maxdepth 2 -type d");
    expect(result.exitCode).toBe(0);

    // depth 0: /data (1)
    // depth 1: org1-5 (5)
    // depth 2: repo1-10 per org (50)
    // Total: 56 directories
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(56);

    const summary = getTraceSummary(events);
    expect(summary).toBeDefined();

    // We should only readdir directories at depth < maxdepth
    // depth 0: /data (1 readdir)
    // depth 1: 5 orgs (5 readdirs)
    // depth 2: 50 repos - but we DON'T readdir these since depth=maxdepth
    // Total: 6 readdir calls
    const readdirCalls = summary?.details?.readdirCalls as number;
    expect(readdirCalls).toBe(6);

    console.log(`\n-maxdepth 2: ${readdirCalls} readdir calls`);
  });

  it("should verify extension filtering reduces eval calls", async () => {
    // Create structure with many non-matching extensions
    const files: Record<string, string> = {};
    for (let i = 1; i <= 10; i++) {
      // Target files
      files[`/data/repo${i}/pulls/pr1.json`] = "{}";
      files[`/data/repo${i}/pulls/pr2.json`] = "{}";
      // Non-matching extensions (should be filtered before eval)
      files[`/data/repo${i}/pulls/draft.yaml`] = "";
      files[`/data/repo${i}/pulls/notes.md`] = "";
      files[`/data/repo${i}/pulls/config.toml`] = "";
      files[`/data/repo${i}/pulls/test.txt`] = "";
      files[`/data/repo${i}/pulls/data.xml`] = "";
    }

    const events: TraceEvent[] = [];
    const env = new Bash({
      files,
      trace: (event) => events.push(event),
    });

    const result = await env.exec('find /data -path "*/pulls/*.json" -type f');
    expect(result.exitCode).toBe(0);

    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(20); // 10 repos × 2 .json files

    const summary = getTraceSummary(events);
    expect(summary).toBeDefined();

    // With extension filtering, we should only evaluate .json files
    // Non-.json files in terminal dirs are skipped before evaluation
    const evalCalls = summary?.details?.evalCalls as number;
    const nodeCount = summary?.details?.nodeCount as number;

    // Expected: /data(1) + repo1-10(10) + pulls dirs(10) + json files(20) = 41 nodes
    // NOT 41 + 50 non-json files = 91
    expect(nodeCount).toBeLessThanOrEqual(45);

    console.log(
      `\nExtension filtering: ${nodeCount} nodes, ${evalCalls} eval calls`,
    );
  });

  it("should handle nested terminal directories correctly", async () => {
    // Edge case: pulls inside pulls
    const files: Record<string, string> = {};
    files["/data/pulls/1.json"] = "{}";
    files["/data/pulls/2.json"] = "{}";
    files["/data/pulls/pulls/nested.json"] = "{}"; // Should NOT match */pulls/*.json
    files["/data/pulls/other/deep.json"] = "{}"; // Should NOT match

    const events: TraceEvent[] = [];
    const env = new Bash({
      files,
      trace: (event) => events.push(event),
    });

    const result = await env.exec('find /data -path "*/pulls/*.json" -type f');
    expect(result.exitCode).toBe(0);

    const lines = result.stdout.trim().split("\n").filter(Boolean);
    // Should only find direct children: /data/pulls/1.json and /data/pulls/2.json
    expect(lines).toHaveLength(2);
    expect(lines.sort()).toEqual(["/data/pulls/1.json", "/data/pulls/2.json"]);
  });

  it("should handle -mindepth and -maxdepth combination", async () => {
    const files = createLargeFilesystem();
    const events: TraceEvent[] = [];
    const env = new Bash({
      files,
      trace: (event) => events.push(event),
    });

    // Find repo directories: depth 2 only
    const result = await env.exec("find /data -mindepth 2 -maxdepth 2 -type d");
    expect(result.exitCode).toBe(0);

    // Should only find repo directories (50)
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(50);
    expect(lines.every((l) => l.match(/\/data\/org\d+\/repo\d+$/))).toBe(true);

    const summary = getTraceSummary(events);
    const nodeCount = summary?.details?.nodeCount as number;

    // We visit: /data, org1-5 (at mindepth, not output), repo dirs
    // 1 + 5 + 50 = 56 nodes
    expect(nodeCount).toBe(56);

    console.log(`\n-mindepth 2 -maxdepth 2: ${nodeCount} nodes`);
  });
});

/**
 * Tests for common real-world find command patterns.
 * These cover typical use cases developers encounter daily.
 */
describe("find common patterns", () => {
  function getTraceSummary(events: TraceEvent[]) {
    return events.find((e) => e.category === "find" && e.name === "summary");
  }

  /**
   * Creates a realistic project structure with common directories:
   * - node_modules (deep, should be pruned)
   * - .git (should be pruned)
   * - dist/build output
   * - src with test files
   * - config files at root
   */
  function createProjectFilesystem(): Record<string, string> {
    const files: Record<string, string> = {};

    // Root config files
    files["/project/package.json"] = "{}";
    files["/project/tsconfig.json"] = "{}";
    files["/project/.eslintrc.js"] = "module.exports = {}";
    files["/project/.prettierrc"] = "{}";
    files["/project/jest.config.js"] = "module.exports = {}";
    files["/project/README.md"] = "# Project";

    // Source files
    for (let i = 1; i <= 10; i++) {
      files[`/project/src/module${i}/index.ts`] = "export {}";
      files[`/project/src/module${i}/utils.ts`] = "export const x = 1";
      files[`/project/src/module${i}/index.test.ts`] = "test('x', () => {})";
      files[`/project/src/module${i}/utils.spec.ts`] =
        "describe('x', () => {})";
    }

    // __tests__ directory
    for (let i = 1; i <= 5; i++) {
      files[`/project/src/__tests__/integration${i}.test.ts`] = "test()";
    }

    // Deep node_modules (should be pruned in real searches)
    for (let pkg = 1; pkg <= 20; pkg++) {
      files[`/project/node_modules/package${pkg}/index.js`] = "";
      files[`/project/node_modules/package${pkg}/lib/util.js`] = "";
      files[`/project/node_modules/package${pkg}/package.json`] = "{}";
      // Nested dependencies
      for (let dep = 1; dep <= 3; dep++) {
        files[
          `/project/node_modules/package${pkg}/node_modules/dep${dep}/index.js`
        ] = "";
      }
    }

    // .git directory (should be pruned)
    files["/project/.git/config"] = "";
    files["/project/.git/HEAD"] = "ref: refs/heads/main";
    files["/project/.git/objects/pack/pack-1.pack"] = "";
    files["/project/.git/objects/pack/pack-1.idx"] = "";
    for (let i = 1; i <= 10; i++) {
      files[`/project/.git/objects/ab/object${i}`] = "";
    }

    // dist output (build artifacts)
    for (let i = 1; i <= 10; i++) {
      files[`/project/dist/module${i}/index.js`] = "";
      files[`/project/dist/module${i}/index.js.map`] = "";
      files[`/project/dist/module${i}/index.d.ts`] = "";
    }

    // Assets with multiple extensions
    files["/project/public/logo.png"] = "";
    files["/project/public/banner.jpg"] = "";
    files["/project/public/icon.gif"] = "";
    files["/project/public/sprite.svg"] = "";
    files["/project/public/favicon.ico"] = "";

    return files;
  }

  describe("exclusion patterns with -prune", () => {
    it("should use early prune optimization", async () => {
      // Simple structure to verify early pruning works
      const files: Record<string, string> = {};
      files["/data/keep/file1.txt"] = "keep";
      files["/data/keep/file2.txt"] = "keep";
      // node_modules with deep structure - should be early pruned
      for (let i = 1; i <= 10; i++) {
        files[`/data/node_modules/pkg${i}/index.js`] = "";
        files[`/data/node_modules/pkg${i}/lib/util.js`] = "";
      }

      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      const result = await env.exec(
        "find /data -name node_modules -prune -o -type f -print",
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      // Should only find files in /data/keep
      expect(lines).toHaveLength(2);
      expect(lines.every((l) => l.includes("/keep/"))).toBe(true);

      const summary = getTraceSummary(events);
      const earlyPrunes = summary?.details?.earlyPrunes as number;
      const readdirCalls = summary?.details?.readdirCalls as number;

      console.log(
        `\nEarly prune test: earlyPrunes=${earlyPrunes}, readdirCalls=${readdirCalls}, nodes=${summary?.details?.nodeCount}`,
      );

      // Should have early pruned the node_modules directory
      // This means we didn't read its contents
      expect(earlyPrunes).toBeGreaterThan(0);

      // With early pruning, we should NOT read node_modules contents
      // Only read: /data, /data/keep, and optionally /data/node_modules (before pruning)
      // Should be 2 or 3 readdir calls, not 12+ (if we read all node_modules subdirs)
      expect(readdirCalls).toBeLessThanOrEqual(3);
    });

    it("should prune node_modules and find source files", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      // Find all .ts files, excluding node_modules
      const result = await env.exec(
        'find /project -path "*/node_modules" -prune -o -name "*.ts" -type f -print',
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);

      // Should find: 10 modules × 4 .ts files = 40
      // Plus 5 integration tests = 45
      // Plus 10 .d.ts files in dist = 55 total (.d.ts matches *.ts)
      expect(lines).toHaveLength(55);

      // None should be in node_modules
      expect(lines.every((l) => !l.includes("node_modules"))).toBe(true);

      const summary = getTraceSummary(events);
      console.log(
        `\n-prune node_modules: ${summary?.details?.nodeCount} nodes, earlyPrunes=${summary?.details?.earlyPrunes}, ${lines.length} results`,
      );

      // With pruning, we should visit far fewer nodes than the full tree
      // node_modules has 20 packages × (3 files + nested deps) = ~200+ files
      // Full tree would be ~400+ nodes, with pruning we visit much less
      expect((summary?.details?.nodeCount as number) || 0).toBeLessThan(250);
    });

    it("should prune .git directory", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      // Find all files excluding .git
      const result = await env.exec(
        'find /project -path "*/.git" -prune -o -type f -print',
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);

      // None should be in .git
      expect(lines.every((l) => !l.includes("/.git/"))).toBe(true);

      const summary = getTraceSummary(events);
      console.log(
        `\n-prune .git: ${summary?.details?.nodeCount} nodes, ${lines.length} files`,
      );
    });

    it("should prune multiple directories", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      // Find .ts files excluding node_modules, .git, and dist
      const result = await env.exec(
        'find /project \\( -path "*/node_modules" -o -path "*/.git" -o -path "*/dist" \\) -prune -o -name "*.ts" -type f -print',
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);

      // Should only find source .ts files
      expect(lines).toHaveLength(45);
      expect(
        lines.every(
          (l) =>
            !l.includes("node_modules") &&
            !l.includes("/.git/") &&
            !l.includes("/dist/"),
        ),
      ).toBe(true);

      const summary = getTraceSummary(events);
      console.log(
        `\n-prune multiple: ${summary?.details?.nodeCount} nodes, ${lines.length} results`,
      );
    });
  });

  describe("multi-extension searches", () => {
    it("should find files with multiple extensions using -o", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      // Find all image files
      const result = await env.exec(
        'find /project/public \\( -name "*.png" -o -name "*.jpg" -o -name "*.gif" \\) -type f',
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(3); // logo.png, banner.jpg, icon.gif

      const summary = getTraceSummary(events);
      console.log(
        `\nMulti-extension (images): ${summary?.details?.nodeCount} nodes, ${lines.length} results`,
      );
    });

    it("should find TypeScript and JavaScript files", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      // Find all .ts and .js files in src and dist (excluding node_modules)
      const result = await env.exec(
        'find /project/src /project/dist \\( -name "*.ts" -o -name "*.js" \\) -type f',
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      // src: 45 .ts files, dist: 10 .js + 10 .d.ts files = 65
      // (.d.ts matches *.ts pattern)
      expect(lines).toHaveLength(65);

      const summary = getTraceSummary(events);
      console.log(
        `\nMulti-extension (ts+js): ${summary?.details?.nodeCount} nodes, ${lines.length} results`,
      );
    });
  });

  describe("test file patterns", () => {
    it("should find .test.ts and .spec.ts files", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      const result = await env.exec(
        'find /project/src \\( -name "*.test.ts" -o -name "*.spec.ts" \\) -type f',
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      // 10 modules × 2 test files + 5 integration = 25
      expect(lines).toHaveLength(25);
      expect(
        lines.every((l) => l.endsWith(".test.ts") || l.endsWith(".spec.ts")),
      ).toBe(true);

      const summary = getTraceSummary(events);
      console.log(
        `\nTest files: ${summary?.details?.nodeCount} nodes, ${lines.length} results`,
      );
    });

    it("should find files in __tests__ directory", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      const result = await env.exec(
        'find /project -path "*/__tests__/*" -type f',
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(5);
      expect(lines.every((l) => l.includes("/__tests__/"))).toBe(true);

      const summary = getTraceSummary(events);
      console.log(
        `\n__tests__ pattern: ${summary?.details?.nodeCount} nodes, ${lines.length} results`,
      );
    });
  });

  describe("shallow config searches", () => {
    it("should find config files at root with -maxdepth 1", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      const result = await env.exec(
        'find /project -maxdepth 1 -name "*.json" -type f',
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      // package.json and tsconfig.json at root
      expect(lines).toHaveLength(2);

      const summary = getTraceSummary(events);
      // With maxdepth 1, we only read the root directory
      expect(summary?.details?.readdirCalls).toBe(1);

      console.log(
        `\n-maxdepth 1 config: ${summary?.details?.readdirCalls} readdir, ${lines.length} results`,
      );
    });

    it("should find dotfiles at root", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      const result = await env.exec(
        'find /project -maxdepth 1 -name ".*" -type f',
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      // .eslintrc.js and .prettierrc
      expect(lines).toHaveLength(2);

      console.log(`\nDotfiles at root: ${lines.length} results`);
    });

    it("should find config files with -maxdepth 2", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      // Find all .json config files in project root and immediate subdirs
      const result = await env.exec(
        'find /project -maxdepth 2 -name "*.json" -type f',
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      // Root: package.json, tsconfig.json
      // We should NOT see node_modules/*/package.json (depth 3)
      expect(lines).toHaveLength(2);

      const summary = getTraceSummary(events);
      console.log(
        `\n-maxdepth 2 config: ${summary?.details?.nodeCount} nodes, ${lines.length} results`,
      );
    });
  });

  describe("build artifact patterns", () => {
    it("should find all files in dist directory", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      const result = await env.exec("find /project/dist -type f");
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      // 10 modules × 3 files (.js, .js.map, .d.ts) = 30
      expect(lines).toHaveLength(30);

      const summary = getTraceSummary(events);
      console.log(
        `\ndist files: ${summary?.details?.nodeCount} nodes, ${lines.length} results`,
      );
    });

    it("should find source maps", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      const result = await env.exec('find /project -name "*.map" -type f');
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(10); // 10 .js.map files
      expect(lines.every((l) => l.endsWith(".map"))).toBe(true);

      console.log(`\nSource maps: ${lines.length} results`);
    });

    it("should find type definitions", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      const result = await env.exec('find /project -name "*.d.ts" -type f');
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(10);
      expect(lines.every((l) => l.endsWith(".d.ts"))).toBe(true);

      console.log(`\nType definitions: ${lines.length} results`);
    });
  });

  describe("time-based queries", () => {
    it("should find files modified within time window using -mtime", async () => {
      // Create files with specific mtimes
      const files: Record<string, string> = {};
      files["/data/recent.txt"] = "recent";
      files["/data/old.txt"] = "old";
      files["/data/ancient.txt"] = "ancient";

      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      // All files in in-memory fs have current mtime, so -mtime -1 finds all
      const result = await env.exec("find /data -mtime -1 -type f");
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(3);

      // -mtime 0 should find files modified today (within last 24 hours)
      const result2 = await env.exec("find /data -mtime 0 -type f");
      expect(result2.exitCode).toBe(0);
      const lines2 = result2.stdout.trim().split("\n").filter(Boolean);
      expect(lines2).toHaveLength(3); // All files created just now

      console.log(
        `\n-mtime -1: ${lines.length} files, -mtime 0: ${lines2.length} files`,
      );
    });

    it("should find files newer than reference using -newer", async () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 60 * 1000);

      const events: TraceEvent[] = [];
      const env = new Bash({
        files: {
          "/data/reference.txt": { content: "ref", mtime: earlier },
          "/data/file1.txt": { content: "1", mtime: now },
          "/data/file2.txt": { content: "2", mtime: now },
        },
        trace: (event) => events.push(event),
      });

      // file1.txt and file2.txt are newer than reference.txt
      const result = await env.exec(
        "find /data -newer /data/reference.txt -type f",
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(lines.sort()).toEqual(["/data/file1.txt", "/data/file2.txt"]);

      console.log(`\n-newer: ${lines.length} files newer than reference`);
    });
  });

  describe("size-based queries", () => {
    it("should find empty files", async () => {
      const files: Record<string, string> = {};
      files["/data/empty1.txt"] = "";
      files["/data/empty2.txt"] = "";
      files["/data/notempty.txt"] = "content";
      files["/data/also-content.txt"] = "more content";

      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      const result = await env.exec("find /data -empty -type f");
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(lines.sort()).toEqual(["/data/empty1.txt", "/data/empty2.txt"]);

      console.log(`\n-empty: ${lines.length} empty files`);
    });

    it("should find files by size", async () => {
      const files: Record<string, string> = {};
      files["/data/small.txt"] = "x"; // 1 byte
      files["/data/medium.txt"] = "x".repeat(100); // 100 bytes
      files["/data/large.txt"] = "x".repeat(2000); // 2000 bytes

      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      // Find files larger than 50 bytes
      const result = await env.exec("find /data -size +50c -type f");
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(2); // medium and large
      expect(lines.sort()).toEqual(["/data/large.txt", "/data/medium.txt"]);

      // Find files smaller than 50 bytes
      const result2 = await env.exec("find /data -size -50c -type f");
      expect(result2.exitCode).toBe(0);
      const lines2 = result2.stdout.trim().split("\n").filter(Boolean);
      expect(lines2).toHaveLength(1); // small only

      console.log(
        `\n-size +50c: ${lines.length} files, -size -50c: ${lines2.length} files`,
      );
    });

    it("should find empty directories", async () => {
      const files: Record<string, string> = {};
      files["/data/notempty/file.txt"] = "content";
      // Empty dirs need to be created explicitly or inferred
      // In our fs, we can create a file and then the parent exists

      const env = new Bash({ files });

      // Create an empty directory
      await env.exec("mkdir -p /data/emptydir");

      const result = await env.exec("find /data -empty -type d");
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe("/data/emptydir");

      console.log(`\n-empty -type d: ${lines.length} empty directories`);
    });
  });

  describe("combined real-world scenarios", () => {
    it("should find source files excluding common ignored directories", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      // Typical gitignore-aware search
      const result = await env.exec(
        'find /project \\( -name "node_modules" -o -name ".git" -o -name "dist" \\) -prune -o \\( -name "*.ts" -o -name "*.js" \\) -type f -print',
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);

      // Should find: 45 .ts files in src + config .js files at root
      // .eslintrc.js, jest.config.js = 2
      expect(lines).toHaveLength(47);

      // Verify nothing from excluded dirs
      expect(
        lines.every(
          (l) =>
            !l.includes("/node_modules/") &&
            !l.includes("/.git/") &&
            !l.includes("/dist/"),
        ),
      ).toBe(true);

      const summary = getTraceSummary(events);
      console.log(
        `\nReal-world source search: ${summary?.details?.nodeCount} nodes, ${lines.length} results`,
      );
    });

    it("should find non-test source files", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      // Find .ts files that are not tests
      const result = await env.exec(
        'find /project/src -name "*.ts" -type f ! -name "*.test.ts" ! -name "*.spec.ts"',
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);

      // 10 modules × 2 non-test files (index.ts, utils.ts) = 20
      expect(lines).toHaveLength(20);
      expect(
        lines.every((l) => !l.includes(".test.ts") && !l.includes(".spec.ts")),
      ).toBe(true);

      console.log(`\nNon-test source files: ${lines.length} results`);
    });

    it("should count files by type efficiently", async () => {
      const files = createProjectFilesystem();
      const events: TraceEvent[] = [];
      const env = new Bash({
        files,
        trace: (event) => events.push(event),
      });

      // Count .ts files (using wc -l)
      const result = await env.exec(
        'find /project/src -name "*.ts" -type f | wc -l',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("45");

      const summary = getTraceSummary(events);
      console.log(
        `\nCount with wc -l: ${summary?.details?.nodeCount} nodes visited`,
      );
    });
  });
});
