import { assertDefenseContext } from "../security/defense-context.js";
import type { CommandContext } from "../types.js";

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function wrapFunction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
  requireDefenseContext: boolean | undefined,
  component: string,
  phase: string,
): (...args: TArgs) => TResult {
  return ((...args: TArgs): TResult => {
    assertDefenseContext(requireDefenseContext, component, `${phase} call`);
    const result = fn(...args);

    if (isPromiseLike(result)) {
      return result.then(
        (value: unknown) => {
          assertDefenseContext(
            requireDefenseContext,
            component,
            `${phase} post-await`,
          );
          return value;
        },
        (error: unknown) => {
          assertDefenseContext(
            requireDefenseContext,
            component,
            `${phase} post-await`,
          );
          throw error;
        },
      ) as TResult;
    }

    assertDefenseContext(requireDefenseContext, component, `${phase} return`);
    return result;
  }) as (...args: TArgs) => TResult;
}

function wrapFileSystem(
  fs: CommandContext["fs"],
  requireDefenseContext: boolean | undefined,
  component: string,
): CommandContext["fs"] {
  const wrappedFs: CommandContext["fs"] = {
    readFile: wrapFunction(
      fs.readFile.bind(fs),
      requireDefenseContext,
      component,
      "fs.readFile",
    ),
    readFileBuffer: wrapFunction(
      fs.readFileBuffer.bind(fs),
      requireDefenseContext,
      component,
      "fs.readFileBuffer",
    ),
    writeFile: wrapFunction(
      fs.writeFile.bind(fs),
      requireDefenseContext,
      component,
      "fs.writeFile",
    ),
    appendFile: wrapFunction(
      fs.appendFile.bind(fs),
      requireDefenseContext,
      component,
      "fs.appendFile",
    ),
    exists: wrapFunction(
      fs.exists.bind(fs),
      requireDefenseContext,
      component,
      "fs.exists",
    ),
    stat: wrapFunction(
      fs.stat.bind(fs),
      requireDefenseContext,
      component,
      "fs.stat",
    ),
    mkdir: wrapFunction(
      fs.mkdir.bind(fs),
      requireDefenseContext,
      component,
      "fs.mkdir",
    ),
    readdir: wrapFunction(
      fs.readdir.bind(fs),
      requireDefenseContext,
      component,
      "fs.readdir",
    ),
    rm: wrapFunction(fs.rm.bind(fs), requireDefenseContext, component, "fs.rm"),
    cp: wrapFunction(fs.cp.bind(fs), requireDefenseContext, component, "fs.cp"),
    mv: wrapFunction(fs.mv.bind(fs), requireDefenseContext, component, "fs.mv"),
    resolvePath: wrapFunction(
      fs.resolvePath.bind(fs),
      requireDefenseContext,
      component,
      "fs.resolvePath",
    ),
    getAllPaths: wrapFunction(
      fs.getAllPaths.bind(fs),
      requireDefenseContext,
      component,
      "fs.getAllPaths",
    ),
    chmod: wrapFunction(
      fs.chmod.bind(fs),
      requireDefenseContext,
      component,
      "fs.chmod",
    ),
    symlink: wrapFunction(
      fs.symlink.bind(fs),
      requireDefenseContext,
      component,
      "fs.symlink",
    ),
    link: wrapFunction(
      fs.link.bind(fs),
      requireDefenseContext,
      component,
      "fs.link",
    ),
    readlink: wrapFunction(
      fs.readlink.bind(fs),
      requireDefenseContext,
      component,
      "fs.readlink",
    ),
    lstat: wrapFunction(
      fs.lstat.bind(fs),
      requireDefenseContext,
      component,
      "fs.lstat",
    ),
    realpath: wrapFunction(
      fs.realpath.bind(fs),
      requireDefenseContext,
      component,
      "fs.realpath",
    ),
    utimes: wrapFunction(
      fs.utimes.bind(fs),
      requireDefenseContext,
      component,
      "fs.utimes",
    ),
  };

  if (fs.readdirWithFileTypes) {
    wrappedFs.readdirWithFileTypes = wrapFunction(
      fs.readdirWithFileTypes.bind(fs),
      requireDefenseContext,
      component,
      "fs.readdirWithFileTypes",
    );
  }

  return wrappedFs;
}

/**
 * Wrap command context APIs so async boundaries are fail-closed if defense
 * context is expected but missing.
 */
export function createDefenseAwareCommandContext(
  ctx: CommandContext,
  commandName: string,
): CommandContext {
  if (!ctx.requireDefenseContext) {
    return ctx;
  }

  const component = `command:${commandName}`;
  const wrappedCtx: CommandContext = {
    ...ctx,
    fs: wrapFileSystem(ctx.fs, ctx.requireDefenseContext, component),
  };

  if (ctx.exec) {
    wrappedCtx.exec = wrapFunction(
      ctx.exec,
      ctx.requireDefenseContext,
      component,
      "exec",
    );
  }

  if (ctx.fetch) {
    wrappedCtx.fetch = wrapFunction(
      ctx.fetch,
      ctx.requireDefenseContext,
      component,
      "fetch",
    );
  }

  if (ctx.sleep) {
    wrappedCtx.sleep = wrapFunction(
      ctx.sleep,
      ctx.requireDefenseContext,
      component,
      "sleep",
    );
  }

  if (ctx.getRegisteredCommands) {
    wrappedCtx.getRegisteredCommands = wrapFunction(
      ctx.getRegisteredCommands,
      ctx.requireDefenseContext,
      component,
      "getRegisteredCommands",
    );
  }

  return wrappedCtx;
}
