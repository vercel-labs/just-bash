/**
 * Cap guest-owned memory and tables BEFORE instantiation. Worker heap limits do
 * not bound WebAssembly linear memory. Only ordinary wasm32 command modules
 * are accepted. Library adapters may supply bounded imported memories/tables.
 */
class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.offset >= this.bytes.length)
      throw new Error("Truncated WASM module");
    return this.bytes[this.offset++];
  }

  u32(): number {
    let result = 0;
    for (let i = 0; i < 5; i++) {
      const value = this.byte();
      if (i === 4 && value > 15) throw new Error("Invalid WASM integer");
      result += (value & 127) * 2 ** (i * 7);
      if (!(value & 128)) return result;
    }
    throw new Error("Invalid WASM integer");
  }

  take(length: number): Uint8Array {
    if (length > this.bytes.length - this.offset)
      throw new Error("Truncated WASM section");
    const bytes = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }
}

function leb(value: number): number[] {
  const bytes: number[] = [];
  do {
    const next = value & 127;
    value = Math.floor(value / 128);
    bytes.push(next | (value ? 128 : 0));
  } while (value);
  return bytes;
}

function capLimits(reader: Reader, maximum: number): number[] {
  const flags = reader.u32();
  if (flags !== 0 && flags !== 1)
    throw new Error("Only unshared wasm32 memory and tables are supported");
  const minimum = reader.u32();
  const declaredMaximum = flags ? reader.u32() : maximum;
  if (minimum > maximum)
    throw new Error("WASM initial allocation exceeds configured limit");
  if (declaredMaximum < minimum) throw new Error("Invalid WASM limits");
  return [1, ...leb(minimum), ...leb(Math.min(maximum, declaredMaximum))];
}

export function limitModule(
  bytes: Uint8Array,
  maxMemoryBytes: number,
  maxTableElements: number,
  mode: "wasi" | "library" = "wasi",
): Uint8Array<ArrayBuffer> {
  const reader = new Reader(bytes);
  const header = reader.take(8);
  if (header.join(",") !== "0,97,115,109,1,0,0,0")
    throw new Error("Expected a WebAssembly core module");
  const chunks: Uint8Array[] = [header];
  let memories = 0;
  let tables = 0;
  while (reader.offset < bytes.length) {
    const id = reader.byte();
    const section = reader.take(reader.u32());
    let content = section;
    if (id === 2) {
      const entries = new Reader(section);
      const count = entries.u32();
      const imports: Uint8Array[] = [new Uint8Array(leb(count))];
      for (let i = 0; i < count; i++) {
        const begin = entries.offset;
        // Module and field names are length-prefixed UTF-8 strings.
        entries.take(entries.u32());
        entries.take(entries.u32());
        const kind = entries.byte();
        if (kind === 1 || kind === 2) {
          if (mode === "wasi")
            throw new Error("WASI commands cannot import memories or tables");
          if (kind === 1) {
            tables++;
            if (entries.byte() !== 0x70)
              throw new Error("Only funcref tables are supported");
          } else memories++;
          imports.push(section.subarray(begin, entries.offset));
          imports.push(
            new Uint8Array(
              capLimits(
                entries,
                kind === 2
                  ? Math.floor(maxMemoryBytes / 65536)
                  : maxTableElements,
              ),
            ),
          );
        } else {
          if (kind === 0) entries.u32();
          else if (kind === 3) {
            if (
              ![0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f].includes(
                entries.byte(),
              ) ||
              entries.byte() > 1
            )
              throw new Error("Unsupported WASM global import type");
          } else throw new Error("Unsupported WASM import kind");
          imports.push(section.subarray(begin, entries.offset));
        }
      }
      if (entries.offset !== section.length)
        throw new Error("Invalid WASM import section");
      content = concat(imports);
    }
    if (id === 5 || id === 4) {
      const entries = new Reader(section);
      const count = entries.u32();
      if (id === 5) memories += count;
      else tables += count;
      if (memories > 1 || tables > 1)
        throw new Error(
          "At most one memory and one function table are supported",
        );
      const replacement = leb(count);
      for (let i = 0; i < count; i++) {
        if (id === 4) {
          const type = entries.byte();
          if (type !== 0x70)
            throw new Error("Only funcref tables are supported");
          replacement.push(type);
        }
        replacement.push(
          ...capLimits(
            entries,
            id === 5 ? Math.floor(maxMemoryBytes / 65536) : maxTableElements,
          ),
        );
      }
      if (entries.offset !== section.length)
        throw new Error("Invalid WASM limits section");
      content = new Uint8Array(replacement);
    }
    // WASI commands start explicitly via _start, after their memory is wired.
    if (id === 8 && mode === "wasi")
      throw new Error(
        "WASM start sections are not supported; export _start instead",
      );
    chunks.push(new Uint8Array([id, ...leb(content.length)]), content);
  }
  if (memories > 1 || tables > 1)
    throw new Error("At most one memory and one function table are supported");
  if (mode === "wasi" && memories !== 1)
    throw new Error("WASI commands must define one linear memory");
  return concat(chunks);
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
