import { BashEnv } from "../BashEnv";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

let script = process.argv[2];
if (!script) {
  if (process.stdin.isTTY) {
    printUsage();
    process.exit(1);
  }
  script = await readStdin();
}

if (!script) {
  printUsage();
  process.exit(1);
}

const env = new BashEnv();
const r = await env.exec(script);
console.log("exitCode:", r.exitCode);
console.log("stderr:", JSON.stringify(r.stderr));
console.log("stdout:", JSON.stringify(r.stdout));

function printUsage() {
  console.error("Usage: pnpm dev:exec '<bash script>'");
  console.error("       echo '<script>' | pnpm dev:exec");
  console.error("       cat script.sh | pnpm dev:exec");
}
