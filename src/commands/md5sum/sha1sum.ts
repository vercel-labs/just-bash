import type { Command } from "../../types.js";
import { createChecksumCommand } from "./checksum.js";

export const sha1sumCommand: Command = createChecksumCommand(
  "sha1sum",
  "sha1",
  "compute SHA1 message digest",
);
