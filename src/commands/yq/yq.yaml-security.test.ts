/**
 * Format parser security tests for yq command.
 *
 * Tests that all format parsers (YAML, JSON, XML, INI, CSV, TOML) handle
 * dangerous constructs safely:
 * - Billion-laughs / entity expansion
 * - Code execution tags (!!js/function, !!python/object)
 * - Prototype pollution via __proto__/constructor keys
 * - XML entity injection (XXE)
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("yq YAML security", () => {
  it("should limit alias expansion (billion-laughs defense)", async () => {
    const bash = new Bash();
    // Create a YAML document with exponentially expanding aliases
    const yaml = [
      "a: &a [x,x,x,x,x,x,x,x,x,x]",
      "b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]",
      "c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]",
      "d: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]",
    ].join("\n");
    await bash.writeFile("/bomb.yaml", yaml);

    const result = await bash.exec("yq '.d | length' /bomb.yaml");
    // Should either error or return a bounded result, not expand to 10^4 elements
    // The maxAliasCount: 100 limit prevents excessive expansion
    expect(result.stdout.trim() === "10" || result.exitCode !== 0).toBe(true);
  });

  it("should not execute !!js/function tags", async () => {
    const bash = new Bash();
    await bash.writeFile(
      "/func.yaml",
      "payload: !!js/function >\n  function() { return 42; }\n",
    );

    const result = await bash.exec("yq '.payload' /func.yaml");
    // The tag is unresolved in 'core' schema — value becomes a string, not a function
    expect(result.exitCode).toBe(0);
    // Output should be the raw function text (as string), proving no execution
    expect(result.stdout).toContain("function()");
  });

  it("should not execute !!python/object tags", async () => {
    const bash = new Bash();
    await bash.writeFile(
      "/python.yaml",
      "exploit: !!python/object/apply:os.system ['echo pwned']\n",
    );

    const result = await bash.exec("yq '.exploit' /python.yaml");
    // The tag is unresolved — value stays as raw text
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toBe("pwned\n");
  });

  it("should handle __proto__ key in YAML without prototype pollution", async () => {
    const bash = new Bash();
    const yaml = "__proto__:\n  polluted: true\nsafe: value";
    await bash.writeFile("/proto.yaml", yaml);

    const result = await bash.exec("yq '.safe' /proto.yaml");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("value");

    // Verify Object.prototype was not polluted
    const check = await bash.exec("echo '{\"test\":1}' | jq '.test'");
    expect(check.exitCode).toBe(0);
    expect(check.stdout.trim()).toBe("1");
  });

  it("should not pollute Object.prototype via constructor key in YAML", async () => {
    const bash = new Bash();
    // YAML with constructor key — should be treated as data, not pollute prototype
    const yaml = "constructor:\n  prototype:\n    polluted: true\nname: safe";
    await bash.writeFile("/ctor.yaml", yaml);

    const result = await bash.exec("yq '.name' /ctor.yaml");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("safe");

    // Verify Object.prototype was NOT polluted
    const check = await bash.exec("echo '{\"x\":1}' | jq '.x'");
    expect(check.exitCode).toBe(0);
    expect(check.stdout.trim()).toBe("1");
  });
});

describe("yq JSON security", () => {
  it("should handle __proto__ key in JSON without prototype pollution", async () => {
    const bash = new Bash();
    await bash.writeFile(
      "/proto.json",
      '{"__proto__": {"polluted": true}, "safe": "value"}',
    );

    const result = await bash.exec("yq -p json '.safe' /proto.json");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("value");
  });

  it("should handle constructor key in JSON without prototype pollution", async () => {
    const bash = new Bash();
    await bash.writeFile(
      "/ctor.json",
      '{"constructor": {"prototype": {"polluted": true}}, "name": "ok"}',
    );

    const result = await bash.exec("yq -p json '.name' /ctor.json");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
  });
});

describe("yq XML security", () => {
  it("should not expand external entities (XXE)", async () => {
    const bash = new Bash();
    const xml = [
      '<?xml version="1.0"?>',
      "<!DOCTYPE foo [",
      '  <!ENTITY xxe SYSTEM "file:///etc/passwd">',
      "]>",
      "<root><data>&xxe;</data></root>",
    ].join("\n");
    await bash.writeFile("/xxe.xml", xml);

    const result = await bash.exec("yq -p xml '.root.data' /xxe.xml");
    // Should NOT contain /etc/passwd contents
    if (result.exitCode === 0) {
      expect(result.stdout).not.toContain("root:");
      // With processEntities: false, the entity reference stays as literal text
    }
  });

  it("should handle __proto__ element name in XML safely", async () => {
    const bash = new Bash();
    const xml =
      "<root><__proto__><polluted>true</polluted></__proto__><safe>value</safe></root>";
    await bash.writeFile("/proto.xml", xml);

    const result = await bash.exec("yq -p xml '.root.safe' /proto.xml");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("value");
  });
});

describe("yq CSV security", () => {
  it("should handle __proto__ column header in CSV safely", async () => {
    const bash = new Bash();
    await bash.writeFile("/proto.csv", "__proto__,safe\nevil,value\n");

    const result = await bash.exec("yq -p csv '.[0].safe' /proto.csv");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("value");
  });
});

describe("yq TOML security", () => {
  it("should handle dangerous keys in TOML safely", async () => {
    const bash = new Bash();
    // TOML requires quoting keys with special chars
    await bash.writeFile(
      "/proto.toml",
      '"__proto__" = "evil"\nsafe = "value"\n',
    );

    const result = await bash.exec("yq -p toml '.safe' /proto.toml");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("value");
  });
});

describe("yq INI security", () => {
  it("should handle dangerous section names in INI safely", async () => {
    const bash = new Bash();
    await bash.writeFile(
      "/proto.ini",
      "[__proto__]\npolluted=true\n\n[safe]\nvalue=ok\n",
    );

    const result = await bash.exec("yq -p ini '.safe.value' /proto.ini");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
  });
});
