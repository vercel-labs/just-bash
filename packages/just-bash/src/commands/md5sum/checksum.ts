// Automa modifications: N00b operand boundaries; N5b hash family, bounded work,
// byte-preserving filenames, GNU verification diagnostics and output ordering.
import { blake2b } from "@noble/hashes/blake2.js";
import { md5 } from "@noble/hashes/legacy.js";
import { sha224 } from "@noble/hashes/sha2.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { checksumIO } from "./checksum-io.js";

export type HashAlgorithm =
  | "md5"
  | "sha1"
  | "sha224"
  | "sha256"
  | "sha384"
  | "sha512"
  | "blake2b";
const algorithms = new Map<
  HashAlgorithm,
  { length: number; webcrypto?: string }
>([
  ["md5", { length: 32 }],
  ["sha1", { length: 40, webcrypto: "SHA-1" }],
  ["sha224", { length: 56 }],
  ["sha256", { length: 64, webcrypto: "SHA-256" }],
  ["sha384", { length: 96, webcrypto: "SHA-384" }],
  ["sha512", { length: 128, webcrypto: "SHA-512" }],
  ["blake2b", { length: 128 }],
]);

async function computeHash(
  algorithm: HashAlgorithm,
  data: Uint8Array,
  io: ReturnType<typeof checksumIO>,
) {
  const lease = io.reserve(data.length + 1024);
  try {
    let bytes: Uint8Array;
    if (
      algorithm === "md5" ||
      algorithm === "sha224" ||
      algorithm === "blake2b"
    ) {
      const hash =
        algorithm === "md5"
          ? md5.create()
          : algorithm === "sha224"
            ? sha224.create()
            : blake2b.create();
      try {
        for (let at = 0; at < data.length; at += 65536) {
          await io.pause(1 + Math.ceil(Math.min(65536, data.length - at) / 64));
          hash.update(data.subarray(at, at + 65536));
        }
        io.check();
        bytes = hash.digest();
      } finally {
        hash.destroy();
      }
    } else {
      io.check(1 + Math.ceil(data.length / 64));
      const webcrypto = algorithms.get(algorithm)?.webcrypto;
      if (!webcrypto)
        throw new Error(`Unsupported digest algorithm: ${algorithm}`);
      // Keep one explicit WebCrypto call site for Automa's digest capability.
      const hashBuffer = await globalThis.crypto.subtle.digest(
        webcrypto,
        new Uint8Array(data).buffer as ArrayBuffer,
      );
      io.check();
      bytes = new Uint8Array(hashBuffer);
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } finally {
    lease.release();
  }
}

const escapedName = (file: string) =>
  file.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
function unescapeName(file: string): string | undefined {
  let output = "";
  for (let index = 0; index < file.length; index++) {
    if (file[index] !== "\\") {
      output += file[index];
      continue;
    }
    const char = file[++index];
    if (char === "\\") output += "\\";
    else if (char === "n") output += "\n";
    else if (char === "r") output += "\r";
    else return undefined;
  }
  return output;
}

export function createChecksumCommand(
  name: string,
  algorithm: HashAlgorithm,
  summary: string,
): RuntimeCommand {
  const definition = algorithms.get(algorithm);
  if (!definition)
    throw new Error(`Unsupported digest algorithm: ${algorithm}`);
  const help = {
    name,
    summary,
    usage: `${name} [OPTION]... [FILE]...`,
    options: [
      "-c, --check    read checksums from FILEs and check them",
      "-b, --binary   mark output as binary",
      "-t, --text     mark output as text",
      "    --help     display this help and exit",
    ],
  };
  return {
    name,
    async execute(
      args: string[],
      ctx: RuntimeCommandContext,
    ): Promise<ExecResult> {
      const io = checksumIO(ctx, name);
      try {
        const endOptions = args.indexOf("--");
        if (hasHelpFlag(endOptions < 0 ? args : args.slice(0, endOptions)))
          return showHelp(help);
        let check = false,
          binary = false,
          parseOptions = true,
          exitCode = 0;
        const files: string[] = [];
        for (const arg of args) {
          io.check();
          if (!parseOptions) files.push(arg);
          else if (arg === "--") parseOptions = false;
          else if (arg === "-c" || arg === "--check") check = true;
          else if (arg === "-b" || arg === "--binary") binary = true;
          else if (arg === "-t" || arg === "--text") binary = false;
          else if (arg.startsWith("-") && arg !== "-")
            return unknownOption(name, arg);
          else files.push(arg);
        }
        if (!files.length) files.push("-");
        const fileError = (error: unknown, file: string) => {
          rethrowFatalExecutionError(error);
          io.check();
          const message =
            error instanceof Error ? error.message : String(error);
          const code =
            (error as { code?: string })?.code ??
            /^(ENOENT|EACCES|EPERM|EISDIR|ENOTDIR):/.exec(message)?.[1];
          const description =
            code === "ENOENT"
              ? "No such file or directory"
              : code === "EACCES"
                ? "Permission denied"
                : code === "EPERM"
                  ? "Operation not permitted"
                  : code === "EISDIR"
                    ? "Is a directory"
                    : code === "ENOTDIR"
                      ? "Not a directory"
                      : undefined;
          if (!description) throw error;
          io.append("stderr", `${name}: ${file}: ${description}\n`);
          exitCode = 1;
        };
        const verifyLine = async (expected: string, file: string) => {
          const escaped = /[\\\n\r]/.test(file);
          const label = `${escaped ? "\\" : ""}${escaped ? escapedName(file) : file}`;
          let input: Awaited<ReturnType<typeof io.read>>;
          try {
            input = await io.read(file);
          } catch (error) {
            fileError(error, file);
            io.append("stdout", `${label}: FAILED open or read\n`);
            return "unreadable";
          }
          try {
            const matches =
              (await computeHash(algorithm, input.bytes, io)) ===
              expected.toLowerCase();
            io.append("stdout", `${label}: ${matches ? "OK" : "FAILED"}\n`);
            if (!matches) exitCode = 1;
            return matches ? "ok" : "mismatch";
          } finally {
            input.release();
          }
        };
        for (const file of files) {
          let input: Awaited<ReturnType<typeof io.read>>;
          try {
            input = await io.read(file);
          } catch (error) {
            fileError(error, file);
            continue;
          }
          try {
            if (!check) {
              const hash = await computeHash(algorithm, input.bytes, io);
              const escaped = /[\\\n\r]/.test(file);
              io.append(
                "stdout",
                `${escaped ? "\\" : ""}${hash} ${binary ? "*" : " "}${escaped ? escapedName(file) : file}\n`,
              );
              continue;
            }
            const textLease = io.reserve(input.bytes.length * 4);
            try {
              const content = new TextDecoder().decode(input.bytes);
              let valid = 0,
                malformed = 0,
                mismatch = 0,
                unreadable = 0;
              const pattern = /^(\\?)([a-fA-F0-9]+) [ *](.+)$/;
              for (let at = 0; at < content.length; ) {
                await io.pause();
                const end = content.indexOf("\n", at);
                const line = content.slice(at, end < 0 ? content.length : end);
                at = end < 0 ? content.length : end + 1;
                if (!line || line.startsWith("#")) continue;
                io.check(1 + Math.ceil(line.length / 1024));
                const match = pattern.exec(line);
                const target = match
                  ? match[1]
                    ? unescapeName(match[3])
                    : match[3]
                  : undefined;
                if (
                  !match ||
                  match[2].length !== definition.length ||
                  target === undefined ||
                  target.includes("\0") ||
                  (file === "-" && target === "-")
                ) {
                  malformed++;
                  continue;
                }
                valid++;
                const outcome = await verifyLine(match[2], target);
                if (outcome === "mismatch") mismatch++;
                else if (outcome === "unreadable") unreadable++;
              }
              if (!valid) {
                io.append(
                  "stderr",
                  `${name}: ${file === "-" ? "'standard input'" : file}: no properly formatted checksum lines found\n`,
                );
                exitCode = 1;
              } else if (malformed)
                io.append(
                  "stderr",
                  `${name}: WARNING: ${malformed} line${malformed === 1 ? " is" : "s are"} improperly formatted\n`,
                );
              if (unreadable)
                io.append(
                  "stderr",
                  `${name}: WARNING: ${unreadable} listed file${unreadable === 1 ? "" : "s"} could not be read\n`,
                );
              if (mismatch)
                io.append(
                  "stderr",
                  `${name}: WARNING: ${mismatch} computed checksum${mismatch === 1 ? "" : "s"} did NOT match\n`,
                );
            } finally {
              textLease.release();
            }
          } finally {
            input.release();
          }
        }
        return io.result(exitCode);
      } finally {
        io.dispose();
      }
    },
  };
}
