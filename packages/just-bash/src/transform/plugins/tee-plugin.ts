import type {
  CommandNode,
  PipelineNode,
  ScriptNode,
  SimpleCommandNode,
  StatementNode,
  WordNode,
} from "../../ast/types.js";
import { serializeWord } from "../serialize.js";
import type {
  TransformContext,
  TransformPlugin,
  TransformResult,
} from "../types.js";

export interface TeePluginOptions {
  outputDir: string;
  targetCommandPattern?: { test(input: string): boolean };
  timestamp?: Date;
}

export interface TeeFileInfo {
  commandIndex: number;
  commandName: string;
  /** The full command string (name + arguments) before tee wrapping */
  command: string;
  stdoutFile: string;
}

export interface TeePluginMetadata {
  teeFiles: TeeFileInfo[];
}

export class TeePlugin implements TransformPlugin<TeePluginMetadata> {
  readonly name = "tee";
  private options: TeePluginOptions;
  private counter = 0;

  constructor(options: TeePluginOptions) {
    this.options = options;
  }

  transform(context: TransformContext): TransformResult<TeePluginMetadata> {
    const teeFiles: TeeFileInfo[] = [];
    const timestamp = this.options.timestamp ?? new Date();
    const ast = this.transformScript(context.ast, teeFiles, timestamp);
    return { ast, metadata: { teeFiles } };
  }

  private formatTimestamp(date: Date): string {
    return date.toISOString().replace(/:/g, "-");
  }

  private generateStdoutPath(
    index: number,
    commandName: string,
    timestamp: Date,
  ): string {
    const ts = this.formatTimestamp(timestamp);
    const idx = String(index).padStart(3, "0");
    const dir = this.options.outputDir;
    return `${dir}/${ts}-${idx}-${commandName}.stdout.txt`;
  }

  private transformScript(
    node: ScriptNode,
    teeFiles: TeeFileInfo[],
    timestamp: Date,
  ): ScriptNode {
    return {
      ...node,
      statements: node.statements.map((s) =>
        this.transformStatement(s, teeFiles, timestamp),
      ),
    };
  }

  private transformStatement(
    node: StatementNode,
    teeFiles: TeeFileInfo[],
    timestamp: Date,
  ): StatementNode {
    const newPipelines: PipelineNode[] = [];
    const newOperators: ("&&" | "||" | ";")[] = [];

    for (let i = 0; i < node.pipelines.length; i++) {
      const pipeline = node.pipelines[i];

      // Preserve original operator connecting this pipeline
      if (i > 0) {
        newOperators.push(node.operators[i - 1]);
      }

      const result = this.transformPipeline(pipeline, teeFiles, timestamp);
      newPipelines.push(result.pipeline);

      if (result.origCmdNewIndices !== null) {
        const indices = result.origCmdNewIndices;
        // Save original PIPESTATUS entries into temp vars
        newOperators.push(";");
        newPipelines.push(this.makePipestatusSave(indices));
        // Restore PIPESTATUS and exit code with dummy pipeline.
        // Apply the original pipeline's negation here (not on the
        // wrapped pipeline) so ! inverts the restored exit code.
        newOperators.push(";");
        newPipelines.push(
          this.makePipestatusRestore(indices.length, result.negated),
        );
      }
    }

    return {
      ...node,
      pipelines: newPipelines,
      operators: newOperators,
    };
  }

  private transformPipeline(
    node: PipelineNode,
    teeFiles: TeeFileInfo[],
    timestamp: Date,
  ): {
    pipeline: PipelineNode;
    origCmdNewIndices: number[] | null;
    negated: boolean;
  } {
    // Only wrap commands in existing pipelines (2+ commands).
    // Standalone commands are never wrapped — this avoids breaking
    // state-modifying builtins (read, cd, export, eval, etc.) that
    // lose their side effects when moved into a subshell pipeline.
    if (node.commands.length <= 1) {
      return { pipeline: node, origCmdNewIndices: null, negated: false };
    }

    const newCommands: CommandNode[] = [];
    const newPipeStderr: boolean[] = [];
    const origCmdNewIndices: number[] = [];
    let anyWrapped = false;

    for (let i = 0; i < node.commands.length; i++) {
      const cmd = node.commands[i];
      const isLast = i === node.commands.length - 1;

      // Skip non-SimpleCommand, assignment-only, and non-targeted commands
      if (
        cmd.type !== "SimpleCommand" ||
        !cmd.name ||
        !this.shouldTarget(cmd)
      ) {
        origCmdNewIndices.push(newCommands.length);
        newCommands.push(cmd);
        if (!isLast) {
          newPipeStderr.push(node.pipeStderr?.[i] ?? false);
        }
        continue;
      }

      const commandName = this.getCommandName(cmd.name) ?? "unknown";
      const idx = this.counter++;
      const stdoutFile = this.generateStdoutPath(idx, commandName, timestamp);
      const teeCmd = this.makeTeeCommand(stdoutFile);

      const command = this.serializeCommand(cmd);
      teeFiles.push({
        commandIndex: idx,
        commandName,
        command,
        stdoutFile,
      });

      origCmdNewIndices.push(newCommands.length);
      newCommands.push(cmd);
      // cmd→tee: use original outgoing pipe type (preserves |& so tee
      // captures stderr too when the original pipe was |&)
      newPipeStderr.push(node.pipeStderr?.[i] ?? false);
      newCommands.push(teeCmd);
      if (!isLast) {
        // tee→next: always regular pipe (tee produces no stderr)
        newPipeStderr.push(false);
      }
      anyWrapped = true;
    }

    if (!anyWrapped) {
      return { pipeline: node, origCmdNewIndices: null, negated: false };
    }

    return {
      pipeline: {
        ...node,
        negated: false, // strip negation; applied to restore pipeline instead
        commands: newCommands,
        pipeStderr: newPipeStderr.length > 0 ? newPipeStderr : undefined,
      },
      origCmdNewIndices,
      negated: node.negated,
    };
  }

