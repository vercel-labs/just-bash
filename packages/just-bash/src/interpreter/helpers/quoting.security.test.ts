import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { quoteArrayValue, quoteDeclareValue } from "./quoting.js";

describe("replay-safe shell quoting", () => {
  it.each([
    "$(echo exploited)",
    "`echo exploited`",
    "${PATH}",
    "$((1+1))",
  ])("escapes expansion syntax in double-quoted listings: %s", (value) => {
    expect(quoteDeclareValue(value)).toContain("\\");
    expect(quoteArrayValue(value)).toContain("\\");
  });

  it("replays export -p without executing stored substitutions", async () => {
    const source = new Bash();
    const listing = await source.exec(
      "export PAYLOAD='$(echo exploited)' TICKS='`echo owned`'; export -p",
    );

    const target = new Bash();
    const replay = await target.exec(
      `${listing.stdout}\nprintf '%s|%s' "$PAYLOAD" "$TICKS"`,
    );
    expect(replay.exitCode).toBe(0);
    expect(replay.stdout).toBe("$(echo exploited)|`echo owned`");
  });

  it("replays declare -p without executing stored substitutions", async () => {
    const source = new Bash();
    const listing = await source.exec(
      "PAYLOAD='${HOME}:$((6*7)):$(echo bad)'; declare -p PAYLOAD",
    );

    const target = new Bash();
    const replay = await target.exec(
      `${listing.stdout}\nprintf '%s' "$PAYLOAD"`,
    );
    expect(replay.exitCode).toBe(0);
    expect(replay.stdout).toBe("${HOME}:$((6*7)):$(echo bad)");
  });

  it("replays hash -l paths and option-like names as inert arguments", async () => {
    const source = new Bash();
    const listing = await source.exec(
      `hash -p '/tmp/$(echo bad) path' -- -danger; hash -l`,
    );
    expect(listing.stdout).not.toContain("\nbad\n");

    const target = new Bash();
    const replay = await target.exec(`${listing.stdout}\nhash -t -- -danger`);
    expect(replay.exitCode).toBe(0);
    expect(replay.stdout).toBe("/tmp/$(echo bad) path\n");
  });

  it("replays complete -p command fields and option-like command names", async () => {
    const source = new Bash();
    const listing = await source.exec(
      `complete -W 'one $(echo bad)' -C 'printf "%s" "$HOME"' -- -danger; complete -p`,
    );
    const target = new Bash();
    const replay = await target.exec(
      `${listing.stdout}\ncomplete -p -- -danger`,
    );
    expect(replay.exitCode).toBe(0);
    expect(replay.stdout).toBe(listing.stdout);
  });

  it("replays associative array keys and values with shell syntax", async () => {
    const source = new Bash();
    const listing = await source.exec(
      `declare -A A; A["a b"]='$(bad)'; declare -p A`,
    );
    expect(listing.exitCode).toBe(0);
    const target = new Bash();
    const replay = await target.exec(
      `${listing.stdout}\nprintf '%s|%s' "\${!A[@]}" "\${A["a b"]}"`,
    );
    expect(replay.exitCode).toBe(0);
    expect(replay.stdout).toBe("a b|$(bad)");
  });

  it("replays set listings for scalars and declared array kinds", async () => {
    const source = new Bash();
    const listing = await source.exec(
      `SCALAR='$(bad)'; declare -a IDX; IDX[0]='$((7))'; declare -A ASSOC; ASSOC["a b"]='\${HOME}'; set`,
    );
    const selected = listing.stdout
      .split("\n")
      .filter((line) => /^(?:SCALAR|IDX|ASSOC)=/.test(line))
      .join("\n");
    const target = new Bash();
    const replay = await target.exec(
      `declare -A ASSOC\n${selected}\nprintf '%s|%s|%s|%s' "$SCALAR" "\${IDX[0]}" "\${!ASSOC[@]}" "\${ASSOC["a b"]}"`,
    );
    expect(replay.exitCode).toBe(0);
    expect(replay.stdout).toBe("$(bad)|$((7))|a b|${HOME}");
  });
});
