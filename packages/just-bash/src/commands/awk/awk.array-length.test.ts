import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("awk length(array)", () => {
  it.each([
    ['BEGIN { split("a b",a," "); print length(a),a[1],a[2] }', "2 a b\n"],
    [
      'BEGIN { a["x"]=1; a["x"]=2; a["y"]=3; print length(a); delete a["x"]; print length(a); delete a["y"]; print length(a) }',
      "2\n1\n0\n",
    ],
    [
      "function count(a) { return length(a) } function relay(b) { return count(b) } BEGIN { items[1]=7; items[2]=8; print relay(items) }",
      "2\n",
    ],
    ['BEGIN { a["__proto__"]=1; a["constructor"]=2; print length(a) }', "2\n"],
    ["BEGIN { print (length(ARGV)==ARGC), (length(ENVIRON)>0) }", "1 1\n"],
    [
      'function size(x) { return length(x) } BEGIN { s="abc"; a[1]="hello"; print length(s),size(s),length(a[1]),length(1234),length("") }',
      "3 3 5 4 0\n",
    ],
    [
      'function starts_with(s,p) { return substr(s,1,length(p))==p } BEGIN { p["id"]=1; print starts_with("CPQ_x","CPQ_"),length(p) }',
      "1 1\n",
    ],
    [
      'function scalar(a) { return length(a) } function outer(a) { n=scalar("abc"); return n ":" length(a) } BEGIN { items[1]=1; items[2]=2; print outer(items) }',
      "3:2\n",
    ],
    [
      "function scalar(a) { return a } function outer(a) { return scalar(length(a)) } BEGIN { items[1]=1; items[2]=2; print outer(items) }",
      "2\n",
    ],
  ])("counts array elements without changing scalar length: %s", async (program, stdout) => {
    const result = await new Bash().exec(`awk '${program}'`);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
