// Automa modifications: shared types for the original jq parser/input seam.
import type {
  EvaluateOptions,
  QueryEvaluationBudget,
  ResolvedQueryExecutionLimits,
} from "../query-engine/evaluator.js";
import type { QueryValue } from "../query-engine/value-operations.js";
export interface InputSource {
  source: string;
  content: string;
  error?: { stderr: string };
}
export interface JsonLimits {
  maxDepth: number;
  maxElements: number;
}
export type JsonStreamParser = (
  input: string,
  limits: JsonLimits,
  onValue?: (end: number, value: QueryValue) => void,
  startOffset?: number,
) => QueryValue[];
export type AppendValues = (target: QueryValue[], values: QueryValue[]) => void;
export interface InputOptions extends EvaluateOptions {
  limits: ResolvedQueryExecutionLimits;
  budget: QueryEvaluationBudget;
}
