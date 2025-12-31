import type { Command } from "../../types.js";
import { createChecksumCommand } from "./checksum.js";

export const md5sumCommand: Command = createChecksumCommand(
  "md5sum",
  "md5",
  "compute MD5 message digest",
);
