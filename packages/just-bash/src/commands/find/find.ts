import { utf8ByteLength } from "../../encoding.js";
import { ExecutionOutputAccumulator } from "../../execution-output.js";
import type { ExecutionScope } from "../../execution-scope.js";
import type { DirentEntry } from "../../fs/interface.js";
import { FileTraversalBudget } from "../../fs/traversal.js";
import { shellJoinArgs } from "../../helpers/shell-quote.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
  TraceCallback,
} from "../../types.js";
import { formatMode } from "../format-mode.js";

// Use a larger batch size for find to maximize parallel I/O
const FIND_BATCH_SIZE = 500;

// Tracing helpers
interface TraceCounters {
  readdirCalls: number;
  readdirTime: number;
  statCalls: number;
  statTime: number;
  evalCalls: number;
  evalTime: number;
  nodeCount: number;
  batchCount: number;
  batchTime: number;
  earlyPrunes: number;
}

function createTraceCounters(): TraceCounters {
  return {
    readdirCalls: 0,
    readdirTime: 0,
    statCalls: 0,
    statTime: 0,
    evalCalls: 0,
    evalTime: 0,
    nodeCount: 0,
    batchCount: 0,
    batchTime: 0,
    earlyPrunes: 0,
  };
}

function emitTraceSummary(
  trace: TraceCallback,
  counters: TraceCounters,
  totalMs: number,
): void {
  trace({
    category: "find",
    name: "summary",
    durationMs: totalMs,
    details: {
      readdirCalls: counters.readdirCalls,
      readdirTimeMs: counters.readdirTime,
      statCalls: counters.statCalls,
      statTimeMs: counters.statTime,
      evalCalls: counters.evalCalls,
      evalTimeMs: counters.evalTime,
      nodeCount: counters.nodeCount,
      batchCount: counters.batchCount,
      batchTimeMs: counters.batchTime,
      earlyPrunes: counters.earlyPrunes,
      otherTimeMs:
        totalMs -
        counters.readdirTime -
        counters.statTime -
        counters.evalTime -
        counters.batchTime,
    },
  });
}

import { hasHelpFlag, showHelp } from "../help.js";
import {
  applyWidth,
  parseWidthPrecision,
  processEscapes,
} from "../printf/escapes.js";
import {
  collectNewerRefs,
  evaluateExpressionWithPrune,
  evaluateForEarlyPrune,
  evaluateSimpleExpression,
  expressionHasPrune,
  expressionNeedsEmptyCheck,
  expressionNeedsStatMetadata,
  isSimpleExpression,
} from "./matcher.js";
import { parseExpressions } from "./parser.js";
import type {
  EvalContext,
  EvalResult,
  Expression,
  FindAction,
} from "./types.js";

const findHelp = {
  name: "find",
  summary: "search for files in a directory hierarchy",
  usage: "find [path...] [expression]",
  options: [
    "-name PATTERN    file name matches shell pattern PATTERN",
    "-iname PATTERN   like -name but case insensitive",
    "-path PATTERN    file path matches shell pattern PATTERN",
    "-ipath PATTERN   like -path but case insensitive",
    "-regex PATTERN   file path matches regular expression PATTERN",
    "-iregex PATTERN  like -regex but case insensitive",
    "-type TYPE       file is of type: f (regular file), d (directory)",
    "-empty           file is empty or directory is empty",
    "-mtime N         file's data was modified N*24 hours ago",
    "-newer FILE      file was modified more recently than FILE",
    "-size N[ckMGb]   file uses N units of space (c=bytes, k=KB, M=MB, G=GB, b=512B blocks)",
    "-perm MODE       file's permission bits are exactly MODE (octal)",
    "-perm -MODE      all permission bits MODE are set",
    "-perm /MODE      any permission bits MODE are set",
    "-maxdepth LEVELS descend at most LEVELS directories",
    "-mindepth LEVELS do not apply tests at levels less than LEVELS",
    "-depth           process directory contents before directory itself",
    "-prune           do not descend into this directory",
    "-not, !          negate the following expression",
    "-a, -and         logical AND (default)",
    "-o, -or          logical OR",
    "-exec CMD {} ;   execute CMD on each file ({} is replaced by filename)",
    "-exec CMD {} +   execute CMD with multiple files at once",
    "-print           print the full file name (default action)",
    "-print0          print the full file name followed by a null character",
    "-printf FORMAT   print FORMAT with directives: %f %h %p %P %s %d %m %M %t",
    "-delete          delete found files/directories",
    "    --help       display this help and exit",
  ],
};

