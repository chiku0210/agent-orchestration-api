import { pool } from "./db.js";
import type { WorkflowType } from "../contracts/index.js";

export type RunRow = {
  id: string;
  workflow_type: WorkflowType;
  status: string;
  input_prompt: string;
  market_pulse_run_id: string | null;
};

export async function getRunById(runId: string): Promise<RunRow | null> {
  const r = await pool.query<RunRow>(
    `select id, workflow_type, status, input_prompt, market_pulse_run_id from runs where id = $1`,
    [runId],
  );
  return r.rows[0] ?? null;
}

export async function updateRunStatus(runId: string, status: string): Promise<void> {
  await pool.query(`update runs set status = $1 where id = $2`, [status, runId]);
}

export async function getLatestSucceededMarketPulseRunId(): Promise<string | null> {
  // Prefer the latest succeeded MarketPulse run. This lets SpecForge start even if
  // the caller forgets to pass marketPulseRunId (common in demos / manual curl).
  const r = await pool.query<{ id: string }>(
    `select id
       from runs
      where workflow_type = $1
        and status = $2
   order by created_at desc
      limit 1`,
    ["market_pulse", "succeeded"],
  );
  return r.rows[0]?.id ?? null;
}
