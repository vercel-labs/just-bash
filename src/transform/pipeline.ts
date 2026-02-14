import { parse } from "../parser/parser.js";
import { serialize } from "./serialize.js";
import type { BashTransformResult, TransformPlugin } from "./types.js";

export class BashTransformPipeline<
  TMetadata extends object = Record<string, never>,
> {
  // biome-ignore lint/suspicious/noExplicitAny: required for type-erased plugin storage
  private plugins: TransformPlugin<any>[] = [];

  use<M extends object>(
    plugin: TransformPlugin<M>,
  ): BashTransformPipeline<TMetadata & M> {
    this.plugins.push(plugin);
    // biome-ignore lint/suspicious/noExplicitAny: required for generic type accumulation cast
    return this as BashTransformPipeline<any> as BashTransformPipeline<
      TMetadata & M
    >;
  }

  transform(script: string): BashTransformResult<TMetadata> {
    let ast = parse(script);
    // @banned-pattern-ignore: metadata is plugin-controlled, not user input
    let metadata: Record<string, unknown> = Object.create(null);
    for (const plugin of this.plugins) {
      const result = plugin.transform({ ast, metadata });
      ast = result.ast;
      if (result.metadata) {
        metadata = { ...metadata, ...result.metadata };
      }
    }
    return {
      script: serialize(ast),
      ast,
      metadata: metadata as TMetadata,
    };
  }
}
