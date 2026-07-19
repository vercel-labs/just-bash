/**
 * curl - Transfer data from or to a server
 *
 * This is a simplified implementation of curl that uses the secure fetch wrapper.
 * Network access must be explicitly configured via BashEnvOptions.network.
 */

import { fromBuffer } from "../../fs/encoding.js";
import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import { _Headers } from "../../security/trusted-globals.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import { encodeCurlData, generateMultipartBody } from "./form.js";
import { curlHelp } from "./help.js";
import { parseOptions } from "./parse.js";
import {
  applyWriteOut,
  extractFilename,
  formatHeaders,
} from "./response-formatting.js";
import type { CurlOptions } from "./types.js";

/**
 * Resolve every `-d`/`--data*`/`--data-urlencode` part into a single payload,
 * reading any `@file` references and joining the parts with `&` — matching
 * real curl's concatenation of repeated data flags. Returns undefined when no
 * data flags were given.
 *
 * Per-part `@file` handling mirrors real curl:
 *   - ascii (`-d`/`--data` @file): strip CR and LF after reading.
 *   - binary (`--data-binary` @file): send the bytes verbatim.
 *   - urlencode (`--data-urlencode` @file/name@file): URL-encode the whole
 *     file body as one value (so a `=` byte inside the file is percent-encoded
 *     rather than treated as a name/value separator), with an optional
 *     `name=` prefix.
 */
async function resolveData(
  options: CurlOptions,
  ctx: CommandContext,
): Promise<string | undefined> {
  if (options.dataParts.length === 0) return undefined;
  const parts: string[] = [];
  for (const part of options.dataParts) {
    if (part.file) {
      const filePath = ctx.fs.resolvePath(ctx.cwd, part.file.path);
      const content = await ctx.fs.readFile(filePath);
      if (part.file.mode === "ascii") {
        parts.push(content.replace(/[\r\n]/g, ""));
      } else if (part.file.mode === "binary") {
        parts.push(content);
      } else {
        const encoded = encodeCurlData(content);
        parts.push(part.file.name ? `${part.file.name}=${encoded}` : encoded);
      }
    } else {
      parts.push(part.value ?? "");
    }
  }
  return parts.join("&");
}

/**
 * Prepare request body from options, reading files if needed. `resolvedData`
 * is the already-joined `-d`/`--data*` payload (see resolveData).
 */
async function prepareRequestBody(
  options: CurlOptions,
  ctx: CommandContext,
  resolvedData: string | undefined,
): Promise<{ body?: string; contentType?: string }> {
  // Handle -T/--upload-file
  if (options.uploadFile) {
    const filePath = ctx.fs.resolvePath(ctx.cwd, options.uploadFile);
    const content = await ctx.fs.readFile(filePath);
    return { body: content };
  }

  // Handle -F/--form multipart data
  if (options.formFields.length > 0) {
    const fileContents = new Map<string, string>();

    // Read any file references
    for (const field of options.formFields) {
      if (field.value.startsWith("@") || field.value.startsWith("<")) {
        const filePath = ctx.fs.resolvePath(ctx.cwd, field.value.slice(1));
        try {
          const content = await ctx.fs.readFile(filePath);
          fileContents.set(field.value.slice(1), content);
        } catch {
          // File not found, use empty string
          fileContents.set(field.value.slice(1), "");
        }
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

/**
 * Save cookies from response to cookie jar file
 */
async function saveCookies(
  options: CurlOptions,
  headers: Record<string, string>,
  ctx: CommandContext,
): Promise<void> {
  if (!options.cookieJar) return;

  const setCookie = headers["set-cookie"];
  if (!setCookie) return;

  const filePath = ctx.fs.resolvePath(ctx.cwd, options.cookieJar);
  // Simple format: just save the raw Set-Cookie values
  await ctx.fs.writeFile(filePath, setCookie);
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
    output += `HTTP/1.1 ${result.status} ${result.statusText}\r\n`;
    output += formatHeaders(result.headers);
    output += "\r\n\r\n";
  }

  // Add body (unless head-only mode)
  if (!options.headOnly) {
    output += fetchBodyToStdoutString(result.body);
  } else if (options.includeHeaders || options.verbose) {
    // For HEAD, we already showed headers
  } else {
    // HEAD without -i shows headers
    output += `HTTP/1.1 ${result.status} ${result.statusText}\r\n`;
    output += formatHeaders(result.headers);
    output += "\r\n";
  }

  // Write-out format
  if (options.writeOut) {
    output += applyWriteOut(options.writeOut, {
      status: result.status,
      headers: result.headers,
      url: result.url,
      bodyLength: result.body.byteLength,
    });
  }

  return output;
}

export const curlCommand: Command = {
  name: "curl",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
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
    if (!url.match(/^https?:\/\//)) {
      url = `https://${url}`;
    }

    try {
      // Resolve -d/--data* payloads (reading any @file references) once, then
      // either append to the URL (-G/--get) or send as the body.
      const resolvedData = await resolveData(options, ctx);

      if (options.getMode) {
        url = appendDataToUrl(url, resolvedData);
      }

      // Prepare body and headers
      const { body, contentType } = await prepareRequestBody(
        options,
        ctx,
        resolvedData,
      );
      const headers = prepareHeaders(options, contentType);

      const result = await ctx.fetch(url, {
        method: options.method,
        headers,
        body,
        followRedirects: options.followRedirects,
        timeoutMs: options.timeoutMs,
        maxRedirects: options.maxRedirects,
        signal: ctx.signal,
      });

      // Save cookies if requested
      await saveCookies(options, result.headers, ctx);

      // Check for HTTP errors with -f/--fail
      if (options.failSilently && result.status >= 400) {
        const stderr =
          options.showError || !options.silent
            ? `curl: (22) The requested URL returned error: ${result.status}\n`
            : "";
        return { stdout: "", stderr, exitCode: 22 };
      }

      let output = buildOutput(options, result, url);

      // Write to file
      if (options.outputFile || options.useRemoteName) {
        const filename = options.outputFile || extractFilename(url);
        const filePath = ctx.fs.resolvePath(ctx.cwd, filename);
        await ctx.fs.writeFile(filePath, options.headOnly ? "" : result.body);

        // When writing to file, don't output body to stdout unless verbose
        if (!options.verbose) {
          output = "";
        }

        // Add write-out after file write
        if (options.writeOut) {
          output = applyWriteOut(options.writeOut, {
            status: result.status,
            headers: result.headers,
            url: result.url,
            bodyLength: result.body.byteLength,
          });
        }
      }

      // The response body is a latin1-shaped byte buffer (see
      // `fetchBodyToStdoutString`); any prepended headers / verbose markers are
      // ASCII, so the whole stream is byte-shaped and must be marked "bytes".
      return { stdout: output, stderr: "", exitCode: 0, stdoutKind: "bytes" };
    } catch (error) {
      const message = getErrorMessage(error);

      // Determine exit code based on error type
      let exitCode = 1;
      if (message.includes("Network access denied")) {
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
      } else if (message.includes("aborted")) {
        exitCode = 28; // CURLE_OPERATION_TIMEDOUT
      }

      // Silent mode suppresses error output unless -S is used
      const showErr = !options.silent || options.showError;
      const stderr = showErr ? `curl: (${exitCode}) ${message}\n` : "";

      return { stdout: "", stderr, exitCode };
    }
  },
};
