import { BashEnv } from "../BashEnv.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// Only read from stdin to avoid shell expansion issues with command line args
if (process.stdin.isTTY) {
  console.error("Usage: echo '<script>' | pnpm dev:exec");
  console.error("       cat script.sh | pnpm dev:exec");
  process.exit(1);
}

const script = await readStdin();
if (!script) {
  console.error("No script provided");
  process.exit(1);
}

const env = new BashEnv();
const r = await env.exec(script);
console.log("exitCode:", r.exitCode);
console.log("stderr:", JSON.stringify(r.stderr));
console.log("stdout:", JSON.stringify(r.stdout));
