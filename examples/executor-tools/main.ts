/**
 * Executor Tools Examples
 *
 * Runs both examples sequentially. You can also run each individually:
 *   npx tsx inline-tools.ts
 *   npx tsx multi-turn-discovery.ts
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
} else if (example === "1" || example === "inline") {
  await import("./inline-tools.js");
} else if (example === "2" || example === "discovery") {
  await import("./multi-turn-discovery.js");
} else {
  console.error(`Unknown example: ${example}`);
  console.error("Usage: npx tsx main.ts [all|1|2|inline|discovery]");
  process.exit(1);
}
