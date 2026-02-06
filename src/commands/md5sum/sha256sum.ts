import type { Command } from "../../types.js";
import { createChecksumCommand } from "./checksum.js";

export const sha256sumCommand: Command = createChecksumCommand(
  "sha256sum",
  "sha256",
  "compute SHA256 message digest",
);

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "sha256sum",
  flags: [{ flag: "-c", type: "boolean" }],
  needsFiles: true,
};
