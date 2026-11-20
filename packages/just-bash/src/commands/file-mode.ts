/**
 * Parse a mode string and return the resulting mode value.
 * For numeric modes, currentMode is ignored.
 * For symbolic modes, currentMode is used as the starting point.
 */
export function parseFileMode(
  modeStr: string,
  currentMode = 0,
  isDirectory = false,
): number {
  // Numeric mode (octal)
  if (/^[0-7]+$/.test(modeStr)) {
    const mode = Number.parseInt(modeStr, 8);
    if (!Number.isSafeInteger(mode) || mode > 0o7777)
      throw new Error(`Invalid mode: ${modeStr}`);
    return mode;
  }

  // Symbolic mode - start with current mode
  let mode = currentMode & 0o7777; // Only keep permission bits

  // Parse symbolic modes like u+x, g-w, o=r, a+x, +x
  const parts = modeStr.split(",");
  for (const part of parts) {
    const match = part.match(/^([ugoa]*)([+\-=])([rwxXst]*)$/);
    if (!match) {
      throw new Error(`Invalid mode: ${modeStr}`);
    }

    let who = match[1] || "a";
    const op = match[2];
    const perms = match[3];

    // Convert 'a' to 'ugo'
    if (who.includes("a")) {
      who = "ugo";
    }

    let permBits = 0;
    if (perms.includes("r")) permBits |= 0o4;
    if (perms.includes("w")) permBits |= 0o2;
    if (
      perms.includes("x") ||
      (perms.includes("X") && (isDirectory || (mode & 0o111) !== 0))
    )
      permBits |= 0o1;

    // Handle special bits (s for setuid/setgid, t for sticky)
    let specialBits = 0;
    if (perms.includes("s")) {
      // s sets setuid (4000) when applied to user, setgid (2000) when applied to group
      if (who.includes("u")) specialBits |= 0o4000;
      if (who.includes("g")) specialBits |= 0o2000;
    }
    if (perms.includes("t")) {
      if (who.includes("o")) specialBits |= 0o1000;
    }

    for (const w of who) {
      let shift = 0;
      if (w === "u") shift = 6;
      else if (w === "g") shift = 3;
      else if (w === "o") shift = 0;

      const bits = permBits << shift;

      if (op === "+") {
        mode |= bits;
      } else if (op === "-") {
        mode &= ~bits;
      } else if (op === "=") {
        // Clear the bits for this who, then set
        mode &= ~(0o7 << shift);
        if (w === "u") mode &= ~0o4000;
        if (w === "g") mode &= ~0o2000;
        if (w === "o") mode &= ~0o1000;
        mode |= bits;
      }
    }

    // Apply special bits
    if (op === "+") {
      mode |= specialBits;
    } else if (op === "-") {
      mode &= ~specialBits;
    } else if (op === "=") {
      // Associated special bits were cleared with each selected class above.
      if (perms.includes("s")) {
        if (who.includes("u")) {
          mode |= specialBits & 0o4000;
        }
        if (who.includes("g")) {
          mode |= specialBits & 0o2000;
        }
      }
      if (perms.includes("t")) {
        mode |= specialBits & 0o1000;
      }
    }
  }

  return mode;
}
