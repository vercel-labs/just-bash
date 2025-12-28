/**
 * Custom Commands Example
 *
 * Demonstrates how to extend just-bash with custom TypeScript commands.
 * Run with: npx tsx main.ts
 */

import { Bash } from "just-bash";
import {
  uuidCommand,
  jsonFormatCommand,
  loremCommand,
  wordcountCommand,
  reverseCommand,
  summarizeCommand,
} from "./commands.js";

// Create bash with custom commands
const bash = new Bash({
  customCommands: [
    uuidCommand,
    jsonFormatCommand,
    loremCommand,
    wordcountCommand,
    reverseCommand,
    summarizeCommand,
  ],
  files: {
    "/data/sample.json": '{"name":"Alice","age":30,"city":"NYC"}',
  },
});

async function demo() {
  console.log("=== Custom Commands Demo ===\n");

  // UUID generation
  console.log("1. Generate UUIDs:");
  let result = await bash.exec("uuid -n 3");
  console.log(result.stdout);

  // JSON formatting
  console.log("2. Format JSON from file:");
  result = await bash.exec("json-format /data/sample.json");
  console.log(result.stdout);

  // JSON formatting from pipe
  console.log("3. Format JSON from pipe:");
  result = await bash.exec('echo \'{"a":1,"b":2}\' | json-format');
  console.log(result.stdout);

  // Lorem ipsum
  console.log("4. Generate lorem ipsum (2 paragraphs):");
  result = await bash.exec("lorem 2");
  console.log(result.stdout);

  // Word count
  console.log("5. Count words in lorem ipsum:");
  result = await bash.exec("lorem | wordcount");
  console.log(result.stdout);

  // Reverse text
  console.log("6. Reverse text:");
  result = await bash.exec("echo 'Hello World' | reverse");
  console.log(result.stdout);

  // Combine with built-in commands
  console.log("7. Combine with built-ins (sort UUIDs):");
  result = await bash.exec("uuid -n 5 | sort");
  console.log(result.stdout);

  // Use in a pipeline
  console.log("8. Complex pipeline:");
  result = await bash.exec("lorem 3 | wordcount | grep Words");
  console.log(result.stdout);

  // Summarize command (requires AI_GATEWAY_API_KEY)
  if (process.env.AI_GATEWAY_API_KEY) {
    const url = "https://failtowin.substack.com/p/ai-automation-promises-and-pitfalls";

    console.log(`9. Summarize URL to markdown file (using @steipete/summarize-core):`);
    console.log(`   summarize ${url} > /output/summary.md\n`);

    result = await bash.exec(`summarize ${url} > /output/summary.md`);
    if (result.exitCode !== 0) {
      console.log(`   Error: ${result.stderr}`);
    } else {
      console.log("   Successfully wrote summary to /output/summary.md\n");

      // Read and display the file
      console.log("10. Contents of /output/summary.md:");
      result = await bash.exec("cat /output/summary.md");
      console.log(result.stdout);

      // Show file stats
      console.log("11. File info:");
      result = await bash.exec("wc /output/summary.md");
      console.log(`   ${result.stdout}`);
    }
  } else {
    console.log("9-11. Skipping summarize demos (set AI_GATEWAY_API_KEY to enable)\n");
  }
}

demo().catch(console.error);

