/**
 * Types for curl command
 */

export interface FormField {
  name: string;
  value: string;
  filename?: string;
  contentType?: string;
}

/**
 * A single `-d`/`--data`/`--data-binary`/`--data-raw`/`--data-urlencode`
 * occurrence. Parts accumulate in command-line order and are joined with `&`
 * at execute time, matching real curl's behavior of combining repeated data
 * flags. Exactly one of `value` / `file` is set per part.
 */
export interface DataPart {
  /**
   * Inline value already in its final wire form: raw for `-d`/`--data`/
   * `--data-raw`/`--data-binary`, URL-encoded for inline `--data-urlencode`.
   * Undefined when the part is file-backed.
   */
  value?: string;
  /** File-backed payload (`@file` forms), read at execute time. */
  file?: DataPartFile;
}

export interface DataPartFile {
  /** Path to read; resolved against ctx.cwd at execute time. */
  path: string;
  /**
   * `ascii` (`-d`/`--data` @file): CR and LF are stripped after reading.
   * `binary` (`--data-binary` @file): file bytes are sent verbatim.
   * `urlencode` (`--data-urlencode` @file/name@file): contents are
   * URL-encoded after reading.
   */
  mode: "ascii" | "binary" | "urlencode";
  /**
   * `--data-urlencode name@file` emits a `name=` prefix before the encoded
   * file contents. Undefined for the bare `@file` form.
   */
  name?: string;
}

export interface CurlOptions {
  method: string;
  headers: Headers;
  dataParts: DataPart[];
  dataBinary: boolean;
  getMode: boolean;
  formFields: FormField[];
  user?: string;
  uploadFile?: string;
  cookieJar?: string;
  outputFile?: string;
  useRemoteName: boolean;
  headOnly: boolean;
  includeHeaders: boolean;
  silent: boolean;
  showError: boolean;
  failSilently: boolean;
  followRedirects: boolean;
  writeOut?: string;
  verbose: boolean;
  timeoutMs?: number;
  url?: string;
}
