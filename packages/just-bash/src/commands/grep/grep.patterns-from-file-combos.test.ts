import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * `grep -f FILE` composed with the other selection flags. The `-F -x -f` and
 * `-v -f` combinations are the set-intersection / set-difference idioms called
 * out in issue #322. Expectations verified against GNU grep 3.12.
 */
const setFiles = {
  "/list.txt": "apple\nbanana\ncherry\n",
  "/keep.txt": "banana\ndate\napple\n",
};

const searchFiles = {
  "/pat.txt": "apple\nbanana\n",
  "/p1.txt": "apple\n",
  "/hay.txt": "apple pie\ncherry\nbanana split\n",
  "/hay2.txt": "x\ny\n",
};

describe("grep -f set operations", () => {
  it("intersects two line sets with -F -x -f", async () => {
    const env = new Bash({ files: setFiles });
    const result = await env.exec("grep -F -x -f /keep.txt /list.txt");
    expect(result.stdout).toBe("apple\nbanana\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("subtracts one line set from another with -F -x -v -f", async () => {
    const env = new Bash({ files: setFiles });
    const result = await env.exec("grep -F -x -v -f /keep.txt /list.txt");
    expect(result.stdout).toBe("cherry\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("counts the intersection with -F -x -c -f", async () => {
    const env = new Bash({ files: setFiles });
    const result = await env.exec("grep -F -x -c -f /keep.txt /list.txt");
    expect(result.stdout).toBe("2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("anchors every alternative with -x, not just the first", async () => {
    const env = new Bash({
      files: {
        "/pat.txt": "foo\nbar\n",
        "/data.txt": "foo\nbar\nfoobar\nfoo suffix\nprefix bar\n",
      },
    });
    const result = await env.exec("grep -x -f /pat.txt /data.txt");
    expect(result.stdout).toBe("foo\nbar\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("inverts the union of all file patterns with -v", async () => {
    const env = new Bash({ files: searchFiles });
    const result = await env.exec("grep -v -f /pat.txt /hay.txt");
    expect(result.stdout).toBe("cherry\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("grep -f with matching modifiers", () => {
  it("applies -i to every pattern", async () => {
    const env = new Bash({
      files: { "/p1.txt": "apple\n", "/caps.txt": "APPLE PIE\nApple\nnope\n" },
    });
    const result = await env.exec("grep -i -f /p1.txt /caps.txt");
    expect(result.stdout).toBe("APPLE PIE\nApple\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("applies -w to every pattern", async () => {
    const env = new Bash({
      files: {
        "/p1.txt": "apple\n",
        "/words.txt": "apple\npineapple\napple pie\n",
      },
    });
    const result = await env.exec("grep -w -f /p1.txt /words.txt");
    expect(result.stdout).toBe("apple\napple pie\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps every -F pattern literal", async () => {
    const env = new Bash({
      files: {
        "/meta.txt": "a.b\nx*y\n",
        "/metahay.txt": "a.b\naxb\nx*y\nxy\n",
      },
    });
    const result = await env.exec("grep -F -f /meta.txt /metahay.txt");
    expect(result.stdout).toBe("a.b\nx*y\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("treats every pattern as a BRE by default", async () => {
    const env = new Bash({
      files: {
        "/meta.txt": "a.b\nx*y\n",
        "/metahay.txt": "a.b\naxb\nx*y\nxy\n",
      },
    });
    const result = await env.exec("grep -f /meta.txt /metahay.txt");
    expect(result.stdout).toBe("a.b\naxb\nx*y\nxy\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("supports BRE alternation inside a single file pattern", async () => {
    const env = new Bash({
      files: { ...setFiles, "/bre.txt": "apple\\|cherry\n" },
    });
    const result = await env.exec("grep -f /bre.txt /list.txt");
    expect(result.stdout).toBe("apple\ncherry\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("treats every pattern as an ERE with -E", async () => {
    const env = new Bash({
      files: { ...setFiles, "/ere.txt": "^a.+e$\nch.rry\n" },
    });
    const result = await env.exec("grep -E -f /ere.txt /list.txt");
    expect(result.stdout).toBe("apple\ncherry\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("grep -f with output modifiers", () => {
  it("prints only the matched text with -o", async () => {
    const env = new Bash({ files: searchFiles });
    const result = await env.exec("grep -o -f /pat.txt /hay.txt");
    expect(result.stdout).toBe("apple\nbanana\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("counts matching lines with -c", async () => {
    const env = new Bash({ files: searchFiles });
    const result = await env.exec("grep -c -f /pat.txt /hay.txt");
    expect(result.stdout).toBe("2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("lists only matching file names with -l", async () => {
    const env = new Bash({ files: searchFiles });
    const result = await env.exec("grep -l -f /pat.txt /hay.txt /hay2.txt");
    expect(result.stdout).toBe("/hay.txt\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prefixes file names when several files are searched", async () => {
    const env = new Bash({ files: searchFiles });
    const result = await env.exec("grep -f /p1.txt /hay.txt /hay2.txt");
    expect(result.stdout).toBe("/hay.txt:apple pie\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("suppresses the file name prefix with -h", async () => {
    const env = new Bash({ files: searchFiles });
    const result = await env.exec("grep -h -f /p1.txt /hay.txt /hay2.txt");
    expect(result.stdout).toBe("apple pie\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("stops after -m matches", async () => {
    const env = new Bash({ files: searchFiles });
    const result = await env.exec("grep -m1 -f /pat.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints trailing context with -A", async () => {
    const env = new Bash({ files: searchFiles });
    const result = await env.exec("grep -A1 -f /p1.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\ncherry\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("searches recursively with -r", async () => {
    const env = new Bash({
      files: { "/p1.txt": "apple\n", "/sub/f1.txt": "apple tree\nnope\n" },
    });
    const result = await env.exec("grep -r -f /p1.txt /sub");
    expect(result.stdout).toBe("/sub/f1.txt:apple tree\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("stays quiet with -q", async () => {
    const env = new Bash({ files: searchFiles });
    const result = await env.exec("grep -q -f /pat.txt /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("reports no match with -q and exit 1", async () => {
    const env = new Bash({ files: searchFiles });
    const result = await env.exec("grep -q -f /p1.txt /hay2.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });
});
