// Automa modifications: N00b binary uploads and visible partial header output.
/**
 * curl - Transfer data from or to a server
 *
 * This is a simplified implementation of curl that uses the secure fetch wrapper.
 * Network access must be explicitly configured via BashEnvOptions.network.
 */

import {
  decodeBytesToUtf8,
  EMPTY_BYTES,
  latin1FromBytes,
  utf8ByteLength,
} from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { fromBuffer, toBuffer } from "../../fs/encoding.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import { _Headers, _performanceNow } from "../../security/trusted-globals.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import { encodeCurlData, generateMultipartBody } from "./form.js";
import { curlHelp } from "./help.js";
import { parseOptions } from "./parse.js";
import {
  applyWriteOut,
  extractFilename,
  formatHeaderBlock,
} from "./response-formatting.js";
import { curlTransportFailure, transfer } from "./transfer.js";
import type { CurlOptions } from "./types.js";

const requestDataEncoder = new TextEncoder();
const requestDataDecoder = new TextDecoder("utf8", { ignoreBOM: true });

/**
 * Resolve every `-d`/`--data*`/`--data-urlencode` part into a single payload,
 * reading any `@file` references and joining the parts with `&` — matching
 * real curl's concatenation of repeated data flags. Returns undefined when no
 * data flags were given.
 *
 * Per-part `@file` handling mirrors real curl:
 *   - ascii (`-d`/`--data` @file): strip NUL, CR, and LF after reading.
 *   - binary (`--data-binary` @file): send the bytes verbatim.
 *   - urlencode (`--data-urlencode` @file/name@file): URL-encode the whole
 *     file body as one value (so a `=` byte inside the file is percent-encoded
 *     rather than treated as a name/value separator), with an optional
 *     `name=` prefix.
 * The exact `-` source consumes command stdin once; later references are empty.
 */
async function resolveData(
  options: CurlOptions,
  ctx: RuntimeCommandContext,
): Promise<string | Uint8Array<ArrayBuffer> | undefined> {
  if (options.dataParts.length === 0) return undefined;
  const parts: (string | Uint8Array)[] = [];
  let stdinConsumed = false;
  let hasBinaryData = false;
  for (const part of options.dataParts) {
    if (part.file) {
      if (part.file.mode === "binary") {
        hasBinaryData = true;
        if (part.file.path === "-") {
          parts.push(
            toBuffer(
              latin1FromBytes(stdinConsumed ? EMPTY_BYTES : ctx.stdin),
              "binary",
            ),
          );
          stdinConsumed = true;
        } else {
          parts.push(
            await ctx.fs.readFileBuffer(
              ctx.fs.resolvePath(ctx.cwd, part.file.path),
            ),
          );
        }
        continue;
      }
      const content =
        part.file.path === "-"
          ? decodeBytesToUtf8(stdinConsumed ? EMPTY_BYTES : ctx.stdin)
          : await ctx.fs.readFile(ctx.fs.resolvePath(ctx.cwd, part.file.path));
      if (part.file.path === "-") stdinConsumed = true;
      if (part.file.mode === "ascii") {
        parts.push(content.replace(/[\x00\r\n]/g, ""));
      } else {
        const encoded = encodeCurlData(content);
        parts.push(part.file.name ? `${part.file.name}=${encoded}` : encoded);
      }
    } else {
      parts.push(part.value ?? "");
    }
  }
  if (!hasBinaryData) return parts.join("&");
  let byteLength = parts.length - 1;
  for (const part of parts) {
    byteLength +=
      typeof part === "string" ? utf8ByteLength(part) : part.byteLength;
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) {
      body[offset] = 0x26;
      offset += 1;
    }
    const part = parts[index];
    if (typeof part === "string") {
      offset += requestDataEncoder.encodeInto(
        part,
        body.subarray(offset),
      ).written;
    } else {
      body.set(part, offset);
      offset += part.byteLength;
    }
  }
  return body;
}

/**
 * Prepare request body from options, reading files if needed. `resolvedData`
 * is the already-joined `-d`/`--data*` payload (see resolveData).
 */
