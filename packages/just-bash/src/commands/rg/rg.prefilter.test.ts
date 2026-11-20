import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * rg skips files and lines that lack a pattern's required literals before
 * RE2 runs. These cases pin output where a wrong requirement would drop a
 * match or a line rg must still print.
 */

const files = {
  "/w/a.txt": "abbbc\nbarbaz\nupdate the product\nproduct only\n",
  "/w/b.txt": "nothing here\nat all\n",
  "/w/fold.txt": "ſAP order\nKelvin scale\nplain\n",
  "/w/dotted.txt": "İ\nI\n",
};

async function rg(command: string) {
  const bash = new Bash({ cwd: "/w", files });
  return bash.exec(command);
}

describe("rg required-literal prefilter", () => {
  it("keeps matches whose literals sit around a repetition", async () => {
    const result = await rg("rg -n 'ab+c|(foo)?barbaz' a.txt");
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "1:abbbc\n2:barbaz\n",
      stderr: "",
    });
  });

  it("needs every literal of an alternative on the line", async () => {
    const result = await rg("rg 'product.*update|update.*product' a.txt");
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "update the product\n",
      stderr: "",
    });
  });

  it("folds case as RE2 does for the long s and the Kelvin sign", async () => {
    const result = await rg("rg -i 'sap|kelvin' fold.txt");
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "ſAP order\nKelvin scale\n",
      stderr: "",
    });
  });

  it("leaves a non-ASCII line to RE2 under -i, which does not fold İ to i", async () => {
    const result = await rg("rg -n -i i dotted.txt");
    expect(result).toMatchObject({ exitCode: 0, stdout: "2:I\n", stderr: "" });
  });

  it("reports match positions with -o and --column", async () => {
    const result = await rg("rg -o --column 'product|upd.te' a.txt");
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "3:1:update\n3:12:product\n4:1:product\n",
      stderr: "",
    });
  });

  it("prints every line of a file without the literal under -v", async () => {
    const result = await rg("rg -v needle b.txt");
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "nothing here\nat all\n",
      stderr: "",
    });
  });

  it("prints the lines without the literal under --passthru", async () => {
    const result = await rg("rg --passthru -n only a.txt");
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "1-abbbc\n2-barbaz\n3-update the product\n4:product only\n",
      stderr: "",
    });
  });

  it("counts and lists only the files that match", async () => {
    expect(await rg("rg -c product")).toMatchObject({
      exitCode: 0,
      stdout: "a.txt:2\n",
      stderr: "",
    });
    expect(await rg("rg --files-without-match product")).toMatchObject({
      exitCode: 0,
      stdout: "b.txt\ndotted.txt\nfold.txt\n",
      stderr: "",
    });
  });

  it("keeps context lines around a match", async () => {
    const result = await rg("rg -n -C1 'pro.uct only' a.txt");
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "3-update the product\n4:product only\n",
      stderr: "",
    });
  });
});
