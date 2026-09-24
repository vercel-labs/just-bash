/** @type {import("../../packages/just-bash/dist/index.js").WasmAdapter} */
export default async function rot13(ctx) {
  if (ctx.args.length === 1 && ctx.args[0] === "--help") {
    ctx.stdout.write("Usage: rot13 [FILE]\nTransform ASCII letters; reads stdin when FILE is omitted or -.\n");
    return 0;
  }
  if (ctx.args.length > 1 || (ctx.args[0]?.startsWith("-") && ctx.args[0] !== "-")) {
    ctx.stderr.write("Usage: rot13 [FILE]\n");
    return 2;
  }

  const { exports } = await ctx.instantiate({ env: { rotation: () => 13 } });
  const { memory, buffer_ptr: pointer, buffer_capacity: capacity, transform } = exports;
  if (!(memory instanceof WebAssembly.Memory) || typeof pointer !== "function" ||
    typeof capacity !== "function" || typeof transform !== "function")
    throw new Error("Unexpected rot13 library exports");

  const address = Number(pointer());
  const size = Number(capacity());
  if (!Number.isSafeInteger(address) || address < 0 || !Number.isSafeInteger(size) ||
    size < 1 || address > memory.buffer.byteLength - size)
    throw new Error("Invalid rot13 buffer");

  const output = (bytes) => {
    for (let offset = 0; offset < bytes.length; offset += size) {
      const chunk = bytes.subarray(offset, offset + size);
      new Uint8Array(memory.buffer, address, chunk.length).set(chunk);
      transform(chunk.length);
      ctx.stdout.write(new Uint8Array(memory.buffer, address, chunk.length));
    }
  };
  if (ctx.args.length && ctx.args[0] !== "-") output(ctx.fs.readFile(ctx.args[0]));
  else for (;;) {
    const chunk = ctx.stdin.read();
    if (!chunk.length) break;
    output(chunk);
  }
  return 0;
}
