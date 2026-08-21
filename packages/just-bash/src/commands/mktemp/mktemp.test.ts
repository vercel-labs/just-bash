import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/** Run a command and return its trimmed stdout, asserting a clean exit. */
async function run(env: Bash, script: string): Promise<string> {
  const result = await env.exec(script);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  return result.stdout.replace(/\n$/, "");
}

describe("mktemp", () => {
  it("should create a file in /tmp and print its path", async () => {
    const env = new Bash();
    const path = await run(env, "mktemp");
    expect(path).toMatch(/^\/tmp\/tmp\.[0-9A-Za-z]{10}$/);

    const stat = await env.exec(`stat -c '%F %a %s' ${path}`);
    expect(stat.stdout).toBe("regular file 600 0\n");
    expect(stat.stderr).toBe("");
    expect(stat.exitCode).toBe(0);
  });

  it("should create a directory with -d", async () => {
    const env = new Bash();
    const path = await run(env, "mktemp -d");
    expect(path).toMatch(/^\/tmp\/tmp\.[0-9A-Za-z]{10}$/);

    const stat = await env.exec(`stat -c '%F %a' ${path}`);
    expect(stat.stdout).toBe("directory 700\n");
    expect(stat.stderr).toBe("");
    expect(stat.exitCode).toBe(0);
  });

  it("should accept --directory as the long form of -d", async () => {
    const env = new Bash();
    const path = await run(env, "mktemp --directory");
    const stat = await env.exec(`stat -c '%F' ${path}`);
    expect(stat.stdout).toBe("directory\n");
  });

  it("should return a different path on each call", async () => {
    const env = new Bash();
    const first = await run(env, "mktemp");
    const second = await run(env, "mktemp");
    expect(first).not.toBe(second);

    const ls = await env.exec("ls /tmp");
    expect(ls.stdout.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("should honour TMPDIR when set", async () => {
    const env = new Bash();
    const path = await run(env, "mkdir -p /sandbox && TMPDIR=/sandbox mktemp");
    expect(path).toMatch(/^\/sandbox\/tmp\.[0-9A-Za-z]{10}$/);

    const ls = await env.exec("ls /tmp");
    expect(ls.stdout).toBe("");
  });

  it("should fall back to /tmp when TMPDIR is empty", async () => {
    const env = new Bash();
    const path = await run(env, "TMPDIR= mktemp");
    expect(path).toMatch(/^\/tmp\/tmp\./);
  });

  it("should honour -p DIR", async () => {
    const env = new Bash();
    const path = await run(env, "mkdir -p /work && mktemp -p /work");
    expect(path).toMatch(/^\/work\/tmp\.[0-9A-Za-z]{10}$/);
  });

  it("should honour --tmpdir=DIR", async () => {
    const env = new Bash();
    const path = await run(
      env,
      "mkdir -p /work && mktemp --tmpdir=/work fooXXXXXX",
    );
    expect(path).toMatch(/^\/work\/foo[0-9A-Za-z]{6}$/);
  });

  it("should treat a bare --tmpdir as the default directory", async () => {
    const env = new Bash();
    const path = await run(env, "mktemp --tmpdir fooXXXXXX");
    expect(path).toMatch(/^\/tmp\/foo[0-9A-Za-z]{6}$/);
  });

  it("should expand a template relative to the current directory", async () => {
    const env = new Bash({ cwd: "/home/user" });
    const path = await run(env, "mktemp buildXXXX");
    expect(path).toMatch(/^build[0-9A-Za-z]{4}$/);

    const ls = await env.exec("ls /home/user");
    expect(ls.stdout).toBe(`${path}\n`);
  });

  it("should expand an absolute template", async () => {
    const env = new Bash();
    const path = await run(env, "mktemp /tmp/build-XXXXXX.log");
    expect(path).toMatch(/^\/tmp\/build-[0-9A-Za-z]{6}\.log$/);

    const stat = await env.exec(`stat -c '%F' ${path}`);
    expect(stat.stdout).toBe("regular file\n");
  });

  it("should append --suffix after the random characters", async () => {
    const env = new Bash();
    const path = await run(env, "mktemp --suffix=.txt /tmp/fileXXXXXX");
    expect(path).toMatch(/^\/tmp\/file[0-9A-Za-z]{6}\.txt$/);
  });

  it("should reject --suffix when the template does not end in X", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp --suffix=.txt /tmp/fileXXXXXX.log");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "mktemp: with --suffix, template '/tmp/fileXXXXXX.log' must end in X\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("should reject a suffix containing a directory separator", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp --suffix=a/b /tmp/fileXXXXXX");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "mktemp: invalid suffix 'a/b', contains directory separator\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("should reject a template with too few X's", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp /tmp/fooXX");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "mktemp: too few X's in template '/tmp/fooXX'\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("should reject a template with no X's", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp /tmp/foo");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("mktemp: too few X's in template '/tmp/foo'\n");
    expect(result.exitCode).toBe(1);
  });

  it("should reject an absolute template with --tmpdir", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp --tmpdir /tmp/fooXXXXXX");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "mktemp: invalid template, '/tmp/fooXXXXXX'; with --tmpdir, it may not be absolute\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("should reject a -t template containing a directory separator", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp -t sub/fooXXXXXX");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "mktemp: invalid template, 'sub/fooXXXXXX', contains directory separator\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("should place a -t template in the temporary directory", async () => {
    const env = new Bash();
    const path = await run(
      env,
      "mkdir -p /sandbox && TMPDIR=/sandbox mktemp -t fooXXXXXX",
    );
    expect(path).toMatch(/^\/sandbox\/foo[0-9A-Za-z]{6}$/);
  });

  it("should not create anything with -u", async () => {
    const env = new Bash();
    const path = await run(env, "mktemp -u");
    expect(path).toMatch(/^\/tmp\/tmp\./);

    const ls = await env.exec("ls /tmp");
    expect(ls.stdout).toBe("");

    const test = await env.exec(`test -e ${path}`);
    expect(test.exitCode).toBe(1);
  });

  it("should not create anything with --dry-run", async () => {
    const env = new Bash();
    const path = await run(env, "mktemp --dry-run -d");
    const test = await env.exec(`test -e ${path}`);
    expect(test.exitCode).toBe(1);
  });

  it("should fail when the target directory does not exist", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp -p /nope");
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "mktemp: failed to create file via template 'tmp.XXXXXXXXXX':",
    );
    expect(result.exitCode).toBe(1);
  });

  it("should suppress diagnostics with -q but keep the exit code", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp -q -p /nope");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("should reject an unknown short flag", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp -Z");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("mktemp: invalid option -- 'Z'\n");
    expect(result.exitCode).toBe(1);
  });

  it("should reject an unknown long flag", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp --nope");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("mktemp: unrecognized option '--nope'\n");
    expect(result.exitCode).toBe(1);
  });

  it("should reject more than one template", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp fooXXXX barXXXX");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("mktemp: too many templates\n");
    expect(result.exitCode).toBe(1);
  });

  it("should print a candidate for -u even when the directory is missing", async () => {
    // GNU mktemp -u touches the filesystem not at all, so a missing
    // destination directory is not an error.
    const env = new Bash();
    const path = await run(env, "mktemp -u -p /missing fooXXXXXX");
    expect(path).toMatch(/^\/missing\/foo[0-9A-Za-z]{6}$/);

    const test = await env.exec("test -e /missing");
    expect(test.exitCode).toBe(1);
  });

  it("should treat --help after -- as a template", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp -- --help");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("mktemp: too few X's in template '--help'\n");
    expect(result.exitCode).toBe(1);
  });

  it("should treat --version after -- as a template", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp -- --version");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("mktemp: too few X's in template '--version'\n");
    expect(result.exitCode).toBe(1);
  });

  it("should expand a template given after --", async () => {
    const env = new Bash();
    const path = await run(env, "mktemp -- /tmp/afterXXXXXX");
    expect(path).toMatch(/^\/tmp\/after[0-9A-Za-z]{6}$/);
  });

  it("should never hand back a path that already holds data", async () => {
    // End-to-end uniqueness: each iteration writes a marker into the path it
    // was given, so a repeat or a clobber shows up as a wrong marker.
    const env = new Bash();
    const script = `
      for i in $(seq 1 50); do
        f=$(mktemp)
        if [ -s "$f" ]; then echo "REUSED $f"; fi
        echo "marker-$i" > "$f"
      done
      ls /tmp | wc -l
      cat /tmp/* | sort -u | wc -l
    `;
    const result = await env.exec(script);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    // 50 distinct paths, 50 distinct markers, and no reuse reported.
    expect(result.stdout).toBe("50\n50\n");
  });

  it("should create the file empty and private", async () => {
    const env = new Bash();
    const path = await run(env, "mktemp");
    const stat = await env.exec(`stat -c '%a %s' ${path}`);
    expect(stat.stdout).toBe("600 0\n");
  });

  it("should consume --help as the value of -p rather than printing help", async () => {
    // -u so the run turns purely on option parsing, not on the directory
    // existing: --help must be taken as -p's value, not as a help request.
    const env = new Bash();
    const result = await env.exec("mktemp -u -p --help");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^--help\/tmp\.[0-9A-Za-z]{10}\n$/);
  });

  it("should consume --version as the value of --suffix", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp --suffix --version /tmp/fileXXXXXX");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\/tmp\/file[0-9A-Za-z]{6}--version\n$/);
  });

  it("should work when the temporary directory is a symlink", async () => {
    // A symlinked TMPDIR is a common host setup. The entry must be reachable
    // through the path mktemp printed.
    const env = new Bash();
    const result = await env.exec(
      "mkdir -p /real && ln -s /real /link && TMPDIR=/link mktemp",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const path = result.stdout.trim();
    expect(path).toMatch(/^\/link\/tmp\./);

    const check = await env.exec(`test -f ${path} && echo reachable`);
    expect(check.stdout).toBe("reachable\n");

    // And it is the same entry through the resolved directory.
    const viaReal = await env.exec(`ls /real | wc -l`);
    expect(viaReal.stdout).toBe("1\n");
  });

  it("should handle a template whose X run exceeds one CSPRNG buffer", async () => {
    // Web Crypto rejects getRandomValues buffers over 65536 bytes, so the
    // random part must be drawn in chunks rather than one call.
    const env = new Bash();
    const result = await env.exec(
      'x=$(printf "X%.0s" $(seq 1 70000)); mktemp -u "/tmp/big$x" | wc -c',
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    // "/tmp/big" (8) + 70000 random characters + newline
    expect(result.stdout).toBe("70009\n");
  });

  it("should show help", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp --help");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "mktemp - create a temporary file or directory and print its name",
    );
    expect(result.stdout).toContain("-d, --directory");
  });

  it("should show the version", async () => {
    const env = new Bash();
    const result = await env.exec("mktemp --version");
    expect(result.stdout).toBe("mktemp (just-bash) 9.4\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should be usable in the command substitution idiom", async () => {
    const env = new Bash({ files: { "/home/user/in.txt": "hello\n" } });
    const result = await env.exec(
      "mkdir -p /tmp && S=$(mktemp) && sed 's/hello/world/' /home/user/in.txt > $S && cat $S",
    );
    expect(result.stdout).toBe("world\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
