import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec TypeScript type stripping", () => {
  it(
    "should strip types from .ts files with various type constructs",
    { timeout: 30000 },
    async () => {
      const env = new Bash({
        javascript: true,
        files: {
          // Interface + type annotation
          "/home/user/iface.ts": `
interface User {
  name: string;
  age: number;
}
const user: User = { name: "Alice", age: 30 };
console.log(user.name);
`,
          // Type alias
          "/home/user/alias.ts": `
type ID = string | number;
const id: ID = 42;
console.log(id);
`,
          // Generic function
          "/home/user/generic.ts": `
function identity<T>(x: T): T { return x; }
console.log(identity("hello"));
`,
          // As-expression
          "/home/user/as-expr.ts": `
const x = "hello" as string;
console.log(x);
`,
        },
      });

      // Interface + type annotation
      const r1 = await env.exec("js-exec /home/user/iface.ts");
      expect(r1.stdout).toBe("Alice\n");
      expect(r1.exitCode).toBe(0);

      // Type alias
      const r2 = await env.exec("js-exec /home/user/alias.ts");
      expect(r2.stdout).toBe("42\n");
      expect(r2.exitCode).toBe(0);

      // Generic function
      const r3 = await env.exec("js-exec /home/user/generic.ts");
      expect(r3.stdout).toBe("hello\n");
      expect(r3.exitCode).toBe(0);

      // As-expression
      const r4 = await env.exec("js-exec /home/user/as-expr.ts");
      expect(r4.stdout).toBe("hello\n");
      expect(r4.exitCode).toBe(0);
    },
  );

  it("should auto-detect module + strip for .mts files", async () => {
    const env = new Bash({
      javascript: true,
      files: {
        "/home/user/utils.mts": `
export function add(a: number, b: number): number {
  return a + b;
}
`,
        "/home/user/main.mts": `
import { add } from './utils.mts';
const result: number = add(1, 2);
console.log(result);
`,
      },
    });
    const result = await env.exec("js-exec /home/user/main.mts");
    expect(result.stdout).toBe("3\n");
    expect(result.exitCode).toBe(0);
  });

  it("should support --strip-types and --module flags", async () => {
    const env = new Bash({
      javascript: true,
      files: {
        "/etc/hostname": "myhost\n",
      },
    });

    // --strip-types inline
    const r1 = await env.exec(
      `js-exec --strip-types -c "const x: number = 5; console.log(x)"`,
    );
    expect(r1.stdout).toBe("5\n");
    expect(r1.exitCode).toBe(0);

    // --module --strip-types combined
    const r2 = await env.exec(
      `js-exec --module --strip-types -c "import { readFileSync } from 'fs'; const content: string = readFileSync('/etc/hostname'); console.log(content.trim())"`,
    );
    expect(r2.stdout).toBe("myhost\n");
    expect(r2.exitCode).toBe(0);
  });

  it("should handle .ts importing .ts with types", async () => {
    const env = new Bash({
      javascript: true,
      files: {
        "/home/user/types.ts": `
export interface Config {
  host: string;
  port: number;
}
export function makeConfig(host: string, port: number): Config {
  return { host, port };
}
`,
        "/home/user/app.ts": `
import { makeConfig } from './types.ts';
const cfg = makeConfig("localhost", 8080);
console.log(cfg.host + ":" + cfg.port);
`,
      },
    });
    const result = await env.exec("js-exec /home/user/app.ts");
    expect(result.stdout).toBe("localhost:8080\n");
    expect(result.exitCode).toBe(0);
  });
});