export const findCommand: RuntimeCommand = {
  name: "find",
  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(findHelp);
    }

    const searchPaths: string[] = [];
    let maxDepth: number | null = null;
    let minDepth: number | null = null;
    let depthFirst = false;

    // Starting points must precede the expression. Separating them first keeps
    // predicate operands and -exec command arguments from being mistaken for paths.
    let expressionStart = args.length;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (
        arg.startsWith("-") ||
        arg === "(" ||
        arg === "\\(" ||
        arg === ")" ||
        arg === "\\)" ||
        arg === "!"
      ) {
        expressionStart = i;
        break;
      }
      searchPaths.push(arg);
    }

    // Default to current directory if no paths specified
    if (searchPaths.length === 0) {
      searchPaths.push(".");
    }

    // Validate traversal options before parsing or touching the filesystem.
    for (let i = expressionStart; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-exec") {
        i++;
        while (i < args.length && args[i] !== ";" && args[i] !== "+") i++;
      } else if (arg === "-maxdepth" || arg === "-mindepth") {
        const value = args[i + 1];
        if (value === undefined || !/^\d+$/.test(value)) {
          return {
            stdout: "",
            stderr:
              value === undefined
                ? `find: missing argument to \`${arg}'\n`
                : `find: invalid argument \`${value}' to \`${arg}'\n`,
            exitCode: 1,
          };
        }
        const depth = Number(value);
        if (!Number.isSafeInteger(depth)) {
          return {
            stdout: "",
            stderr: `find: invalid argument \`${value}' to \`${arg}'\n`,
            exitCode: 1,
          };
        }
        if (arg === "-maxdepth") maxDepth = depth;
        else minDepth = depth;
        i++;
      } else if (arg === "-depth") {
        depthFirst = true;
      }
    }

    // Parse the complete expression before any filesystem access or action.
    const { expr, error } = parseExpressions(args, expressionStart);

    // Return error for unknown predicates
    if (error) {
      return { stdout: "", stderr: error, exitCode: 1 };
    }

    const expressionActions = collectActions(expr);
    const hasAnyAction = expressionActions.length > 0;
    if (expressionActions.some((a) => a.type === "delete")) depthFirst = true;

    // Result type for find entries
    interface FindResult {
      path: string;
      name: string;
      size: number;
      mtime: number;
      mode: number;
      isDirectory: boolean;
      depth: number;
      startingPoint: string;
    }

    interface EvaluatedEffect {
      action: FindAction;
      path: string;
      printfData: FindResult;
    }
    const effects: EvaluatedEffect[] = [];
    let exitCode = 0;
    const output = ctx.executionScope
      ? new ExecutionOutputAccumulator(
          ctx.executionScope as ExecutionScope,
          "find",
        )
      : undefined;
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let fallbackOutputBytes = 0;
    const traversalBudget = new FileTraversalBudget({
      limits: ctx.limits,
      signal: ctx.signal,
      executionScope: ctx.executionScope,
      site: "find",
    });
    const appendStdout = (value: string): void => {
      if (output) output.append("stdout", value);
      else {
        const bytes = utf8ByteLength(value);
        if (bytes > ctx.limits.maxOutputSize - fallbackOutputBytes) {
          throw new ExecutionLimitError(
            `find: output size limit exceeded (${ctx.limits.maxOutputSize} bytes)`,
            "output_size",
          );
        }
        if (value) stdoutChunks.push(value);
        fallbackOutputBytes += bytes;
      }
    };
    const appendStderr = (value: string): void => {
      if (output) output.append("stderr", value);
      else {
        const bytes = utf8ByteLength(value);
        if (bytes > ctx.limits.maxOutputSize - fallbackOutputBytes) {
          throw new ExecutionLimitError(
            `find: output size limit exceeded (${ctx.limits.maxOutputSize} bytes)`,
            "output_size",
          );
        }
        if (value) stderrChunks.push(value);
        fallbackOutputBytes += bytes;
      }
    };

    // Collect and resolve -newer reference file mtimes
    const newerRefPaths = collectNewerRefs(expr);
    const newerRefTimes = new Map<string, number>();

    for (const refPath of newerRefPaths) {
      const refFullPath = ctx.fs.resolvePath(ctx.cwd, refPath);
      try {
        const refStat = await ctx.fs.stat(refFullPath);
        newerRefTimes.set(refPath, refStat.mtime?.getTime() ?? Date.now());
      } catch {
        // Reference file doesn't exist, -newer will always be false
      }
    }

    // Check if printf format needs stat metadata
    // Simple directives: %f %h %p %P %d %% don't need stat
    // Stat-dependent: %s %m %M %t %T need stat
    const printfNeedsStat = expressionActions.some((a) => {
      if (a.type !== "printf") return false;
      // Check for stat-dependent directives: %s %m %M %t %T
      // But skip escaped %% and handle width/precision modifiers like %10s or %-5.2s
      const format = a.format.replace(/%%/g, "");
      return /%[-+]?[0-9]*\.?[0-9]*(s|m|M|t|T)/.test(format);
    });

    // Check if expression needs full stat metadata (optimization)
    const needsStatMetadata =
      expressionNeedsStatMetadata(expr) || printfNeedsStat;

    // Check if expression uses -empty (needs to read directories to count entries)
    const needsEmptyCheck = expressionNeedsEmptyCheck(expr);

    // Check if expression has -prune (for early prune optimization)
    const hasPruneExpr = expressionHasPrune(expr);

    // Check if expression is simple (only name/path/type/prune/print)
    // Simple expressions can use the fast-path that avoids EvalContext allocation
    const isSimpleExpr = isSimpleExpression(expr);

    // Check if readdirWithFileTypes is available (for optimization)
    const hasReaddirWithFileTypes =
      typeof ctx.fs.readdirWithFileTypes === "function";

    // Process each search path
    for (let searchPath of searchPaths) {
      // Normalize trailing slashes (except for root "/")
      if (searchPath.length > 1 && searchPath.endsWith("/")) {
        searchPath = searchPath.slice(0, -1);
      }
      const basePath = ctx.fs.resolvePath(ctx.cwd, searchPath);

      // Check if path exists
      try {
        await ctx.fs.stat(basePath);
      } catch {
        appendStderr(`find: ${searchPath}: No such file or directory\n`);
        exitCode = 1;
        continue;
      }

      // Work item for iterative traversal
      interface WorkItem {
        path: string;
        depth: number;
        typeInfo?: { isFile: boolean; isDirectory: boolean };
        // For ordered results: index where this item's results go
        resultIndex: number;
      }

      // Processed node info
      interface ProcessedNode {
        relativePath: string;
        name: string;
        isFile: boolean;
        isDirectory: boolean;
        isEmpty: boolean;
        stat?: Awaited<ReturnType<typeof ctx.fs.stat>>;
        depth: number;
        children: WorkItem[];
        pruned: boolean;
      }

      // Tracing counters
      const traceCounters = createTraceCounters();
      const traceStartTime = Date.now();

      // Process a single node: get stat, children, check prune
      async function processNode(
        item: WorkItem,
      ): Promise<ProcessedNode | null> {
        const { path: currentPath, depth, typeInfo } = item;
        traversalBudget.visit(depth);
        traceCounters.nodeCount++;

        // The shared traversal limit remains in force even without -maxdepth.
        if (depth > (maxDepth ?? ctx.limits.maxTraversalDepth)) {
          return null;
        }

        // Get type info
        let isFile: boolean;
        let isDirectory: boolean;
        let stat: Awaited<ReturnType<typeof ctx.fs.stat>> | undefined;

        if (typeInfo && !needsStatMetadata) {
          isFile = typeInfo.isFile;
          isDirectory = typeInfo.isDirectory;
        } else {
          try {
            const statStart = Date.now();
            // find defaults to the POSIX -P policy: inspect symlinks, never
            // follow them while deciding whether to descend.
            stat = await ctx.fs.lstat(currentPath);
            traceCounters.statCalls++;
            traceCounters.statTime += Date.now() - statStart;
          } catch {
            return null;
          }
          if (!stat) return null;
          isFile = stat.isFile;
          isDirectory = stat.isDirectory;
        }

        // Compute name and relative path
        let name: string;
        if (currentPath === basePath) {
          name = searchPath.split("/").pop() || searchPath;
        } else {
          name = currentPath.split("/").pop() || "";
        }

        const relativePath =
          currentPath === basePath
            ? searchPath
            : searchPath === "."
              ? `./${currentPath.slice(basePath === "/" ? basePath.length : basePath.length + 1)}`
              : searchPath + currentPath.slice(basePath.length);

        // Get children for directories
        const children: WorkItem[] = [];
        let entriesWithTypes: DirentEntry[] | null = null;
        let entries: string[] | null = null;

        // Early prune optimization: check if we can skip this directory before readdir
        // This avoids reading directory contents for directories that will be pruned
        let earlyPruned = false;
        if (isDirectory && hasPruneExpr && !depthFirst) {
          const earlyResult = evaluateForEarlyPrune(expr, {
            name,
            relativePath,
            isFile,
            isDirectory,
          });
          earlyPruned = earlyResult.shouldPrune;
          if (earlyPruned) {
            traceCounters.earlyPrunes++;
          }
        }

        // Optimization: skip reading directory contents if we're at maxdepth
        // Exception: if -empty is used, we need to read to check if directory is empty
        const atMaxDepth = depth >= (maxDepth ?? ctx.limits.maxTraversalDepth);
        const shouldDescendIntoSubdirs = !atMaxDepth && !earlyPruned;
        const shouldReadDir =
          (shouldDescendIntoSubdirs || needsEmptyCheck) && !earlyPruned;

        if (isDirectory && shouldReadDir) {
          const readdirStart = Date.now();
          if (hasReaddirWithFileTypes && ctx.fs.readdirWithFileTypes) {
            entriesWithTypes = await ctx.fs.readdirWithFileTypes(currentPath);
            traversalBudget.checkpoint();
            traversalBudget.discover(entriesWithTypes.length);
            entries = [];
            for (const entry of entriesWithTypes) entries.push(entry.name);
            traceCounters.readdirCalls++;
            traceCounters.readdirTime += Date.now() - readdirStart;
            // Create children work items
            // In terminal directory (e.g., "pulls" for pattern "*/pulls/*.json"),
            // only process files, not subdirectories
            if (shouldDescendIntoSubdirs) {
              for (let idx = 0; idx < entriesWithTypes.length; idx++) {
                const entry = entriesWithTypes[idx];
                children.push({
                  path:
                    currentPath === "/"
                      ? `/${entry.name}`
                      : `${currentPath}/${entry.name}`,
                  depth: depth + 1,
                  typeInfo: {
                    isFile: entry.isFile,
                    isDirectory: entry.isDirectory,
                  },
                  resultIndex: idx,
                });
              }
            }
          } else {
            entries = await ctx.fs.readdir(currentPath);
            traversalBudget.checkpoint();
            traversalBudget.discover(entries.length);
            traceCounters.readdirCalls++;
            traceCounters.readdirTime += Date.now() - readdirStart;
            // Create children work items
            if (shouldDescendIntoSubdirs) {
              for (let idx = 0; idx < entries.length; idx++) {
                const entry = entries[idx];
                children.push({
                  path:
                    currentPath === "/"
                      ? `/${entry}`
                      : `${currentPath}/${entry}`,
                  depth: depth + 1,
                  resultIndex: idx,
                });
              }
            }
          }
        }

        const isEmpty = isFile
          ? (stat?.size ?? 0) === 0
          : entries !== null && entries.length === 0;

        // Check for pruning (only in pre-order mode when expression has -prune)
        // If we already early-pruned, use that result
        // Skip this evaluation entirely if there's no -prune in the expression
        let pruned = earlyPruned;
        if (!depthFirst && expr !== null && !earlyPruned && hasPruneExpr) {
          const evalStart = Date.now();
          const evalCtx: EvalContext = {
            name,
            relativePath,
            isFile,
            isDirectory,
            isEmpty,
            mtime: stat?.mtime?.getTime() ?? Date.now(),
            size: stat?.size ?? 0,
            mode: stat?.mode ?? 0o644,
            newerRefTimes,
          };
          const evalResult = evaluateExpressionWithPrune(expr, evalCtx);
          pruned = evalResult.pruned;
          traceCounters.evalCalls++;
          traceCounters.evalTime += Date.now() - evalStart;
        }

        return {
          relativePath,
          name,
          isFile,
          isDirectory,
          isEmpty,
          stat,
          depth,
          children: pruned ? [] : children,
          pruned,
        };
      }

      // Evaluate once in traversal order and retain only actions whose branch was
      // actually reached. Side effects themselves run after traversal is complete.
      function evaluateNode(node: ProcessedNode): EvaluatedEffect[] {
        const atOrBeyondMinDepth = minDepth === null || node.depth >= minDepth;
        if (!atOrBeyondMinDepth) return [];

        let matches = true;
        let reachedActions: FindAction[] = [];

        if (expr !== null) {
          const evalStart = Date.now();
          let evalResult: EvalResult;

          // Use fast-path for simple expressions to avoid EvalContext allocation
          if (isSimpleExpr) {
            evalResult = evaluateSimpleExpression(
              expr,
              node.name,
              node.relativePath,
              node.isFile,
              node.isDirectory,
            );
          } else {
            const evalCtx: EvalContext = {
              name: node.name,
              relativePath: node.relativePath,
              isFile: node.isFile,
              isDirectory: node.isDirectory,
              isEmpty: node.isEmpty,
              mtime: node.stat?.mtime?.getTime() ?? Date.now(),
              size: node.stat?.size ?? 0,
              mode: node.stat?.mode ?? 0o644,
              newerRefTimes,
            };
            evalResult = evaluateExpressionWithPrune(expr, evalCtx);
          }

          matches = evalResult.matches;
          reachedActions = evalResult.actions ?? [];
          traceCounters.evalCalls++;
          traceCounters.evalTime += Date.now() - evalStart;
        }

        if (!hasAnyAction && matches) {
          reachedActions = [{ type: "print" }];
        }
        if (reachedActions.length === 0) return [];

        const printfData: FindResult = {
          path: node.relativePath,
          name: node.name,
          size: node.stat?.size ?? 0,
          mtime: node.stat?.mtime?.getTime() ?? Date.now(),
          mode: node.stat?.mode ?? 0o644,
          isDirectory: node.isDirectory,
          depth: node.depth,
          startingPoint: searchPath,
        };
        traversalBudget.checkpoint(reachedActions.length);
        const evaluated: EvaluatedEffect[] = [];
        for (const action of reachedActions) {
          evaluated.push({
            action,
            path: node.relativePath,
            printfData,
          });
        }
        return evaluated;
      }

      // Result collection for ordered results
      interface NodeResult {
        effects: EvaluatedEffect[];
      }

      // Iterative depth-first traversal with parallel processing
      // Uses work array with slot-based result collection for ordering
      async function findIterative(): Promise<NodeResult> {
        const finalResult: NodeResult = { effects: [] };

        // For depth-first (post-order), we use a different strategy:
        // 1. Discover all nodes level by level (BFS with parallel batches)
        // 2. Track parent-child relationships
        // 3. Build results bottom-up maintaining tree order

        if (depthFirst) {
          // Phase 1: Discover all nodes (BFS to get structure)
          interface DiscoveredNode {
            node: ProcessedNode;
            parentIndex: number; // -1 for root
            childIndices: number[]; // filled in after all children discovered
          }

          const discovered: DiscoveredNode[] = [];

          // Queue item includes parent index for tracking
          interface QueueItem {
            item: WorkItem;
            parentIndex: number;
            childOrderInParent: number; // which child of parent this is
          }

          const workQueue: QueueItem[] = [
            {
              item: { path: basePath, depth: 0, resultIndex: 0 },
              parentIndex: -1,
              childOrderInParent: 0,
            },
          ];

          // Track which discovered index each queue item will become
          const parentChildMap = new Map<number, number[]>(); // parentIdx -> [childIdx in order]

          // BFS to discover all nodes with parallel processing
          let workCursor = 0;
          while (workCursor < workQueue.length) {
            const batchStart = Date.now();
            const batchEnd = Math.min(
              workQueue.length,
              workCursor + FIND_BATCH_SIZE,
            );
            const batch = workQueue.slice(workCursor, batchEnd);
            workCursor = batchEnd;
            const nodes = await Promise.all(
              batch.map((q) => processNode(q.item)),
            );
            traceCounters.batchCount++;
            traceCounters.batchTime += Date.now() - batchStart;

            for (let i = 0; i < batch.length; i++) {
              const node = nodes[i];
              const queueItem = batch[i];
              if (!node) continue;

              const thisIndex = discovered.length;

              // Register this node with its parent
              if (queueItem.parentIndex >= 0) {
                const siblings =
                  parentChildMap.get(queueItem.parentIndex) || [];
                siblings.push(thisIndex);
                parentChildMap.set(queueItem.parentIndex, siblings);
              }

              discovered.push({
                node,
                parentIndex: queueItem.parentIndex,
                childIndices: [], // will be filled from parentChildMap
              });

              // Add children to work queue
              for (let j = 0; j < node.children.length; j++) {
                workQueue.push({
                  item: node.children[j],
                  parentIndex: thisIndex,
                  childOrderInParent: j,
                });
              }
            }
          }

          // Fill in childIndices from parentChildMap
          for (const [parentIdx, childIndices] of parentChildMap) {
            if (parentIdx >= 0 && parentIdx < discovered.length) {
              discovered[parentIdx].childIndices = childIndices;
            }
          }

          // Phase 2: Build post-order iteratively. Recursive reconstruction can
          // overflow the host stack at traversal depths that are deliberately
          // valid under a liberal normal profile.
          if (discovered.length > 0) {
            const stack: Array<{ index: number; visited: boolean }> = [
              { index: 0, visited: false },
            ];
            while (stack.length > 0) {
              traversalBudget.checkpoint();
              const current = stack.pop();
              if (!current) break;
              const entry = discovered[current.index];
              if (!entry) continue;
              if (current.visited) {
                for (const effect of evaluateNode(entry.node)) {
                  finalResult.effects.push(effect);
                }
                continue;
              }
              stack.push({ index: current.index, visited: true });
              for (let i = entry.childIndices.length - 1; i >= 0; i--) {
                stack.push({ index: entry.childIndices[i], visited: false });
              }
            }
          }
        } else {
          // Pre-order traversal using BFS with batched processing
          // This maximizes parallelism while maintaining pre-order output

          interface NodeWithOrder {
            node: ProcessedNode;
            orderIndex: number;
          }

          const nodeResults: Map<number, EvaluatedEffect[]> = new Map();
          let orderCounter = 0;

          // BFS queue with order tracking
          const workQueue: Array<{ item: WorkItem; orderIndex: number }> = [
            {
              item: { path: basePath, depth: 0, resultIndex: 0 },
              orderIndex: orderCounter++,
            },
          ];

          // Track child order indices for each parent
          const childOrders: Map<number, number[]> = new Map();

          let workCursor = 0;
          while (workCursor < workQueue.length) {
            // Process all items in the queue in parallel batches
            const batchStart = Date.now();
            const batchEnd = Math.min(
              workQueue.length,
              workCursor + FIND_BATCH_SIZE,
            );
            const batch = workQueue.slice(workCursor, batchEnd);
            workCursor = batchEnd;
            const processed: Array<NodeWithOrder | null> = await Promise.all(
              batch.map(async ({ item, orderIndex }) => {
                const node = await processNode(item);
                return node ? { node, orderIndex } : null;
              }),
            );
            traceCounters.batchCount++;
            traceCounters.batchTime += Date.now() - batchStart;

            for (const result of processed) {
              if (!result) continue;
              const { node, orderIndex } = result;

              const nodeEffects = evaluateNode(node);
              if (nodeEffects.length > 0)
                nodeResults.set(orderIndex, nodeEffects);

              // Add children to work queue with consecutive order indices
              if (node.children.length > 0) {
                const childIndices: number[] = [];
                for (const child of node.children) {
                  const childOrder = orderCounter++;
                  childIndices.push(childOrder);
                  workQueue.push({ item: child, orderIndex: childOrder });
                }
                childOrders.set(orderIndex, childIndices);
              }
            }
          }

          // Build result in pre-order with an explicit stack.
          const collectionStack = [0];
          while (collectionStack.length > 0) {
            traversalBudget.checkpoint();
            const orderIndex = collectionStack.pop();
            if (orderIndex === undefined) break;
            const nodeResult = nodeResults.get(orderIndex);
            if (nodeResult) {
              for (const effect of nodeResult) {
                finalResult.effects.push(effect);
              }
            }
            const children = childOrders.get(orderIndex);
            if (children) {
              for (let i = children.length - 1; i >= 0; i--) {
                collectionStack.push(children[i]);
              }
            }
          }
        }

        return finalResult;
      }

      const searchResult = await findIterative();
      for (const effect of searchResult.effects) effects.push(effect);

      // Emit trace summary for this search path
      if (ctx.trace) {
        const totalMs = Date.now() - traceStartTime;
        emitTraceSummary(ctx.trace, traceCounters, totalMs);
        ctx.trace({
          category: "find",
          name: "searchPath",
          durationMs: totalMs,
          details: {
            path: searchPath,
            resultsFound: searchResult.effects.length,
          },
        });
      }
    }

    // Batch -exec nodes collect only paths for which that exact expression node
    // was reached. All other effects retain entry and expression order.
    const batchExecPaths = new Map<FindAction, string[]>();
    for (const effect of effects) {
      const { action, path: file } = effect;
      switch (action.type) {
        case "print":
          appendStdout(`${file}\n`);
          break;
        case "print0":
          appendStdout(`${file}\0`);
          break;
        case "printf":
          appendStdout(formatFindPrintf(action.format, effect.printfData));
          break;
        case "delete": {
          const fullPath = ctx.fs.resolvePath(ctx.cwd, file);
          try {
            await ctx.fs.rm(fullPath, { recursive: false });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            appendStderr(`find: cannot delete '${file}': ${msg}\n`);
            exitCode = 1;
          }
          break;
        }
        case "exec": {
          if (!ctx.exec) {
            return {
              stdout: "",
              stderr: "find: -exec not supported in this context\n",
              exitCode: 1,
            };
          }
          if (action.batchMode) {
            const paths = batchExecPaths.get(action) ?? [];
            paths.push(file);
            batchExecPaths.set(action, paths);
            break;
          }
          const cmdWithFile = action.command.map((part) =>
            part === "{}" ? file : part,
          );
          const result = await ctx.exec(shellJoinArgs([cmdWithFile[0]]), {
            cwd: ctx.cwd,
            signal: ctx.signal,
            args: cmdWithFile.slice(1),
          });
          if (output) output.appendResult(result);
          else {
            appendStdout(result.stdout);
            appendStderr(result.stderr);
          }
          if (result.exitCode !== 0) exitCode = result.exitCode;
          break;
        }
      }
    }

    for (const [action, paths] of batchExecPaths) {
      if (action.type !== "exec" || !ctx.exec || paths.length === 0) continue;
      const cmdWithFiles: string[] = [];
      for (const part of action.command) {
        if (part === "{}") cmdWithFiles.push(...paths);
        else cmdWithFiles.push(part);
      }
      const result = await ctx.exec(shellJoinArgs([cmdWithFiles[0]]), {
        cwd: ctx.cwd,
        signal: ctx.signal,
        args: cmdWithFiles.slice(1),
      });
      if (output) output.appendResult(result);
      else {
        appendStdout(result.stdout);
        appendStderr(result.stderr);
      }
      if (result.exitCode !== 0) exitCode = result.exitCode;
    }

    return (
      output?.build(exitCode) ?? {
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        exitCode,
      }
    );
  },
};

