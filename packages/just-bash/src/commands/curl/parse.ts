/**
 * Option parsing for curl command
 */

import { _Headers } from "../../security/trusted-globals.js";
import type { ExecResult } from "../../types.js";
import { unknownOption } from "../help.js";
import { encodeFormData, parseFormField } from "./form.js";
import type { CurlOptions } from "./types.js";

/**
 * Push a `-d`/`--data`/`--data-binary`/`--data-raw` value as a data part.
 *
 * Real curl interprets a leading `@` as "read from file" for `-d`/`--data`
 * and `--data-binary`, but NOT for `--data-raw`. When `allowFile` is true and
 * the value begins with `@`, the path is recorded for execute-time resolution
 * (the VFS read is async); otherwise the value is taken verbatim. Parts
 * accumulate in order and are joined with `&` at execute time, matching real
 * curl's combination of repeated data flags.
 */
function pushDataPart(
  options: CurlOptions,
  value: string,
  spec: { binary: boolean; allowFile: boolean },
): void {
  if (spec.allowFile && value.startsWith("@")) {
    options.dataParts.push({
      file: { path: value.slice(1), mode: spec.binary ? "binary" : "ascii" },
    });
  } else {
    options.dataParts.push({ value });
  }
  if (spec.binary) {
    options.dataBinary = true;
  }
}

/**
 * Push a `--data-urlencode` value as a data part. Real curl supports five
 * forms:
 *   content       → encode content
 *   =content      → encode content (no `name=`)
 *   name=content  → `name=` + encode(content)
 *   @filename     → encode contents of file
 *   name@filename → `name=` + encode(contents of file)
 *
 * The `@file` forms are deferred to execute time so the VFS read is
 * async-safe; the inline forms are encoded eagerly. Either way the result is
 * one ordered data part joined with `&` alongside the other data flags.
 */
function pushUrlencodePart(options: CurlOptions, value: string): void {
  if (value.startsWith("@")) {
    options.dataParts.push({
      file: { path: value.slice(1), mode: "urlencode" },
    });
    return;
  }
  const atIndex = value.indexOf("@");
  const eqIndex = value.indexOf("=");
  if (atIndex > 0 && (eqIndex < 0 || atIndex < eqIndex)) {
    options.dataParts.push({
      file: {
        path: value.slice(atIndex + 1),
        mode: "urlencode",
        name: value.slice(0, atIndex),
      },
    });
    return;
  }
  options.dataParts.push({ value: encodeFormData(value) });
}

/**
 * Parse curl command line arguments
 */
