// Automa modifications: retain upstream golden output when temp files reverse.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAwkTestFile } from "./parser.js";

describe("Automa AWK spec golden extraction", () => {
  const source = readFileSync(
    new URL("./cases/T.split", import.meta.url),
    "utf8",
  );

  it.each([
    ["T.split (record assignment 1)", "b\nh\nn"],
    ["T.split (record assignment 2)", "d.e.f\nb\nj.k.l\nh\np.q.r\nn"],
  ])("extracts the original expected output for %s", (name, expected) => {
    const testCase = parseAwkTestFile(source, "T.split").testCases.find(
      (test) => test.name === name,
    );
    expect(testCase?.input).toBe("a.b.c=d.e.f\ng.h.i=j.k.l\nm.n.o=p.q.r");
    expect(testCase?.expectedOutput).toBe(expected);
  });

  it("does not reuse a previous test's expected temp file", () => {
    const parsed = parseAwkTestFile(
      `echo 'previous' > $TEMP1
$awk 'BEGIN { print "previous" }' > $TEMP2
diff $TEMP1 $TEMP2 || fail 'BAD: previous'
echo 'current' > $TEMP0
echo 'current' > $TEMP1
$awk '{ print }' $TEMP0 > $TEMP2
diff $TEMP1 $TEMP2 || fail 'BAD: current'
`,
      "T.automa",
    );
    expect(parsed.testCases.map((test) => test.expectedOutput)).toEqual([
      "previous",
      "current",
    ]);
  });
});
