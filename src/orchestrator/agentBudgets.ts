import type { AgentRole, WorkflowType } from "../contracts/index.js";

function readEnvInt(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Per-agent timeout override (ms).
 *
 * Resolution order:
 * 1) `AGENT_TIMEOUT_MS__<workflow>__<role>` (most specific)
 * 2) `<WORKFLOW_PREFIX>_TIMEOUT_MS_<role>` (back-compat ergonomic)
 * 3) `defaultMs`
 */
export function getAgentTimeoutMs(params: {
  workflow: WorkflowType;
  role: AgentRole;
  defaultMs: number;
}): number {
  const w = params.workflow;
  const role = params.role;
  const specific = `AGENT_TIMEOUT_MS__${w}__${role}`;
  const generic = `AGENT_TIMEOUT_MS__${role}`;
  const legacy =
    w === "market_pulse" ? `MARKET_PULSE_TIMEOUT_MS_${role}` : w === "spec_forge" ? `SPEC_FORGE_TIMEOUT_MS_${role}` : null;

  return readEnvInt(specific) ?? readEnvInt(generic) ?? (legacy ? readEnvInt(legacy) : null) ?? params.defaultMs;
}

