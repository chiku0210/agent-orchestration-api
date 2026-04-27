import { randomUUID } from "node:crypto";

import type { RunEvent, RunEventBase, WorkflowType } from "../contracts/index.js";
import { pool } from "../storage/db.js";
import { publishRunEvent } from "./eventBus.js";
import { logRunEvent } from "./workflowLog.js";

type StripBase<T> = T extends unknown ? Omit<T, keyof RunEventBase> : never;
export type RunEventPayload = StripBase<RunEvent>;

export class EventLogger {
  private readonly runId: string;
  private readonly workflow: WorkflowType;

  constructor(params: { runId: string; workflow: WorkflowType }) {
    this.runId = params.runId;
    this.workflow = params.workflow;
  }

  async append(event: RunEventPayload): Promise<RunEvent> {
    const fullEvent: RunEvent = {
      ...(event as unknown as RunEvent),
      id: randomUUID(),
      runId: this.runId,
      ts: Date.now(),
      workflow: this.workflow,
    };

    await pool.query(`insert into events (id, run_id, type, payload) values ($1, $2, $3, $4)`, [
      fullEvent.id,
      this.runId,
      fullEvent.type,
      fullEvent,
    ]);

    publishRunEvent(this.runId, fullEvent);
    logRunEvent(fullEvent);
    return fullEvent;
  }
}

