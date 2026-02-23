import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec ESM modules", () => {
  it(
    "should handle multi-file imports and virtual modules",
    { timeout: 30000 },
    async () => {
      const env = new Bash({
        javascript: true,
        env: { MY_VAR: "test123" },
        files: {
          // Named export
          "/home/user/utils.mjs":
            "export function greet(name) { return 'hello ' + name; }\n",
          "/home/user/main.mjs":
            "import { greet } from './utils.mjs';\nconsole.log(greet('world'));\n",
          // Default export
          "/home/user/data.mjs": "export default 42;\n",
          "/home/user/main2.mjs":
            "import val from './data.mjs';\nconsole.log(val);\n",
          // Virtual fs module
          "/home/user/test-fs.mjs":
            "import { readFile } from 'fs';\nconsole.log(readFile('/etc/hostname'));\n",
          "/etc/hostname": "testhost\n",
          // Virtual fs default
          "/home/user/test-fs-default.mjs":
            "import fs from 'fs';\nconsole.log(fs.exists('/etc/hostname'));\n",
          // child_process module (idiomatic)
          "/home/user/test-exec.mjs":
            "import { execSync } from 'node:child_process';\nconsole.log(execSync('echo hi').trim());\n",
          // Globals (process, env, console) accessible without import
          "/home/user/test-process.mjs":
            "console.log(typeof process.cwd);\nexport {};\n",
          "/home/user/test-env.mjs":
            "console.log(process.env.MY_VAR);\nexport {};\n",
          "/home/user/test-console.mjs":
            "console.log('from import');\nexport {};\n",
        },
      });

      // Named import
      const r1 = await env.exec("js-exec /home/user/main.mjs");
      expect(r1.stdout).toBe("hello world\n");
      expect(r1.exitCode).toBe(0);

      // Default import
      const r2 = await env.exec("js-exec /home/user/main2.mjs");
      expect(r2.stdout).toBe("42\n");
      expect(r2.exitCode).toBe(0);

      // fs named import
      const r3 = await env.exec("js-exec /home/user/test-fs.mjs");
      expect(r3.stdout).toBe("testhost\n\n");
      expect(r3.exitCode).toBe(0);

      // fs default import
      const r4 = await env.exec("js-exec /home/user/test-fs-default.mjs");
      expect(r4.stdout).toBe("true\n");
      expect(r4.exitCode).toBe(0);

      // exec module
      const r5 = await env.exec("js-exec /home/user/test-exec.mjs");
      expect(r5.stdout).toBe("hi\n");
      expect(r5.exitCode).toBe(0);

      // process module
      const r6 = await env.exec("js-exec /home/user/test-process.mjs");
      expect(r6.stdout).toBe("function\n");
      expect(r6.exitCode).toBe(0);

      // env module
      const r7 = await env.exec("js-exec /home/user/test-env.mjs");
      expect(r7.stdout).toBe("test123\n");
      expect(r7.exitCode).toBe(0);

      // console module
      const r8 = await env.exec("js-exec /home/user/test-console.mjs");
      expect(r8.stdout).toBe("from import\n");
      expect(r8.exitCode).toBe(0);
    },
  );

  it("should resolve relative paths and handle errors", async () => {
    const env = new Bash({
      javascript: true,
      files: {
        // ./relative
        "/home/user/lib/helper.mjs": "export const value = 'from-helper';\n",
        "/home/user/lib/main.mjs":
          "import { value } from './helper.mjs';\nconsole.log(value);\n",
        // ../parent
        "/home/user/shared.mjs": "export const x = 99;\n",
        "/home/user/sub/main.mjs":
          "import { x } from '../shared.mjs';\nconsole.log(x);\n",
        // Missing module
        "/home/user/bad.mjs":
          "import { foo } from './nonexistent.mjs';\nconsole.log(foo);\n",
      },
    });

    // ./relative
    const r1 = await env.exec("js-exec /home/user/lib/main.mjs");
    expect(r1.stdout).toBe("from-helper\n");
    expect(r1.exitCode).toBe(0);

    // ../parent
    const r2 = await env.exec("js-exec /home/user/sub/main.mjs");
    expect(r2.stdout).toBe("99\n");
    expect(r2.exitCode).toBe(0);

    // Missing module
    const r3 = await env.exec("js-exec /home/user/bad.mjs");
    expect(r3.exitCode).not.toBe(0);
    expect(r3.stderr).toBeTruthy();
  });

  it("should support --module flag and auto-detection", async () => {
    const env = new Bash({
      javascript: true,
      files: {
        "/etc/hostname": "myhost\n",
        "/home/user/test.mjs":
          "const x = 42;\nexport default x;\nconsole.log(x);\n",
      },
    });

    // -m flag with inline code
    const r1 = await env.exec(
      `js-exec -m -c "import { readFile } from 'fs'; console.log(readFile('/etc/hostname').trim())"`,
    );
    expect(r1.stdout).toBe("myhost\n");
    expect(r1.exitCode).toBe(0);

    // --module flag with global
    const r2 = await env.exec(`js-exec --module -c "console.log('ok')"`);
    expect(r2.stdout).toBe("ok\n");
    expect(r2.exitCode).toBe(0);

    // Auto-detect .mjs
    const r3 = await env.exec("js-exec /home/user/test.mjs");
    expect(r3.stdout).toBe("42\n");
    expect(r3.exitCode).toBe(0);
  });

  it("should handle transitive imports", async () => {
    const env = new Bash({
      javascript: true,
      files: {
        "/home/user/c.mjs": "export const val = 'deep';\n",
        "/home/user/b.mjs":
          "import { val } from './c.mjs';\nexport const msg = val + '-chain';\n",
        "/home/user/a.mjs":
          "import { msg } from './b.mjs';\nconsole.log(msg);\n",
      },
    });
    const result = await env.exec("js-exec /home/user/a.mjs");
    expect(result.stdout).toBe("deep-chain\n");
    expect(result.exitCode).toBe(0);
  });
});
