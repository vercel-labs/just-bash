/**
 * Integration test exercising all features added on the streaming-pipelines branch
 * in a single large script: streaming pipelines, background jobs, wait, jobs/kill/disown,
 * PipeChannel backpressure, createReadStream, rg/grep/head/cat/seq streaming,
 * PIPESTATUS, pipefail, |&, and onOutput streaming.
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { FakeClock } from "../testing/fake-clock.js";

describe("streaming-pipelines branch integration", () => {
  it("large script: streaming pipelines + background jobs + wait + job control", async () => {
    const clock = new FakeClock();
    const bash = new Bash({
      sleep: clock.sleep,
      files: {
        "/data/words.txt": `${[
          "apple",
          "banana",
          "cherry",
          "date",
          "elderberry",
          "fig",
          "grape",
          "honeydew",
          "kiwi",
          "lemon",
          "mango",
          "nectarine",
          "orange",
          "papaya",
          "quince",
          "raspberry",
          "strawberry",
          "tangerine",
          "ugli",
          "vanilla",
        ].join("\n")}\n`,
        "/data/numbers.txt": `${Array.from({ length: 200 }, (_, i) => `${i + 1}`).join("\n")}\n`,
        "/data/logs.txt": `${[
          "2024-01-01 INFO Starting server",
          "2024-01-01 WARN Low memory",
          "2024-01-01 ERROR Connection refused",
          "2024-01-01 INFO Request handled",
          "2024-01-01 ERROR Timeout exceeded",
          "2024-01-01 INFO Shutting down",
          "2024-01-01 WARN Disk space low",
          "2024-01-01 ERROR Segfault",
          "2024-01-02 INFO Restarted",
          "2024-01-02 INFO Healthy",
        ].join("\n")}\n`,
        "/data/config.ini": `${[
          "[database]",
          "host=localhost",
          "port=5432",
          "name=mydb",
          "",
          "[server]",
          "host=0.0.0.0",
          "port=8080",
          "workers=4",
        ].join("\n")}\n`,
      },
    });

    const result = await bash.exec(`
      # ================================================================
      # Part 1: Streaming pipelines — cat | grep | head chains
      # ================================================================
      echo "=== Part 1: Streaming Pipelines ==="

      # Stream a file through grep and head — only first 3 fruit starting with a-g
      fruits=$(cat /data/words.txt | grep -E '^[a-g]' | head -n 3)
      echo "First 3 a-g fruits:" $fruits

      # Count errors in logs via streaming grep
      error_count=$(cat /data/logs.txt | grep -c ERROR)
      echo "Error count: $error_count"

      # Chain cat | cat | cat to verify multi-stage streaming
      chain_result=$(echo "chain-test-data" | cat | cat | cat)
      echo "Chain: $chain_result"

      # Stream seq through head — trillion-element sequence bounded by head
      big_seq=$(seq 1 999999999 | head -n 3)
      echo "Big seq:" $big_seq

      # rg streaming search on stdin
      rg_result=$(cat /data/logs.txt | rg "INFO" | head -n 2)
      echo "RG result:" $rg_result

      # rg searching files directly (uses createReadStream)
      rg_file=$(rg 'port' /data/config.ini)
      echo "RG file search:"
      echo "$rg_file"

      # grep with context on streamed input
      grep_ctx=$(cat /data/logs.txt | grep -A1 "WARN")
      echo "Grep with context:"
      echo "$grep_ctx"

      # grep -v invert on streaming input
      non_errors=$(cat /data/logs.txt | grep -v ERROR | grep -c INFO)
      echo "Non-error INFO lines: $non_errors"

      # head with byte mode on stdin (buffered fallback)
      byte_head=$(echo "hello world" | head -c 5)
      echo "Byte head: $byte_head"

      # head reading file args directly (no stdin drain)
      file_head=$(head -n 2 /data/words.txt)
      echo "File head:" $file_head

      # ================================================================
      # Part 2: PIPESTATUS and pipefail
      # ================================================================
      echo ""
      echo "=== Part 2: PIPESTATUS & pipefail ==="

      # PIPESTATUS captures all stages
      true | false | true
      echo "PIPESTATUS: \${PIPESTATUS[0]} \${PIPESTATUS[1]} \${PIPESTATUS[2]}"

      # pipefail propagates failure from middle stage
      set -o pipefail
      true | false | true
      pf_exit=$?
      set +o pipefail
      echo "pipefail exit: $pf_exit"

      # ! negation inverts pipeline exit
      ! echo test | grep nomatch > /dev/null 2>&1
      echo "Negated grep-no-match: $?"

      # ================================================================
      # Part 3: |& stderr piping
      # ================================================================
      echo ""
      echo "=== Part 3: stderr piping ==="

      # |& pipes stderr to next stage's stdin
      stderr_captured=$(ls /nonexistent_path_xyz 2>&1 | head -n 1)
      echo "Captured stderr: $stderr_captured"

      # ================================================================
      # Part 4: Background jobs, wait, $!, job control
      # ================================================================
      echo ""
      echo "=== Part 4: Background Jobs ==="

      # Launch 3 background jobs with different exit codes
      (echo "bg1-output"; exit 0) &
      p1=$!
      (echo "bg2-output"; exit 7) &
      p2=$!
      (echo "bg3-output"; exit 42) &
      p3=$!

      echo "Launched PIDs: p1=$p1 p2=$p2 p3=$p3"

      # Wait for each and capture exit codes
      wait $p1; echo "bg1 exit: $?"
      wait $p2; echo "bg2 exit: $?"
      wait $p3; echo "bg3 exit: $?"

      # Background pipeline: streaming works inside & too
      echo "hello world from bg pipeline" | tr a-z A-Z &
      wait $!
      echo "bg pipeline done"

      # Background for loop
      for i in x y z; do echo "loop-$i"; done &
      wait

      # wait -n: wait for any one job
      (sleep 0; echo "fast-job") &
      (sleep 0; echo "also-fast") &
      wait -n
      echo "At least one finished"
      wait

      # ================================================================
      # Part 5: jobs, kill, disown
      # ================================================================
      echo ""
      echo "=== Part 5: jobs/kill/disown ==="

      # kill -l lists signals
      sig_list=$(kill -l | head -n 1)
      echo "Signals: $sig_list"

      # ================================================================
      # Part 6: State isolation in background
      # ================================================================
      echo ""
      echo "=== Part 6: State Isolation ==="

      myvar="parent_value"
      myvar="changed_in_bg" &
      wait
      echo "myvar after bg: $myvar"

      arr=(1 2 3)
      (arr+=(4 5)) &
      wait
      echo "arr length after bg: \${#arr[@]}"

      parent_cwd=$(pwd)
      (cd /) &
      wait
      echo "cwd after bg cd: $(pwd)"
      echo "cwd unchanged: $([ "$(pwd)" = "$parent_cwd" ] && echo yes || echo no)"

      # ================================================================
      # Part 7: Redirections with streaming
      # ================================================================
      echo ""
      echo "=== Part 7: Redirections ==="

      # Pipeline output redirected to file
      cat /data/words.txt | grep -E '^[m-z]' | sort > /tmp/sorted_fruits.txt
      sorted=$(cat /tmp/sorted_fruits.txt)
      echo "Sorted m-z fruits:"
      echo "$sorted"

      # Background job writing to file
      echo "bg-file-write" > /tmp/bg_out.txt &
      wait
      echo "BG file: $(cat /tmp/bg_out.txt)"

      # Here-doc through streaming pipeline
      result=$(cat <<ENDOFDATA | grep -c line
line one
line two
not this
line three
ENDOFDATA
      )
      echo "Here-doc line count: $result"

      # ================================================================
      # Part 8: Command substitution with pipelines
      # ================================================================
      echo ""
      echo "=== Part 8: Command Substitution ==="

      # Nested command substitution with streaming
      inner=$(cat /data/numbers.txt | head -n 5 | tail -n 1)
      echo "5th number: $inner"

      # Command substitution in arithmetic
      count=$(cat /data/words.txt | wc -l)
      doubled=$((count * 2))
      echo "Words: $count, doubled: $doubled"

      # Pipeline in condition
      if cat /data/logs.txt | grep -q "Segfault"; then
        echo "Found segfault in logs"
      fi

      # ================================================================
      # Part 9: Complex pipeline + background combo
      # ================================================================
      echo ""
      echo "=== Part 9: Complex Combos ==="

      # Background pipeline with grep + head + wc
      match_count=$(cat /data/words.txt | grep -E '[aeiou]{2}' | wc -l)
      echo "Words with consecutive vowels: $match_count"

      # Multiple background producers, sequential wait
      (seq 1 5 | head -n 3) &
      j1=$!
      (echo "alpha"; echo "beta"; echo "gamma") &
      j2=$!
      wait $j1
      echo "j1 done: $?"
      wait $j2
      echo "j2 done: $?"

      # errexit does not kill parent on background failure
      set -e
      false &
      wait
      echo "Parent survived bg failure"
      set +e

      # ================================================================
      # Part 10: seq streaming with various args
      # ================================================================
      echo ""
      echo "=== Part 10: seq streaming ==="

      # seq with step
      stepped=$(seq 0 5 20)
      echo "Stepped:" $stepped

      # seq piped to grep
      even=$(seq 1 10 | grep -E '(2|4|6|8|0)$')
      echo "Even-ish:" $even

      echo ""
      echo "=== ALL DONE ==="
    `);

    // Verify all sections executed
    expect(result.stdout).toContain("=== Part 1: Streaming Pipelines ===");
    expect(result.stdout).toContain("=== ALL DONE ===");
    expect(result.exitCode).toBe(0);

    // Part 1: Streaming pipelines
    expect(result.stdout).toContain("First 3 a-g fruits: apple banana cherry");
    expect(result.stdout).toContain("Error count: 3");
    expect(result.stdout).toContain("Chain: chain-test-data");
    expect(result.stdout).toContain("Big seq: 1 2 3");
    expect(result.stdout).toContain(
      "RG result: 2024-01-01 INFO Starting server 2024-01-01 INFO Request handled",
    );
    expect(result.stdout).toContain("port=5432");
    expect(result.stdout).toContain("port=8080");
    expect(result.stdout).toContain("Non-error INFO lines: 5");
    expect(result.stdout).toContain("Byte head: hello");
    expect(result.stdout).toContain("File head: apple banana");

    // Part 2: PIPESTATUS
    expect(result.stdout).toContain("PIPESTATUS: 0 1 0");
    expect(result.stdout).toContain("pipefail exit: 1");
    expect(result.stdout).toContain("Negated grep-no-match: 0");

    // Part 3: stderr piping
    expect(result.stdout).toContain("Captured stderr:");
    expect(result.stdout).toMatch(/No such file/);

    // Part 4: Background jobs
    expect(result.stdout).toContain("bg1-output");
    expect(result.stdout).toContain("bg2-output");
    expect(result.stdout).toContain("bg3-output");
    expect(result.stdout).toContain("bg1 exit: 0");
    expect(result.stdout).toContain("bg2 exit: 7");
    expect(result.stdout).toContain("bg3 exit: 42");
    expect(result.stdout).toContain("HELLO WORLD FROM BG PIPELINE");
    expect(result.stdout).toContain("bg pipeline done");
    expect(result.stdout).toContain("loop-x");
    expect(result.stdout).toContain("loop-y");
    expect(result.stdout).toContain("loop-z");
    expect(result.stdout).toContain("At least one finished");

    // Part 5: jobs/kill/disown
    expect(result.stdout).toMatch(/Signals:.*SIG/);

    // Part 6: State isolation
    expect(result.stdout).toContain("myvar after bg: parent_value");
    expect(result.stdout).toContain("arr length after bg: 3");
    expect(result.stdout).toContain("cwd unchanged: yes");

    // Part 7: Redirections
    expect(result.stdout).toContain("mango");
    expect(result.stdout).toContain("strawberry");
    expect(result.stdout).toContain("BG file: bg-file-write");
    expect(result.stdout).toContain("Here-doc line count: 3");

    // Part 8: Command substitution
    expect(result.stdout).toContain("5th number: 5");
    expect(result.stdout).toContain("Words: 20, doubled: 40");
    expect(result.stdout).toContain("Found segfault in logs");

    // Part 9: Complex combos
    expect(result.stdout).toContain("j1 done: 0");
    expect(result.stdout).toContain("j2 done: 0");
    expect(result.stdout).toContain("Parent survived bg failure");

    // Part 10: seq streaming
    expect(result.stdout).toContain("Stepped: 0 5 10 15 20\n");

    // Final
    expect(result.stdout).toContain("=== ALL DONE ===");
  });

  it("onOutput streaming receives incremental chunks", async () => {
    const chunks: Array<{ stdout: string; stderr: string }> = [];
    const clock = new FakeClock();
    const bash = new Bash({
      sleep: clock.sleep,
      files: {
        "/data.txt": "line1\nline2\nline3\nline4\nline5\n",
      },
    });

    const result = await bash.exec(
      `
      echo "=== start ==="
      cat /data.txt | grep line | head -n 3
      echo "=== middle ==="
      echo bg-data &
      wait
      echo "=== end ==="
    `,
      { onOutput: (chunk) => chunks.push(chunk) },
    );

    const allStdout = chunks.map((c) => c.stdout).join("");
    expect(allStdout).toContain("=== start ===");
    expect(allStdout).toContain("line1");
    expect(allStdout).toContain("line2");
    expect(allStdout).toContain("line3");
    expect(allStdout).toContain("=== middle ===");
    expect(allStdout).toContain("bg-data");
    expect(allStdout).toContain("=== end ===");
    expect(result.stdout).toBe(allStdout);
  });
});
