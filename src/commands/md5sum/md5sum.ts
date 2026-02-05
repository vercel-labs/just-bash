import type { Command } from "../../types.js";
import { createChecksumCommand } from "./checksum.js";

export const md5sumCommand: Command = createChecksumCommand(
  "md5sum",
  "md5",
  "compute MD5 message digest",
);

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "md5sum",
  flags: [{ flag: "-c", type: "boolean" }],
  needsFiles: true,
};
