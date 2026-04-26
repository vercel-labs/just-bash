import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec module resolution security", () => {
  it("should reject prototype-chain keys in require()", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(`js-exec -c "
const names = ['__proto__', 'constructor', 'toString'];
for (const name of names) {
  try {
    require(name);
    console.log(name + ':ALLOWED');
  } catch (e) {
    console.log(name + ':' + e.message);
  }
}
"`);

    expect(result.stdout).toBe(
      [
        "__proto__:Cannot find module '__proto__'. Run 'js-exec --help' for available modules.",
        "constructor:Cannot find module 'constructor'. Run 'js-exec --help' for available modules.",
        "toString:Cannot find module 'toString'. Run 'js-exec --help' for available modules.",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should reject prototype-chain keys in import()", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(`js-exec -m -c "
const names = ['__proto__', 'constructor', 'toString'];
for (const name of names) {
  try {
    await import(name);
    console.log(name + ':ALLOWED');
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    const okPrefix = \\"Cannot find module '\\" + name + \\"':\\";
    console.log(name + ':' + msg.startsWith(okPrefix));
  }
}
"`);

    expect(result.stdout).toBe(
      ["__proto__:true", "constructor:true", "toString:true", ""].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
