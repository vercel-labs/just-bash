/**
 * Central aggregator for command fuzz flag metadata.
 * Imports flagsForFuzzing from every command file and provides a lookup Map.
 */

import {
  flagsForFuzzing as alias,
  unaliasFlagsForFuzzing as unalias,
} from "./alias/alias.js";
import { flagsForFuzzing as awk } from "./awk/awk2.js";
import { flagsForFuzzing as base64 } from "./base64/base64.js";
// Path utilities
import { flagsForFuzzing as basename } from "./basename/basename.js";
// Shell
import {
  flagsForFuzzing as bash,
  shFlagsForFuzzing as sh,
} from "./bash/bash.js";
import { flagsForFuzzing as cat } from "./cat/cat.js";
import { flagsForFuzzing as chmod } from "./chmod/chmod.js";
import { flagsForFuzzing as clear } from "./clear/clear.js";
import { flagsForFuzzing as column } from "./column/column.js";
import { flagsForFuzzing as comm } from "./comm/comm.js";
import { flagsForFuzzing as cp } from "./cp/cp.js";
import { flagsForFuzzing as cut } from "./cut/cut.js";
import { flagsForFuzzing as date } from "./date/date.js";
import { flagsForFuzzing as diff } from "./diff/diff.js";
import { flagsForFuzzing as dirname } from "./dirname/dirname.js";
import { flagsForFuzzing as du } from "./du/du.js";
// Basic I/O
import { flagsForFuzzing as echo } from "./echo/echo.js";
// Environment
import {
  flagsForFuzzing as env,
  printenvFlagsForFuzzing as printenv,
} from "./env/env.js";
import { flagsForFuzzing as expand } from "./expand/expand.js";
import { flagsForFuzzing as unexpand } from "./expand/unexpand.js";
import { flagsForFuzzing as expr } from "./expr/expr.js";
// File type detection
import { flagsForFuzzing as file } from "./file/file.js";
// Search
import { flagsForFuzzing as find } from "./find/find.js";
import { flagsForFuzzing as fold } from "./fold/fold.js";
import type { CommandFuzzInfo } from "./fuzz-flags-types.js";
// Text processing
import {
  egrepFlagsForFuzzing as egrep,
  fgrepFlagsForFuzzing as fgrep,
  flagsForFuzzing as grep,
} from "./grep/grep.js";
// Compression
import {
  gunzipFlagsForFuzzing as gunzip,
  flagsForFuzzing as gzip,
  zcatFlagsForFuzzing as zcat,
} from "./gzip/gzip.js";
// File viewing
import { flagsForFuzzing as head } from "./head/head.js";
// Help
import { flagsForFuzzing as help } from "./help/help.js";
import { flagsForFuzzing as history } from "./history/history.js";
import { flagsForFuzzing as hostname } from "./hostname/hostname.js";
// HTML processing
import { flagsForFuzzing as htmlToMarkdown } from "./html-to-markdown/html-to-markdown.js";
import { flagsForFuzzing as join } from "./join/join.js";
// Data processing
import { flagsForFuzzing as jq } from "./jq/jq.js";
import { flagsForFuzzing as ln } from "./ln/ln.js";
// File operations
import { flagsForFuzzing as ls } from "./ls/ls.js";
// Checksums
import { flagsForFuzzing as md5sum } from "./md5sum/md5sum.js";
import { flagsForFuzzing as sha1sum } from "./md5sum/sha1sum.js";
import { flagsForFuzzing as sha256sum } from "./md5sum/sha256sum.js";
import { flagsForFuzzing as mkdir } from "./mkdir/mkdir.js";
import { flagsForFuzzing as mv } from "./mv/mv.js";
import { flagsForFuzzing as nl } from "./nl/nl.js";
import { flagsForFuzzing as od } from "./od/od.js";
import { flagsForFuzzing as paste } from "./paste/paste.js";
import { flagsForFuzzing as printf } from "./printf/printf.js";
// Navigation
import { flagsForFuzzing as pwd } from "./pwd/pwd.js";
import { flagsForFuzzing as readlink } from "./readlink/readlink.js";
import { flagsForFuzzing as rev } from "./rev/rev.js";
import { flagsForFuzzing as rg } from "./rg/rg.js";
import { flagsForFuzzing as rm } from "./rm/rm.js";
import { flagsForFuzzing as rmdir } from "./rmdir/rmdir.js";
import { flagsForFuzzing as sed } from "./sed/sed.js";
import { flagsForFuzzing as seq } from "./seq/seq.js";
import { flagsForFuzzing as sleep } from "./sleep/sleep.js";
import { flagsForFuzzing as sort } from "./sort/sort.js";
import { flagsForFuzzing as split } from "./split/split.js";
import { flagsForFuzzing as sqlite3 } from "./sqlite3/sqlite3.js";
import { flagsForFuzzing as stat } from "./stat/stat.js";
import { flagsForFuzzing as strings } from "./strings/strings.js";
// Misc utilities
import { flagsForFuzzing as tac } from "./tac/tac.js";
import { flagsForFuzzing as tail } from "./tail/tail.js";
// Browser-excluded (conditionally loaded at runtime, always importable for types)
import { flagsForFuzzing as tar } from "./tar/tar.js";
import { flagsForFuzzing as tee } from "./tee/tee.js";
import { flagsForFuzzing as time } from "./time/time.js";
import { flagsForFuzzing as timeout } from "./timeout/timeout.js";
import { flagsForFuzzing as touch } from "./touch/touch.js";
import { flagsForFuzzing as tr } from "./tr/tr.js";
// Directory utilities
import { flagsForFuzzing as tree } from "./tree/tree.js";
import {
  falseFlagsForFuzzing as falseCmd,
  flagsForFuzzing as trueCmd,
} from "./true/true.js";
import { flagsForFuzzing as uniq } from "./uniq/uniq.js";
import { flagsForFuzzing as wc } from "./wc/wc.js";
// PATH utilities
import { flagsForFuzzing as which } from "./which/which.js";
import { flagsForFuzzing as whoami } from "./whoami/whoami.js";
import { flagsForFuzzing as xan } from "./xan/xan.js";
// Utilities
import { flagsForFuzzing as xargs } from "./xargs/xargs.js";
import { flagsForFuzzing as yq } from "./yq/yq.js";

const allFuzzInfo: CommandFuzzInfo[] = [
  echo,
  cat,
  printf,
  ls,
  mkdir,
  rmdir,
  touch,
  rm,
  cp,
  mv,
  ln,
  chmod,
  pwd,
  readlink,
  head,
  tail,
  wc,
  stat,
  grep,
  fgrep,
  egrep,
  rg,
  sed,
  awk,
  sort,
  uniq,
  comm,
  cut,
  paste,
  tr,
  rev,
  nl,
  fold,
  expand,
  unexpand,
  strings,
  split,
  column,
  join,
  tee,
  find,
  basename,
  dirname,
  tree,
  du,
  env,
  printenv,
  alias,
  unalias,
  history,
  xargs,
  trueCmd,
  falseCmd,
  clear,
  bash,
  sh,
  jq,
  base64,
  diff,
  date,
  sleep,
  timeout,
  time,
  seq,
  expr,
  md5sum,
  sha1sum,
  sha256sum,
  file,
  htmlToMarkdown,
  help,
  which,
  tac,
  hostname,
  whoami,
  od,
  gzip,
  gunzip,
  zcat,
  tar,
  yq,
  xan,
  sqlite3,
];

/** Get all command fuzz info entries */
export function getAllCommandFuzzInfo(): CommandFuzzInfo[] {
  return allFuzzInfo;
}

export type { CommandFuzzInfo };
