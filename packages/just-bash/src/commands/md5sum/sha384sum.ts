// Automa modifications: N5b checksum command registration.

import type { RuntimeCommand } from "../../types.js";
import type { CommandFuzzInfo } from "../fuzz-flags-types.js";
import { createChecksumCommand } from "./checksum.js";

export const sha384sumCommand: RuntimeCommand = createChecksumCommand(
  "sha384sum",
  "sha384",
  "compute SHA384 message digest",
);
export const flagsForFuzzing: CommandFuzzInfo = {
  name: "sha384sum",
  flags: [{ flag: "-c", type: "boolean" }],
  needsFiles: true,
};
