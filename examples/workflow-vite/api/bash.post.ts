import { defineEventHandler } from "nitro/h3";
import { Run, start } from "workflow/api";
import { serialBashWorkflow } from "../workflows/bash-workflow";

export default defineEventHandler(async () => {
  const { runId } = await start(serialBashWorkflow, []);

  // Wait for completion using the returnValue getter
  const run = new Run(runId);
  const result = await run.returnValue;

  return {
    message: "Bash workflow completed",
    result,
  };
});
