// Automa modifications: N5b checksum command registration.

import type { RuntimeCommand } from "../../types.js";
import type { CommandFuzzInfo } from "../fuzz-flags-types.js";
import { createChecksumCommand } from "./checksum.js";

export const sha224sumCommand: RuntimeCommand = createChecksumCommand(
  "sha224sum",
  "sha224",
  "compute SHA224 message digest",
);
export const flagsForFuzzing: CommandFuzzInfo = {
  name: "sha224sum",
  flags: [{ flag: "-c", type: "boolean" }],
  needsFiles: true,
};
