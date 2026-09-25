# A WASM library as a shell command

`rot13.c` is a small freestanding WebAssembly library. It exports a buffer and
a transform function and imports `env.rotation`. It has no `_start` or WASI
imports. `rot13-adapter.mjs` supplies the import and connects the exports to
shell arguments, stdin, stdout, and virtual files.

From the repository root:

```bash
pnpm install
pnpm --filter just-bash build
node examples/wasm-library/main.mjs
```

This repository example imports the local build. In your application, import
`Bash` and `defineWasmCommand` from `just-bash`. The library and adapter add no
third-party dependencies.

The expected output is:

```text
$ rot13 message.txt > encoded.txt; cat encoded.txt
Uryyb sebz JroNffrzoyl!
$ cat encoded.txt | rot13
Hello from WebAssembly!
```

The compiled library is included. To rebuild it with Zig 0.16.0:

```bash
zig cc -target wasm32-freestanding -O2 -nostdlib -Wl,--no-entry -Wl,--export=buffer_ptr -Wl,--export=buffer_capacity -Wl,--export=transform -Wl,--export-memory examples/wasm-library/rot13.c -o examples/wasm-library/rot13.wasm
```

## Adapter contract

An adapter is a trusted JavaScript module with a default-exported function.
Register its **absolute module URL** in the host application. It is imported
inside a disposable worker for every command invocation; Node uses a local
`file:` URL, and browsers use a served HTTP(S) module URL. Compile TypeScript
adapters to JavaScript and bundle their dependencies as needed.

The function receives a `WasmAdapterContext`:

- `name`, `args`, `cwd`, `env`: command name, arguments excluding the command
  name, shell working directory, and exported environment as a `ReadonlyMap`.
- `instantiate(imports)`: instantiate the supplied binary once, with bounded
  memory/table declarations and explicit imports. Returns a WebAssembly instance.
- `module`: the compiled module with the same memory/table bounds, for SDKs
  that instantiate internally. The adapter must ensure one instance is created.
- `stdin.read()` / `stdin.readAll()`: bytes from the pipeline. `readAll()` is
  bounded by `maxFileBytes`; `read()` transfers at most 64 KiB.
- `stdout.write(data)` / `stderr.write(data)`: accept strings or byte arrays.
  Stdout preserves binary data; stderr is decoded as UTF-8 text.
- `fs`: synchronous virtual file operations. Relative paths use the shell cwd.
- `wasi`: optional Preview 1 imports, `start(instance)` for commands, and
  `initialize(instance)` for reactors. Supply `wasi_snapshot_preview1: ctx.wasi.imports`
  to `instantiate()` when the library requires them.
- `limits`: the resolved module, memory, table, file, and deadline limits.

Return an unsigned 32-bit exit code, or return nothing for success. Exceptions
produce exit 126. The worker is terminated on completion, timeout, or abort.

Adapters can supply function/global imports and bounded memory/table imports.
For an imported memory, declare a `maximum` no larger than
`Math.floor(ctx.limits.maxMemoryBytes / 65536)`; honor the binary's own limit if
it is stricter. WebAssembly's import matching enforces compatibility. Shared
memory, memory64, components, and multiple memories/tables are unsupported.

Adapter modules are trusted host code. Their imports define the guest's
capabilities, so validate pointers and lengths received from WASM callbacks.
The runner's memory limits cover its supplied module; arbitrary allocations or
external operations performed by adapter JavaScript remain the host's
responsibility. An SDK that instantiates WASM internally can consume `ctx.module`
to retain the module's memory/table bounds per instance. The runner does not
enforce an instantiation count through the SDK.

The [libfx example](../libfx/README.md) demonstrates this SDK integration.
WASI Preview 1 command binaries work with `defineWasmCommand`'s default adapter.
See the [API documentation](../../packages/just-bash/README.md#webassembly-commands).
