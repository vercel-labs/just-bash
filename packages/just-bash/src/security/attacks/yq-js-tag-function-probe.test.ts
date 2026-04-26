import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import type { ExecResult } from "../../types.js";
import { assertExecResultSafe } from "../fuzzing/oracles/assertions.js";

describe("YQ JS Tag Function Probe", () => {
  it("does not allow YAML js/function tags to reach JS execution via toJSON", async () => {
    const env = new Bash();
    const originalEmitWarning = process.emitWarning;
    process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
      if (
        typeof warning === "object" &&
        warning !== null &&
        "code" in warning &&
        (warning as { code?: unknown }).code === "TAG_RESOLVE_FAILED"
      ) {
        return;
      }
      if (
        typeof warning === "string" &&
        warning.includes("TAG_RESOLVE_FAILED")
      ) {
        return;
      }
      // biome-ignore lint/complexity/noBannedTypes: forwarding to overloaded process.emitWarning
      return (originalEmitWarning as Function).call(process, warning, ...rest);
    }) as typeof process.emitWarning;

    let result: ExecResult;
    try {
      result = await env.exec(`
set +e
rm -f /tmp/jb_yaml_fn_marker

cat <<'YAML' | yq 'tojson' >/tmp/jb_yq_js_tag.stdout 2>/tmp/jb_yq_js_tag.stderr
toJSON: !!js/function >
  function () {
    process.mainModule.constructor._load("fs").writeFileSync("/tmp/jb_yaml_fn_marker", "1");
    return {"ok":"yes"};
  }
probe: 1
YAML

if [ -f /tmp/jb_yaml_fn_marker ]; then
  echo YQ_JS_FUNCTION_TAG_RCE
else
  echo YQ_JS_FUNCTION_TAG_BLOCKED
fi
`);
    } finally {
      process.emitWarning = originalEmitWarning;
    }

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("YQ_JS_FUNCTION_TAG_BLOCKED\n");
    expect(result.stderr).toBe("");
    assertExecResultSafe(result);
  });
});