function collectActions(expr: Expression | null): FindAction[] {
  if (!expr) return [];
  if (expr.type === "action") return [expr.action];
  if (expr.type === "not") return collectActions(expr.expr);
  if (expr.type === "and" || expr.type === "or") {
    return [...collectActions(expr.left), ...collectActions(expr.right)];
  }
  return [];
}

/**
 * Format a find -printf format string
 * Supported directives (all support optional width/precision like %-20.10f):
 * %f - file basename (filename without directory)
 * %h - directory name (dirname)
 * %p - full path
 * %P - path without starting point
 * %s - file size in bytes
 * %d - depth in directory tree
 * %m - permissions in octal (without leading 0)
 * %M - symbolic permissions like -rwxr-xr-x
 * %t - modification time in ctime format
 * %T@ - modification time as seconds since epoch
 * %Tk - modification time with strftime format k
 * %% - literal %
 * Also processes escape sequences: \n, \t, etc.
 */
function formatFindPrintf(
  format: string,
  result: {
    path: string;
    name: string;
    size: number;
    mtime: number;
    mode: number;
    isDirectory: boolean;
    depth: number;
    startingPoint: string;
  },
): string {
  // First process escape sequences
  const processed = processEscapes(format);

  let output = "";
  let i = 0;

  while (i < processed.length) {
    if (processed[i] === "%" && i + 1 < processed.length) {
      i++; // skip %

      // Check for %% first
      if (processed[i] === "%") {
        output += "%";
        i++;
        continue;
      }

      // Parse optional width/precision (e.g., %-20.10)
      const [width, precision, consumed] = parseWidthPrecision(processed, i);
      i += consumed;

      if (i >= processed.length) {
        output += "%";
        break;
      }

      const directive = processed[i];
      let value: string;

      switch (directive) {
        case "f":
          // Filename (basename)
          value = result.name;
          i++;
          break;
        case "h": {
          // Directory (dirname)
          const lastSlash = result.path.lastIndexOf("/");
          value = lastSlash > 0 ? result.path.slice(0, lastSlash) : ".";
          i++;
          break;
        }
        case "p":
          // Full path
          value = result.path;
          i++;
          break;
        case "P": {
          // Path without starting point
          const sp = result.startingPoint;
          if (result.path === sp) {
            value = "";
          } else if (result.path.startsWith(`${sp}/`)) {
            value = result.path.slice(sp.length + 1);
          } else if (sp === "." && result.path.startsWith("./")) {
            value = result.path.slice(2);
          } else {
            value = result.path;
          }
          i++;
          break;
        }
        case "s":
          // File size in bytes
          value = String(result.size);
          i++;
          break;
        case "d":
          // Depth in directory tree
          value = String(result.depth);
          i++;
          break;
        case "m":
          // Permissions in octal (without leading 0)
          value = (result.mode & 0o777).toString(8);
          i++;
          break;
        case "M":
          // Symbolic permissions
          value = formatMode(result.mode, result.isDirectory);
          i++;
          break;
        case "t": {
          // Modification time in ctime format
          const date = new Date(result.mtime);
          value = formatCtimeDate(date);
          i++;
          break;
        }
        case "T": {
          // Time format: %T@ for epoch, %TY for year, etc.
          if (i + 1 < processed.length) {
            const timeFormat = processed[i + 1];
            const date = new Date(result.mtime);
            value = formatTimeDirective(date, timeFormat);
            i += 2;
          } else {
            value = "%T";
            i++;
          }
          break;
        }
        default:
          // Unknown directive, keep as-is
          output += `%${width !== 0 || precision !== -1 ? `${width}.${precision}` : ""}${directive}`;
          i++;
          continue;
      }

      // Apply width/precision formatting using shared utility
      output += applyWidth(value, width, precision);
    } else {
      output += processed[i];
      i++;
    }
  }

  return output;
}

