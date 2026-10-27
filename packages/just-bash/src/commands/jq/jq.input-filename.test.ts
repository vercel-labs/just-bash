import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq input_filename", () => {
  it.each([
    ["jq -n 'def input_filename(x): x; input_filename(7)'", "7\n"],
    ["jq -r input_filename a.json b.json", "a.json\nb.json\n"],
    ["jq -r '. as $v | input_filename' a.json", "a.json\n"],
    ["jq -nr input_filename a.json", "null\n"],
    ["echo 7 | jq -r input_filename", "<stdin>\n"],
    ["echo 7 | jq -r input_filename -", "<stdin>\n"],
    ["jq -sr input_filename a.json empty.json", "empty.json\n"],
    ["jq -Rr input_filename a.json b.json", "a.json\nb.json\n"],
    ["jq -Rsr input_filename a.json b.json", "b.json\n"],
  ])("reports the currently consumed input: %s", async (command, stdout) => {
    const bash = new Bash({
      cwd: "/data",
      files: {
        "/data/a.json": "7\n",
        "/data/b.json": "8\n",
        "/data/empty.json": "",
      },
    });
    const result = await bash.exec(command);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