export function parseOptions(args: string[]): CurlOptions | ExecResult {
  const options: CurlOptions = {
    method: "GET",
    headers: new _Headers(),
    dataParts: [],
    dataBinary: false,
    getMode: false,
    formFields: [],
    useRemoteName: false,
    headOnly: false,
    includeHeaders: false,
    silent: false,
    showError: false,
    failSilently: false,
    followRedirects: true,
    verbose: false,
  };

  let impliesPost = false;
  let explicitMethod = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-X" || arg === "--request") {
      options.method = args[++i] ?? "GET";
      explicitMethod = true;
    } else if (arg.startsWith("-X")) {
      options.method = arg.slice(2);
      explicitMethod = true;
    } else if (arg.startsWith("--request=")) {
      options.method = arg.slice(10);
      explicitMethod = true;
    } else if (arg === "-H" || arg === "--header") {
      const header = args[++i];
      if (header) {
        const colonIndex = header.indexOf(":");
        if (colonIndex > 0) {
          const name = header.slice(0, colonIndex).trim();
          const value = header.slice(colonIndex + 1).trim();
          options.headers.append(name, value);
        }
      }
    } else if (arg.startsWith("--header=")) {
      const header = arg.slice(9);
      const colonIndex = header.indexOf(":");
      if (colonIndex > 0) {
        const name = header.slice(0, colonIndex).trim();
        const value = header.slice(colonIndex + 1).trim();
        options.headers.append(name, value);
      }
    } else if (arg === "-G" || arg === "--get") {
      options.getMode = true;
      if (!explicitMethod) options.method = "GET";
    } else if (arg === "-d" || arg === "--data") {
      pushDataPart(options, args[++i] ?? "", {
        binary: false,
        allowFile: true,
      });
      impliesPost = true;
    } else if (arg === "--data-raw") {
      pushDataPart(options, args[++i] ?? "", {
        binary: false,
        allowFile: false,
      });
      impliesPost = true;
    } else if (arg.startsWith("-d")) {
      pushDataPart(options, arg.slice(2), { binary: false, allowFile: true });
      impliesPost = true;
    } else if (arg.startsWith("--data=")) {
      pushDataPart(options, arg.slice(7), { binary: false, allowFile: true });
      impliesPost = true;
    } else if (arg.startsWith("--data-raw=")) {
      pushDataPart(options, arg.slice(11), {
        binary: false,
        allowFile: false,
      });
      impliesPost = true;
    } else if (arg === "--data-binary") {
      pushDataPart(options, args[++i] ?? "", { binary: true, allowFile: true });
      impliesPost = true;
    } else if (arg.startsWith("--data-binary=")) {
      pushDataPart(options, arg.slice(14), { binary: true, allowFile: true });
      impliesPost = true;
    } else if (arg === "--data-urlencode") {
      pushUrlencodePart(options, args[++i] ?? "");
      impliesPost = true;
    } else if (arg.startsWith("--data-urlencode=")) {
      pushUrlencodePart(options, arg.slice(17));
      impliesPost = true;
    } else if (arg === "-F" || arg === "--form") {
      const formData = args[++i] ?? "";
      const field = parseFormField(formData);
      if (field) {
        options.formFields.push(field);
      }
      impliesPost = true;
    } else if (arg.startsWith("--form=")) {
      const formData = arg.slice(7);
      const field = parseFormField(formData);
      if (field) {
        options.formFields.push(field);
      }
      impliesPost = true;
    } else if (arg === "-u" || arg === "--user") {
      options.user = args[++i];
    } else if (arg.startsWith("-u")) {
      options.user = arg.slice(2);
    } else if (arg.startsWith("--user=")) {
      options.user = arg.slice(7);
    } else if (arg === "-A" || arg === "--user-agent") {
      options.headers.set("User-Agent", args[++i] ?? "");
    } else if (arg.startsWith("-A")) {
      options.headers.set("User-Agent", arg.slice(2));
    } else if (arg.startsWith("--user-agent=")) {
      options.headers.set("User-Agent", arg.slice(13));
    } else if (arg === "-e" || arg === "--referer") {
      options.headers.set("Referer", args[++i] ?? "");
    } else if (arg.startsWith("-e")) {
      options.headers.set("Referer", arg.slice(2));
    } else if (arg.startsWith("--referer=")) {
      options.headers.set("Referer", arg.slice(10));
    } else if (arg === "-b" || arg === "--cookie") {
      options.headers.set("Cookie", args[++i] ?? "");
    } else if (arg.startsWith("-b")) {
      options.headers.set("Cookie", arg.slice(2));
    } else if (arg.startsWith("--cookie=")) {
      options.headers.set("Cookie", arg.slice(9));
    } else if (arg === "-c" || arg === "--cookie-jar") {
      options.cookieJar = args[++i];
    } else if (arg.startsWith("--cookie-jar=")) {
      options.cookieJar = arg.slice(13);
    } else if (arg === "-T" || arg === "--upload-file") {
      options.uploadFile = args[++i];
      if (options.method === "GET") {
        options.method = "PUT";
      }
    } else if (arg.startsWith("--upload-file=")) {
      options.uploadFile = arg.slice(14);
      if (options.method === "GET") {
        options.method = "PUT";
      }
    } else if (arg === "-m" || arg === "--max-time") {
      const secs = parseFloat(args[++i] ?? "0");
      if (!Number.isNaN(secs) && secs > 0) {
        options.timeoutMs = secs * 1000;
      }
    } else if (arg.startsWith("--max-time=")) {
      const secs = parseFloat(arg.slice(11));
      if (!Number.isNaN(secs) && secs > 0) {
        options.timeoutMs = secs * 1000;
      }
    } else if (arg === "--connect-timeout") {
      const secs = parseFloat(args[++i] ?? "0");
      if (!Number.isNaN(secs) && secs > 0) {
        // Use connect-timeout as overall timeout if max-time not set
        if (options.timeoutMs === undefined) {
          options.timeoutMs = secs * 1000;
        }
      }
    } else if (arg.startsWith("--connect-timeout=")) {
      const secs = parseFloat(arg.slice(18));
      if (!Number.isNaN(secs) && secs > 0) {
        if (options.timeoutMs === undefined) {
          options.timeoutMs = secs * 1000;
        }
      }
    } else if (arg === "-o" || arg === "--output") {
      options.outputFile = args[++i];
    } else if (arg.startsWith("--output=")) {
      options.outputFile = arg.slice(9);
    } else if (arg === "-O" || arg === "--remote-name") {
      options.useRemoteName = true;
    } else if (arg === "-I" || arg === "--head") {
      options.headOnly = true;
      options.method = "HEAD";
      explicitMethod = true;
    } else if (arg === "-i" || arg === "--include") {
      options.includeHeaders = true;
    } else if (arg === "-s" || arg === "--silent") {
      options.silent = true;
    } else if (arg === "-S" || arg === "--show-error") {
      options.showError = true;
    } else if (arg === "-f" || arg === "--fail") {
      options.failSilently = true;
    } else if (arg === "-L" || arg === "--location") {
      options.followRedirects = true;
    } else if (arg === "--max-redirs") {
      const value = args[++i];
      if (value === undefined || !/^\d+$/.test(value)) {
        return {
          stdout: "",
          stderr: `curl: option --max-redirs: expected a non-negative integer\n`,
          exitCode: 2,
        };
      }
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) {
        return {
          stdout: "",
          stderr: `curl: option --max-redirs: value is out of range\n`,
          exitCode: 2,
        };
      }
      options.maxRedirects = parsed;
    } else if (arg.startsWith("--max-redirs=")) {
      const value = arg.slice(13);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        return {
          stdout: "",
          stderr: `curl: option --max-redirs: expected a non-negative integer\n`,
          exitCode: 2,
        };
      }
      options.maxRedirects = Number(value);
    } else if (arg === "-w" || arg === "--write-out") {
      options.writeOut = args[++i];
    } else if (arg.startsWith("--write-out=")) {
      options.writeOut = arg.slice(12);
    } else if (arg === "-v" || arg === "--verbose") {
      options.verbose = true;
    } else if (arg.startsWith("--") && arg !== "--") {
      return unknownOption("curl", arg);
    } else if (arg.startsWith("-") && arg !== "-") {
      // Handle combined short options like -sS
      for (const c of arg.slice(1)) {
        switch (c) {
          case "s":
            options.silent = true;
            break;
          case "S":
            options.showError = true;
            break;
          case "f":
            options.failSilently = true;
            break;
          case "L":
            options.followRedirects = true;
            break;
          case "I":
            options.headOnly = true;
            options.method = "HEAD";
            explicitMethod = true;
            break;
          case "i":
            options.includeHeaders = true;
            break;
          case "O":
            options.useRemoteName = true;
            break;
          case "v":
            options.verbose = true;
            break;
          case "G":
            options.getMode = true;
            if (!explicitMethod) options.method = "GET";
            break;
          default:
            return unknownOption("curl", `-${c}`);
        }
      }
    } else if (!arg.startsWith("-")) {
      options.url = arg;
    }
  }

  // Data/form options imply POST when no explicit method was set. `-G`/`--get`
  // keeps the request a GET and sends the payload as a query string instead.
  if (impliesPost && !explicitMethod && !options.getMode) {
    options.method = "POST";
  }

  return options;
}
