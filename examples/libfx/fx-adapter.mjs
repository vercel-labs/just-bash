import { createFxAgent, supportsJspi } from "libfx/wasm";

/** @type {import("just-bash").WasmAdapter} */
export default async function fx(ctx) {
  if (ctx.args.length === 1 && ctx.args[0] === "--help") {
    ctx.stdout.write('Usage: fx "PROMPT" (optional context from stdin)\n');
    return;
  }
  if (ctx.args.length !== 1 || !ctx.args[0].trim() || ctx.args[0].startsWith("-")) {
    ctx.stderr.write('Usage: fx "PROMPT" (optional context from stdin)\n');
    return 2;
  }
  if (!supportsJspi()) {
    throw new Error("libfx requires JSPI; start Node with --experimental-wasm-jspi");
  }

  const decoder = new TextDecoder();
  const input = decoder.decode(ctx.stdin.readAll());
  const agent = await createFxAgent({
    // The SDK instantiates this module once and supplies its WASI/JSPI imports.
    wasm: ctx.module,
    apiKey: ctx.env.get("AI_GATEWAY_API_KEY"),
    model: ctx.env.get("FX_MODEL"),
    instructions: "Answer concisely. Use read_file when you need a file's contents.",
    tools: [
      {
        name: "read_file",
        description: "Read a UTF-8 file from the shell's virtual filesystem.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        },
        execute(input) {
          if (typeof input?.path !== "string")
            throw new Error("path must be a string");
          return decoder.decode(ctx.fs.readFile(input.path));
        },
      },
    ],
  });
  try {
    const prompt = input ? `${ctx.args[0]}\n\nStdin:\n${input}` : ctx.args[0];
    const turn = agent.prompt(prompt);
    for await (const event of turn) {
      if (event.type === "text_delta") ctx.stdout.write(event.delta);
    }
    const { stopReason } = await turn.result;
    ctx.stdout.write("\n");
    if (stopReason !== "end_turn") {
      ctx.stderr.write(`fx: turn stopped: ${stopReason}\n`);
      return 1;
    }
  } finally {
    await agent.close();
  }
}
