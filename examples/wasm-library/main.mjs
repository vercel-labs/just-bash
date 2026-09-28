import { readFile } from "node:fs/promises";
import { Bash, defineWasmCommand } from "../../packages/just-bash/dist/bundle/index.js";

const bash = new Bash({
  cwd: "/project",
  files: { "/project/message.txt": "Hello from WebAssembly!\n" },
  customCommands: [defineWasmCommand("rot13", {
    wasm: new Uint8Array(await readFile(new URL("./rot13.wasm", import.meta.url))),
    adapter: new URL("./rot13-adapter.mjs", import.meta.url),
  })],
});

for (const script of [
  "rot13 message.txt > encoded.txt; cat encoded.txt",
  "cat encoded.txt | rot13",
]) {
  console.log(`$ ${script}`);
  const result = await bash.exec(script);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.exitCode !== 0) throw new Error(`rot13 exited with ${result.exitCode}`);
}