  /**
   * Save PIPESTATUS entries for original commands into temp vars.
   * Produces: `__tps0=${PIPESTATUS[idx0]} __tps1=${PIPESTATUS[idx1]} ...`
   *
   * All expansions happen before any assignment (single simple command),
   * so all read from the same PIPESTATUS snapshot.
   */
  private makePipestatusSave(origCmdNewIndices: number[]): PipelineNode {
    return {
      type: "Pipeline",
      commands: [
        {
          type: "SimpleCommand",
          assignments: origCmdNewIndices.map((newIdx, i) => ({
            type: "Assignment" as const,
            name: `__tps${i}`,
            value: {
              type: "Word" as const,
              parts: [
                {
                  type: "ParameterExpansion" as const,
                  parameter: `PIPESTATUS[${newIdx}]`,
                  operation: null,
                },
              ],
            },
            append: false,
            array: null,
          })),
          name: null,
          args: [],
          redirections: [],
        },
      ],
      negated: false,
    };
  }

  /**
   * Restore PIPESTATUS and exit code with a dummy pipeline.
   * Produces: `(exit $__tps0) | (exit $__tps1) | ...`
   *
   * This sets PIPESTATUS to the original commands' exit codes and
   * sets $? to the last original command's exit code.
   */
  private makePipestatusRestore(count: number, negated: boolean): PipelineNode {
    const commands: CommandNode[] = [];
    for (let i = 0; i < count; i++) {
      commands.push({
        type: "Subshell",
        body: [
          {
            type: "Statement",
            pipelines: [
              {
                type: "Pipeline",
                commands: [
                  {
                    type: "SimpleCommand",
                    assignments: [],
                    name: {
                      type: "Word",
                      parts: [{ type: "Literal", value: "exit" }],
                    },
                    args: [
                      {
                        type: "Word",
                        parts: [
                          {
                            type: "ParameterExpansion",
                            parameter: `__tps${i}`,
                            operation: null,
                          },
                        ],
                      },
                    ],
                    redirections: [],
                  },
                ],
                negated: false,
              },
            ],
            operators: [],
            background: false,
          },
        ],
        redirections: [],
      });
    }

    return {
      type: "Pipeline",
      commands,
      negated,
    };
  }

  private shouldTarget(cmd: SimpleCommandNode): boolean {
    if (!this.options.targetCommandPattern) {
      return true;
    }
    const name = this.getCommandName(cmd.name);
    return name !== null && this.options.targetCommandPattern.test(name);
  }

  private getCommandName(word: WordNode | null): string | null {
    if (!word) return null;
    if (word.parts.length === 1 && word.parts[0].type === "Literal") {
      return word.parts[0].value;
    }
    return null;
  }

  private serializeCommand(cmd: SimpleCommandNode): string {
    const parts: string[] = [];
    if (cmd.name) {
      parts.push(serializeWord(cmd.name));
    }
    for (const arg of cmd.args) {
      parts.push(serializeWord(arg));
    }
    return parts.join(" ");
  }

  private makeTeeCommand(outputFile: string): SimpleCommandNode {
    return {
      type: "SimpleCommand",
      assignments: [],
      name: { type: "Word", parts: [{ type: "Literal", value: "tee" }] },
      args: [
        {
          type: "Word",
          parts: [{ type: "Literal", value: outputFile }],
        },
      ],
      redirections: [],
    };
  }
}
