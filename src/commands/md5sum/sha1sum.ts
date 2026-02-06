import type { Command } from "../../types.js";
import { createChecksumCommand } from "./checksum.js";

export const sha1sumCommand: Command = createChecksumCommand(
  "sha1sum",
  "sha1",
  "compute SHA1 message digest",
);

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "sha1sum",
  flags: [{ flag: "-c", type: "boolean" }],
  needsFiles: true,
};
