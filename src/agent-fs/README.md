# AgentFs

Persistent filesystem backed by [AgentFS](https://github.com/tursodatabase/agentfs) (SQLite via Turso).

**Requires `agentfs-sdk@0.4.0-pre.6` or newer** (install with `npm install agentfs-sdk@next`).

## Usage

```typescript
import { AgentFS } from "agentfs-sdk";
import { AgentFs } from "just-bash";

const handle = await AgentFS.open({ path: ":memory:" }); // or file path
const fs = new AgentFs({ fs: handle });

await fs.writeFile("/hello.txt", "world");
const content = await fs.readFile("/hello.txt");

await handle.close();
```

## Notes

- Implements `IFileSystem` interface
- Directories created implicitly on write
- `chmod` is a no-op (AgentFS doesn't support modes)
- `symlink`/`readlink` use a JSON marker file (no native symlink support)
- `link` creates a copy (no native hard link support)
- `getAllPaths()` returns `[]` (no efficient way to enumerate)
