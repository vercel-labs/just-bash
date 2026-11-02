// Automa modifications: N5b checksum command registration.

import type { RuntimeCommand } from "../../types.js";
import type { CommandFuzzInfo } from "../fuzz-flags-types.js";
import { createChecksumCommand } from "./checksum.js";

export const b2sumCommand: RuntimeCommand = createChecksumCommand(
  "b2sum",
  "blake2b",
  "compute BLAKE2b-512 message digest",
);
export const flagsForFuzzing: CommandFuzzInfo = {
  name: "b2sum",
  flags: [{ flag: "-c", type: "boolean" }],
  needsFiles: true,
};
