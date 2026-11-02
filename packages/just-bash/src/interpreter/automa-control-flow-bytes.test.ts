// Automa modifications: byte accounting across return and redirection unwinds.
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

const definitions = [
  "f(){ printf '\\342'; printf '\\202\\254'; return 4; }",
  "f(){ printf '\\342'; printf '\\202\\254'; return 4; } 2>&1",
  "g(){ printf '\\342'; printf '\\202\\254'; return 4; }; f(){ g; return $?; }",
  "f(){ for i in 1; do printf '\\342'; printf '\\202\\254'; return 4; done; }",
  "f(){ while true; do printf '\\342'; printf '\\202\\254'; return 4; done; }",
  "f(){ { printf '\\342'; printf '\\202\\254' >&2; return 4; } 2>&1; }",
];

describe("Automa control-flow byte accounting", () => {
  it.each(
    definitions,
  )("preserves split UTF-8 and return status at the exact budget: %s", async (definition) => {
    let observed = "";
    // Three captured bytes plus five newly printed bytes, charged once each.
    const result = await new Bash({
      executionLimits: { maxOutputSize: 8 },
    }).exec(`${definition}; x=$(f); code=$?; printf '%s:%s' "$code" "$x"`, {
      onOutput: (text) => {
        observed += text;
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.executionFailure).toBeUndefined();
    expect(result.stdout).toBe("4:€");
    expect(result.stderr).toBe("");
    expect(result.output).toBe("4:€");
    expect(observed).toBe("4:€");
  });

  it("does not reset the captured byte budget after return", async () => {
    const result = await new Bash({
      executionLimits: { maxOutputSize: 8 },
    }).exec(`${definitions[0]}; x=$(f); printf '4::%s' "$x" || echo WRONG`);
    expect(result.exitCode).toBe(126);
    expect(result.executionFailure?.limitType).toBe("output_size");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: pipeline: total output size exceeded (>8 bytes), increase executionLimits.maxOutputSize\n",
    );
  });
});
