import { randomUUID } from "node:crypto";

import { pool } from "../storage/db.js";
import type { WorkflowType } from "../contracts/index.js";
import { EventLogger } from "./EventLogger.js";
import { getRunById, updateRunStatus } from "../storage/runs.js";
import { MarketPulseWorkflow } from "./MarketPulseWorkflow.js";
import { SpecForgeWorkflow } from "./SpecForgeWorkflow.js";
import { logExecuteRun, logWorkflowMilestone } from "./workflowLog.js";

export type CreateRunParams = {
  workflow: WorkflowType;
  inputPrompt: string;
  marketPulseRunId?: string;
};

export class Orchestrator {
  async createRun(params: CreateRunParams): Promise<{ runId: string }> {
    const runId = randomUUID();

    await pool.query(
      `insert into runs (id, workflow_type, status, input_prompt, market_pulse_run_id) values ($1, $2, $3, $4, $5)`,
      [runId, params.workflow, "queued", params.inputPrompt, params.marketPulseRunId ?? null],
    );

    const events = new EventLogger({ runId, workflow: params.workflow });
    await events.append({
      type: "run_started",
      status: "running",
      input: {
        prompt: params.inputPrompt,
        ...(params.marketPulseRunId ? { marketPulseRunId: params.marketPulseRunId } : {}),
      },
    });

    return { runId };
  }

  async executeRun(runId: string): Promise<void> {
    const row = await getRunById(runId);
    if (!row) {
      throw new Error(`Run not found: ${runId}`);
    }

    const workflow = row.workflow_type;
    const events = new EventLogger({ runId, workflow });
    await updateRunStatus(runId, "running");
    logExecuteRun({ runId, workflow, phase: "start" });

    try {
      if (workflow === "market_pulse") {
        const wf = new MarketPulseWorkflow();
        const pkg = await wf.run({ featureIdea: row.input_prompt, runId, createdAt: Date.now() });

        // Auto-trigger SpecForge after a successful MarketPulse run, but keep the SAME runId
        // so the frontend can continue consuming SSE from a single source.
        const sf = new SpecForgeWorkflow();
        await sf.run({
          runId,
          marketPulseRunId: runId,
          refinementPrompt: row.input_prompt,
        });
        logWorkflowMilestone({
          runId,
          workflow: "market_pulse",
          message: "chained to spec_forge (same runId)",
          data: { sourceMarketPulseRunId: runId },
        });
      } else {
        if (!row.market_pulse_run_id) {
          throw new Error("SpecForge requires market_pulse_run_id (complete MarketPulse first)");
        }
        const wf = new SpecForgeWorkflow();
        await wf.run({
          runId,
          marketPulseRunId: row.market_pulse_run_id,
          refinementPrompt: row.input_prompt,
        });
      }

      await updateRunStatus(runId, "succeeded");
      await events.append({ type: "run_finished", status: "succeeded" });
      logExecuteRun({ runId, workflow, phase: "end" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logExecuteRun({ runId, workflow, phase: "error", err: message });
      await updateRunStatus(runId, "failed");
      await events.append({ type: "run_finished", status: "failed", error: { message } });
      throw err;
    }
  }
}

