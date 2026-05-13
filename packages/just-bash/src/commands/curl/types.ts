/**
 * Types for curl command
 */

export interface FormField {
  name: string;
  value: string;
  filename?: string;
  contentType?: string;
}

export interface UrlencodeFile {
  /** Optional field name; emits `name=` prefix before the encoded file contents. */
  name?: string;
  /** Path to read; resolved against ctx.cwd at execute time. */
  path: string;
}

export interface DataFile {
  /**
   * `ascii` matches `-d`/`--data` semantics: CR and LF are stripped after
   * reading. `binary` matches `--data-binary`: file bytes are sent verbatim.
   */
  mode: "ascii" | "binary";
  path: string;
}

export interface CurlOptions {
  method: string;
  headers: Headers;
  data?: string;
  dataBinary: boolean;
  /**
   * File backing the `data` payload when `-d`/`--data`/`--data-binary` was
   * given as `@filename`. Mutually exclusive with `data` — whichever form
   * appears last on the command line wins. This last-write-wins shape is
   * the established just-bash behavior for `-d`/`--data*` inline values
   * and intentionally differs from real curl, which combines repeated
   * `-d` payloads with `&`. The `@file` work here preserves that scope.
   */
  dataFile?: DataFile;
  /**
   * `--data-urlencode @file` and `--data-urlencode name@file` accumulate
   * here. Each entry is encoded at execute time and joined with `&`
   * alongside any inline urlencode payload accumulated in `data`.
   */
  urlencodeFiles: UrlencodeFile[];
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
