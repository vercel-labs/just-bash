// Automa modifications: N5b checksum command registration.

import type { RuntimeCommand } from "../../types.js";
import type { CommandFuzzInfo } from "../fuzz-flags-types.js";
import { createChecksumCommand } from "./checksum.js";

export const sha512sumCommand: RuntimeCommand = createChecksumCommand(
  "sha512sum",
  "sha512",
  "compute SHA512 message digest",
);
export const flagsForFuzzing: CommandFuzzInfo = {
  name: "sha512sum",
  flags: [{ flag: "-c", type: "boolean" }],
  needsFiles: true,
};
