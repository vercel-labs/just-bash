import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { assertExecResultSafe } from "../fuzzing/oracles/assertions.js";

describe("Query Engine JS RCE Format Variants", () => {
  it("blocks constructor-chain payloads across yq non-JSON/YAML parsers", async () => {
    const env = new Bash();
    const result = await env.exec(`
set +e

rm -f /tmp/jb_rce_fmt_1
rm -f /tmp/jb_rce_fmt_2
rm -f /tmp/jb_rce_fmt_3
rm -f /tmp/jb_rce_fmt_4
rm -f /tmp/jb_rce_fmt_5
rm -f /tmp/jb_rce_fmt_6

printf '[main]\\na=1\\n' | yq -p ini '.constructor.constructor("return process.mainModule.constructor._load(\\"fs\\").writeFileSync(\\"/tmp/jb_rce_fmt_1\\",\\"1\\")")()' >/tmp/jb_fmt_1.stdout 2>/tmp/jb_fmt_1.stderr
if [ -f /tmp/jb_rce_fmt_1 ]; then
  echo YQ_FMT_INI_ROOT_RCE
else
  echo YQ_FMT_INI_ROOT_BLOCKED
fi

printf '[main]\\na=1\\n' | yq -p ini '.main.constructor.constructor("return process.mainModule.constructor._load(\\"fs\\").writeFileSync(\\"/tmp/jb_rce_fmt_2\\",\\"1\\")")()' >/tmp/jb_fmt_2.stdout 2>/tmp/jb_fmt_2.stderr
if [ -f /tmp/jb_rce_fmt_2 ]; then
  echo YQ_FMT_INI_SECTION_RCE
else
  echo YQ_FMT_INI_SECTION_BLOCKED
fi

printf 'a = 1\\n' | yq -p toml '.constructor.constructor("return process.mainModule.constructor._load(\\"fs\\").writeFileSync(\\"/tmp/jb_rce_fmt_3\\",\\"1\\")")()' >/tmp/jb_fmt_3.stdout 2>/tmp/jb_fmt_3.stderr
if [ -f /tmp/jb_rce_fmt_3 ]; then
  echo YQ_FMT_TOML_ROOT_RCE
else
  echo YQ_FMT_TOML_ROOT_BLOCKED
fi

printf 'h1,h2\\n1,2\\n' | yq -p csv '.[0].constructor.constructor("return process.mainModule.constructor._load(\\"fs\\").writeFileSync(\\"/tmp/jb_rce_fmt_4\\",\\"1\\")")()' >/tmp/jb_fmt_4.stdout 2>/tmp/jb_fmt_4.stderr
if [ -f /tmp/jb_rce_fmt_4 ]; then
  echo YQ_FMT_CSV_ROW_RCE
else
  echo YQ_FMT_CSV_ROW_BLOCKED
fi

printf '<root><a>1</a></root>\\n' | yq -p xml '.root.constructor.constructor("return process.mainModule.constructor._load(\\"fs\\").writeFileSync(\\"/tmp/jb_rce_fmt_5\\",\\"1\\")")()' >/tmp/jb_fmt_5.stdout 2>/tmp/jb_fmt_5.stderr
if [ -f /tmp/jb_rce_fmt_5 ]; then
  echo YQ_FMT_XML_ROOT_RCE
else
  echo YQ_FMT_XML_ROOT_BLOCKED
fi

printf '<root><__proto__><constructor>pwn</constructor></__proto__></root>\\n' | yq -p xml '.root.constructor.constructor("return process.mainModule.constructor._load(\\"fs\\").writeFileSync(\\"/tmp/jb_rce_fmt_6\\",\\"1\\")")()' >/tmp/jb_fmt_6.stdout 2>/tmp/jb_fmt_6.stderr
if [ -f /tmp/jb_rce_fmt_6 ]; then
  echo YQ_FMT_XML_PROTO_TAG_RCE
else
  echo YQ_FMT_XML_PROTO_TAG_BLOCKED
fi
`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "YQ_FMT_INI_ROOT_BLOCKED",
        "YQ_FMT_INI_SECTION_BLOCKED",
        "YQ_FMT_TOML_ROOT_BLOCKED",
        "YQ_FMT_CSV_ROW_BLOCKED",
        "YQ_FMT_XML_ROOT_BLOCKED",
        "YQ_FMT_XML_PROTO_TAG_BLOCKED",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    assertExecResultSafe(result);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
});
