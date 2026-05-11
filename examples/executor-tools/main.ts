/**
 * Executor Tools Examples
 *
 * Runs all examples sequentially. You can also run each individually:
 *   npx tsx inline-tools.ts
 *   npx tsx multi-turn-discovery.ts
 *   npx tsx multi-api-agent.ts
 */

const example = process.argv[2];

if (!example || example === "all") {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     Executor Tools — All Examples        ║");
  console.log("╚══════════════════════════════════════════╝\n");

  console.log("─── Example 1: Inline Tools ───────────────────────\n");
  await import("./inline-tools.js");

  console.log("\n─── Example 2: SDK Discovery ──────────────────────\n");
  await import("./multi-turn-discovery.js");

  console.log("\n─── Example 3: Multi-API Agent Loop ───────────────\n");
  await import("./multi-api-agent.js");
} else if (example === "1" || example === "inline") {
  await import("./inline-tools.js");
} else if (example === "2" || example === "discovery") {
  await import("./multi-turn-discovery.js");
} else if (example === "3" || example === "multi-api") {
  await import("./multi-api-agent.js");
} else {
  console.error(`Unknown example: ${example}`);
  console.error(
    "Usage: npx tsx main.ts [all|1|2|3|inline|discovery|multi-api]",
  );
  process.exit(1);
}
