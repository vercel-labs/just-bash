import type { ScriptNode } from "../ast/types.js";

export interface TransformPlugin<
  TMetadata extends object = Record<string, unknown>,
> {
  name: string;
  transform(context: TransformContext): TransformResult<TMetadata>;
}

export interface TransformContext {
  ast: ScriptNode;
  metadata: Record<string, unknown>;
}

export interface TransformResult<
  TMetadata extends object = Record<string, unknown>,
> {
  ast: ScriptNode;
  metadata?: TMetadata;
}

export interface BashTransformResult<
  TMetadata extends object = Record<string, unknown>,
> {
  script: string;
  ast: ScriptNode;
  metadata: TMetadata;
}
