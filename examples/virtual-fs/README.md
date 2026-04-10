# Virtual Filesystem Example

Demonstrates how to create synthetic filesystems whose content is generated at
runtime by async hooks. The shell never knows the content is virtual — it just
runs `ls`, `cat`, `grep`, `wc` as usual.

## Sources Included

- **reportDbSource** — simulates a project report database. Each report is
  generated from in-memory records, as if fetched from a real DB.
- **metricsApiSource** — simulates a monitoring API. The directory tree
  (`/cpu/<node>.txt`, `/memory/<node>.txt`, `/status.json`) is computed from
  live node metrics.

## Running the Example

```bash
# Install dependencies
pnpm install

# Run the demo
pnpm start
```

## Creating Your Own Source

Use `defineVirtualFs` to create a typed factory:

```typescript
import { defineVirtualFs, VirtualFs, MountableFs, Bash } from "just-bash";

const mySource = defineVirtualFs((opts: { userId: string }) => ({
  async readFile(path) {
    // Return file content or null when not found
    return path === "/hello.txt" ? `Hello, ${opts.userId}!` : null;
  },
  async readdir(path) {
    // Return entries or null when not a directory
    if (path === "/") {
      return [{ name: "hello.txt", isFile: true, isDirectory: false }];
    }
    return null;
  },
}));

const bash = new Bash({
  fs: new MountableFs({
    mounts: [
      { mountPoint: "/data", filesystem: new VirtualFs(mySource({ userId: "alice" })) },
    ],
  }),
});

await bash.exec("cat /data/hello.txt"); // → Hello, alice!
```

## VirtualFsSource Hooks

| Hook | Required | Description |
|------|----------|-------------|
| `readFile(path)` | Yes | Return content (`string` or `Uint8Array`) or `null` |
| `readdir(path)` | Yes | Return `{ name, isFile, isDirectory }[]` or `null` |
| `stat(path)` | No | Return `FsStat` or `null` — derived from readdir/readFile when absent |
| `exists(path)` | No | Return `boolean` — derived from stat when absent |
| `dispose()` | No | Called by `VirtualFs.dispose()` to release resources |