// formatMode imported from ../format-mode.js

/**
 * Format date in ctime format: "Wed Dec 25 12:34:56 2024"
 */
function formatCtimeDate(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const day = days[date.getDay()];
  const month = months[date.getMonth()];
  const dayNum = String(date.getDate()).padStart(2, " ");
  const hours = String(date.getHours()).padStart(2, "0");
  const mins = String(date.getMinutes()).padStart(2, "0");
  const secs = String(date.getSeconds()).padStart(2, "0");
  const year = date.getFullYear();

  return `${day} ${month} ${dayNum} ${hours}:${mins}:${secs} ${year}`;
}

/**
 * Format time with %T directive format character
 */
function formatTimeDirective(date: Date, format: string): string {
  switch (format) {
    case "@":
      // Seconds since epoch (with fractional part)
      return String(date.getTime() / 1000);
    case "Y":
      // Year with century
      return String(date.getFullYear());
    case "m":
      // Month (01-12)
      return String(date.getMonth() + 1).padStart(2, "0");
    case "d":
      // Day of month (01-31)
      return String(date.getDate()).padStart(2, "0");
    case "H":
      // Hour (00-23)
      return String(date.getHours()).padStart(2, "0");
    case "M":
      // Minute (00-59)
      return String(date.getMinutes()).padStart(2, "0");
    case "S":
      // Second (00-59)
      return String(date.getSeconds()).padStart(2, "0");
    case "T":
      // Time as HH:MM:SS
      return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
    case "F":
      // Date as YYYY-MM-DD
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    default:
      return `%T${format}`;
  }
}

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "find",
  flags: [
    { flag: "-name", type: "value", valueHint: "pattern" },
    { flag: "-iname", type: "value", valueHint: "pattern" },
    { flag: "-type", type: "value", valueHint: "string" },
    { flag: "-maxdepth", type: "value", valueHint: "number" },
    { flag: "-mindepth", type: "value", valueHint: "number" },
    { flag: "-empty", type: "boolean" },
    { flag: "-print", type: "boolean" },
    { flag: "-print0", type: "boolean" },
  ],
  needsFiles: true,
};
