import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("literal text around an array in a default word - GNU Bash Comparison", () => {
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDirectory);
  });

  it.each([
    "set +u",
    "set -u",
  ])("joins a prefix to the first element and a suffix to the last with %s", async (nounset) => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      `${nounset}
unset U
arr=(x y)
b=(p q)
printf '<%s>' "\${U:-pre\${arr[@]}post}"; echo
printf '<%s>' "\${U:+pre\${arr[@]}post}"; echo
printf '<%s>' "\${arr[@]:-pre\${b[@]}post}"; echo
printf '<%s>' "\${U:-pre\${arr[@]}}"; echo
printf '<%s>' "\${U:-\${arr[@]}post}"; echo
printf '<%s>' "\${U:-\${arr[@]}}"; echo
printf '<%s>' "\${U-pre\${arr[@]}post}" next; echo`,
    );
  });

  it("uses the alternative word with literals when the variable is set", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      `S=set
arr=(x y)
one=(z)
printf '<%s>' "\${S:+pre\${arr[@]}post}"; echo
printf '<%s>' "\${S:+pre\${one[@]}post}"; echo
printf '<%s>' "\${S:-pre\${arr[@]}post}"; echo`,
    );
  });

  it("selects the default word for empty whole-array parameters", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      `IFS=:
e=()
a=(m n)
arr=(x y)
printf '<%s>' "\${e[@]:-pre\${arr[@]}post}"; echo
printf '<%s>' "\${e[*]:-pre\${arr[@]}post}"; echo
printf '<%s>' "\${a[*]:+pre\${arr[@]}post}"; echo
printf '<%s>' "\${a[@]:+pre\${arr[@]}post}"; echo
printf '<%s>' "\${e[*]:-\${arr[@]}}"; echo
printf '<%s>' "\${a[*]:+\${arr[@]}}"; echo`,
    );
  });

  it("joins array-star defaults with the first IFS character", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      `arr=(x y)
printf '<%s>' "\${U:-pre\${arr[*]}post}"; echo
IFS=:
printf '<%s>' "\${U:-pre\${arr[*]}post}"; echo
printf '<%s>' "\${U:-pre\${arr[@]}post}"; echo`,
    );
  });

  it("keeps the literals for empty, unset and scalar arrays", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      `empty=()
sc=val
set -- "\${U:-pre\${empty[@]}post}"; echo "$# <$1>"
set -- "\${U:-pre\${empty[@]}}"; echo "$# <$1>"
set -- "\${U:-pre\${empty[*]}post}"; echo "$# <$1>"
set -- "\${U:-\${empty[*]}}"; echo "$# <$1>"
set -- "\${U:-pre\${missing[@]}post}"; echo "$# <$1>"
set -- "\${U:-pre\${sc[@]}post}"; echo "$# <$1>"`,
    );
  });

  it("expands quotes, tildes and substitutions next to the array literally", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      `arr=(x y)
sp=('a b' c)
n=1
printf '<%s>' "\${U:-'q'\${arr[@]}}"; echo
printf '<%s>' "\${U:-~/a\${arr[@]}}"; echo
printf '<%s>' "\${U:-$(echo cs)\${arr[@]}}"; echo
printf '<%s>' "\${U:-$((n + 2))\${arr[@]}$n}"; echo
printf '<%s>' "\${U:-<\${sp[@]}>}"; echo
printf '<%s>' "\${U:-a b*\${arr[@]}}"; echo`,
    );
  });
});