async function prepareRequestBody(
  options: CurlOptions,
  ctx: RuntimeCommandContext,
  resolvedData: string | Uint8Array<ArrayBuffer> | undefined,
): Promise<{ body?: string | Uint8Array<ArrayBuffer>; contentType?: string }> {
  // Handle -T/--upload-file
  if (options.uploadFile) {
    const filePath = ctx.fs.resolvePath(ctx.cwd, options.uploadFile);
    const content = await ctx.fs.readFileBuffer(filePath);
    return { body: new Uint8Array(content) };
  }

  // Handle -F/--form multipart data
  if (options.formFields.length > 0) {
    const fileContents = new Map<string, Uint8Array>();

    // Read any file references
    for (const field of options.formFields) {
      if (field.value.startsWith("@") || field.value.startsWith("<")) {
        const filePath = ctx.fs.resolvePath(ctx.cwd, field.value.slice(1));
        const content = await ctx.fs.readFileBuffer(filePath);
        fileContents.set(field.value.slice(1), content);
      }
    }

    const { body, boundary } = generateMultipartBody(
      options.formFields,
      fileContents,
    );
    return {
      body,
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  // Handle -d/--data/--data-binary/--data-raw/--data-urlencode (inline +
  // @file). In -G/--get mode the payload goes onto the URL query string
  // instead of the body (handled by the caller), so emit no body here.
  if (resolvedData !== undefined && !options.getMode) {
    return {
      body: resolvedData,
      contentType: "application/x-www-form-urlencoded",
    };
  }

  // @banned-pattern-ignore: returns typed object with known keys (body, contentType), not user data
  return {};
}

function appendDataToUrl(url: string, data: string | undefined): string {
  if (!data) return url;
  const hashIndex = url.indexOf("#");
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : url.slice(hashIndex);
  const separator =
    base.endsWith("?") || base.endsWith("&")
      ? ""
      : base.includes("?")
        ? "&"
        : "?";
  return `${base}${separator}${data}${fragment}`;
}

/**
 * Prepare request headers from options.
 * Clones the Headers object so the original is not mutated.
 */
function prepareHeaders(options: CurlOptions, contentType?: string): Headers {
  const headers = new _Headers(options.headers);

  // Add authentication header
  if (options.user) {
    const encoded = Buffer.from(options.user).toString("base64");
    headers.set("Authorization", `Basic ${encoded}`);
  }

  // Set content type if needed and not already set
  if (contentType && !headers.has("Content-Type")) {
    headers.set("Content-Type", contentType);
  }

  return headers;
}

class CurlWriteError extends Error {}
async function writeOutput(
  ctx: RuntimeCommandContext,
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  try {
    await ctx.fs.writeFile(path, data);
  } catch (error) {
    rethrowFatalExecutionError(error);
    throw new CurlWriteError(getErrorMessage(error));
  }
}

/** Cookie bytes come from an explicitly capable host, never Set-Cookie text. */
async function saveCookies(
  options: CurlOptions,
  jar: string | undefined,
  ctx: RuntimeCommandContext,
): Promise<string> {
  if (options.cookieJar === undefined) return "";
  if (typeof jar !== "string")
    throw new Error("Cookie jar export is not supported by this transport");
  const size = utf8ByteLength(jar);
  ctx.executionScope?.consumeInput(size, "curl cookie jar");
  const lease = ctx.executionScope?.reserveBytes(
    jar.length * 2,
    "curl cookie jar",
  );
  try {
    ctx.executionScope?.throwIfAborted("curl cookie jar");
    ctx.signal?.throwIfAborted();
    if (options.cookieJar === "-")
      return fromBuffer(requestDataEncoder.encode(jar), "binary");
    await writeOutput(ctx, ctx.fs.resolvePath(ctx.cwd, options.cookieJar), jar);
    return "";
  } finally {
    lease?.release();
  }
}

/** One JS character per byte for stdout (matches raw byte stream for ASCII / binary). */
function fetchBodyToStdoutString(body: Uint8Array): string {
  return fromBuffer(body, "binary");
}

function buildOutput(
  options: CurlOptions,
  result: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: Uint8Array;
    url: string;
  },
  requestUrl: string,
): string {
  let output = "";

  // Verbose output
  if (options.verbose) {
    output += `> ${options.method} ${requestUrl}\n`;
    for (const [name, value] of options.headers) {
      output += `> ${name}: ${value}\n`;
    }
    output += ">\n";
    output += `< HTTP/1.1 ${result.status} ${result.statusText}\n`;
    for (const [name, value] of Object.entries(result.headers)) {
      output += `< ${name}: ${value}\n`;
    }
    output += "<\n";
  }

  // Include headers with -i/--include
  if (options.includeHeaders && !options.verbose) {
    output += formatHeaderBlock(
      result.status,
      result.statusText,
      result.headers,
    );
  }

  // Add body (unless head-only mode)
  if (!options.headOnly) {
    output += fetchBodyToStdoutString(result.body);
  } else if (options.includeHeaders || options.verbose) {
    // For HEAD, we already showed headers
  } else {
    // HEAD without -i shows headers
    output += formatHeaderBlock(
      result.status,
      result.statusText,
      result.headers,
    );
  }

  return output;
}

export const curlCommand: RuntimeCommand = {
  name: "curl",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(curlHelp);
    }

    // Parse options first to report option errors before network check
    const parseResult = parseOptions(args);
    if ("exitCode" in parseResult) {
      return parseResult;
    }

    const options = parseResult;

    // Check for URL
    if (!options.url) {
      return {
        stdout: "",
        stderr: "curl: no URL specified\n",
        exitCode: 2,
      };
    }

    // ctx.fetch is always available when curl command exists (curl is only registered with network config)
    if (!ctx.fetch) {
      return {
        stdout: "",
        stderr: "curl: internal error: fetch not available\n",
        exitCode: 1,
      };
    }

    // Normalize URL - add https:// if no protocol
    let url = options.url;
    let dumpedHeaders = "";
    const started = _performanceNow();
    let metrics = {
      status: 0,
      headers: Object.create(null) as Record<string, string>,
      url,
      bodyLength: 0,
      timeTotal: 0,
    };
    if (!url.match(/^https?:\/\//)) {
      url = `https://${url}`;
    }

    try {
      // Resolve -d/--data* payloads (reading any @file references) once, then
      // either append to the URL (-G/--get) or send as the body.
      const resolvedData = await resolveData(options, ctx);

      if (options.getMode) {
        url = appendDataToUrl(
          url,
          resolvedData instanceof Uint8Array
            ? requestDataDecoder.decode(resolvedData)
            : resolvedData,
        );
      }

      // Prepare body and headers
      const { body, contentType } = await prepareRequestBody(
        options,
        ctx,
        resolvedData,
      );
      const headers = prepareHeaders(options, contentType);

      // Real curl truncates the dump file when the transfer starts, so a
      // failed connection does not leave stale headers from a prior run.
      if (options.dumpHeader !== undefined && options.dumpHeader !== "-") {
        const dumpPath = ctx.fs.resolvePath(ctx.cwd, options.dumpHeader);
        await writeOutput(ctx, dumpPath, "");
      }

      const { result, timeTotal } = await transfer(
        url,
        {
          method: options.method,
          headers,
          body,
          followRedirects: options.followRedirects,
          maxRedirects: options.maxRedirects,
          signal: ctx.signal,
          wantCookieJar: options.cookieJar !== undefined,
        },
        options,
        ctx,
      );

      // Save cookies if requested
      metrics = {
        status: result.status,
        headers: result.headers,
        url: result.url,
        bodyLength: result.body.byteLength,
        timeTotal,
      };
      const cookieOutput = await saveCookies(options, result.cookieJar, ctx);
      const writeOut = options.writeOut
        ? applyWriteOut(options.writeOut, metrics)
        : "";

      const finalHeaderBlock = formatHeaderBlock(
        result.status,
        result.statusText,
        result.headers,
      );
      // Concatenate intermediate redirect hops then the final response, matching
      // real `curl -D` / `-L` dumps.
      let headerBlock = "";
      if (result.redirectChain) {
        for (const hop of result.redirectChain) {
          headerBlock += formatHeaderBlock(
            hop.status,
            hop.statusText,
            hop.headers,
          );
        }
      }
      headerBlock += finalHeaderBlock;
      dumpedHeaders = options.dumpHeader === "-" ? headerBlock : "";

      // -D/--dump-header FILE writes headers even when -f fails the transfer
      // (real curl still dumps 4xx/5xx response headers).
      if (options.dumpHeader !== undefined && options.dumpHeader !== "-") {
        const dumpPath = ctx.fs.resolvePath(ctx.cwd, options.dumpHeader);
        await writeOutput(ctx, dumpPath, headerBlock);
      }

      // Check for HTTP errors with -f/--fail
      if (options.failSilently && result.status >= 400) {
        const stderr =
          options.showError || !options.silent
            ? `curl: (22) The requested URL returned error: ${result.status}\n`
            : "";
        // -D - still emits headers on stdout under -f (real curl).
        const stdout =
          (options.dumpHeader === "-" ? headerBlock : "") +
          writeOut +
          cookieOutput;
        return {
          stdout,
          stderr,
          exitCode: 22,
          stdoutKind: stdout ? "bytes" : undefined,
        };
      }

      // When the body goes to a file and we're not verbose, the block below
      // overwrites `output` unconditionally (with "" or the -D - header block),
      // so building it first would stringify the whole response body just to
      // throw the string away — a full UTF-16 copy of the payload on top of the
      // bytes we write out. Skip buildOutput entirely on that path.
      const writesToFile =
        options.outputFile !== "-" &&
        Boolean(options.outputFile || options.useRemoteName);
      const skipStdoutBody = writesToFile && !options.verbose;
      let output = skipStdoutBody ? "" : buildOutput(options, result, url);

      // Write body to file when -o/-O is set
      if (writesToFile) {
        const filename = options.outputFile || extractFilename(url);
        const filePath = ctx.fs.resolvePath(ctx.cwd, filename);
        await writeOutput(ctx, filePath, options.headOnly ? "" : result.body);

        // Body goes to the file. stdout composition:
        // - `-D -` always emits the raw header block (even with `-v`)
        // - `-v` keeps its verbose chatter (real curl sends verbose to stderr;
        //   we keep it on stdout as before, after the dump block)
        // - otherwise empty, then optional `-w`
        if (options.verbose) {
          output = (options.dumpHeader === "-" ? headerBlock : "") + output;
        } else if (options.dumpHeader === "-") {
          output = headerBlock;
        } else {
          output = "";
        }
      } else if (options.dumpHeader === "-") {
        // No -o: prepend the dump block. When -i/-I/verbose already emitted
        // headers, this doubles them the way real `curl -D - -i` does.
        output = headerBlock + output;
      }

      // The response body is a latin1-shaped byte buffer (see
      // `fetchBodyToStdoutString`); any prepended headers / verbose markers are
      // ASCII, so the whole stream is byte-shaped and must be marked "bytes".
      return {
        stdout: output + writeOut + cookieOutput,
        stderr: "",
        exitCode: 0,
        stdoutKind: "bytes",
      };
    } catch (error) {
      if (error instanceof ExecutionLimitError && dumpedHeaders) {
        error.prependOutput(dumpedHeaders, "");
      }
      ctx.executionScope?.throwIfAborted("curl");
      ctx.signal?.throwIfAborted();
      rethrowFatalExecutionError(error);
      const message = getErrorMessage(error);

      // Determine exit code based on error type
      let exitCode = 1;
      if (error instanceof CurlWriteError) {
        exitCode = 23;
      } else if (message.includes("Network access denied")) {
        exitCode = 7; // CURLE_COULDNT_CONNECT
      } else if (
        message.includes("HTTP method") &&
        message.includes("not allowed")
      ) {
        exitCode = 3; // CURLE_URL_MALFORMAT-like (method restriction)
      } else if (message.includes("Redirect target not in allow-list")) {
        exitCode = 47; // CURLE_TOO_MANY_REDIRECTS-like
      } else if (message.includes("Too many redirects")) {
        exitCode = 47; // CURLE_TOO_MANY_REDIRECTS
      } else if (curlTransportFailure(error) === "network") {
        exitCode = 7;
      } else if (curlTransportFailure(error) === "timeout") {
        exitCode = 28; // CURLE_OPERATION_TIMEDOUT
      }

      // Silent mode suppresses error output unless -S is used
      const showErr = !options.silent || options.showError;
      const stderr = showErr ? `curl: (${exitCode}) ${message}\n` : "";

      return {
        stdout:
          dumpedHeaders +
          (options.writeOut
            ? applyWriteOut(options.writeOut, {
                ...metrics,
                timeTotal: (_performanceNow() - started) / 1000,
              })
            : ""),
        stderr,
        exitCode,
        stdoutKind: dumpedHeaders ? "bytes" : undefined,
      };
    }
  },
};
