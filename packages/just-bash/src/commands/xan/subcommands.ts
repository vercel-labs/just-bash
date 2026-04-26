/**
 * Barrel file for xan subcommand handlers
 *
 * This file re-exports all subcommands from their individual modules
 * for cleaner organization and easier maintenance.
 */

// Aggregation: agg, groupby, frequency, stats
export { cmdAgg, cmdFrequency, cmdGroupby, cmdStats } from "./xan-agg.js";

// Column operations: select, drop, rename, enum
export { cmdDrop, cmdEnum, cmdRename, cmdSelect } from "./xan-columns.js";

// Core commands: headers, count, head, tail, slice, reverse
export {
  cmdCount,
  cmdHead,
  cmdHeaders,
  cmdReverse,
  cmdSlice,
  cmdTail,
} from "./xan-core.js";
// Data utilities: transpose, shuffle, fixlengths, split, partition, to, from
export {
  cmdFixlengths,
  cmdFrom,
  cmdPartition,
  cmdShuffle,
  cmdSplit,
  cmdTo,
  cmdTranspose,
} from "./xan-data.js";
// Filter and sort: filter, sort, dedup, top
export { cmdDedup, cmdFilter, cmdSort, cmdTop } from "./xan-filter.js";
// Map and transform: computed columns
export { cmdMap, cmdTransform } from "./xan-map.js";
// Reshape: explode, implode, join, pivot, merge
export {
  cmdExplode,
  cmdImplode,
  cmdJoin,
  cmdMerge,
  cmdPivot,
} from "./xan-reshape.js";
// Simple operations: behead, sample, cat, search, flatmap, fmt
export {
  cmdBehead,
  cmdCat,
  cmdFlatmap,
  cmdFmt,
  cmdSample,
  cmdSearch,
} from "./xan-simple.js";
// View: pretty print and flatten
export { cmdFlatten, cmdView } from "./xan-view.js";
