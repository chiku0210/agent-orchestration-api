import type { AgentRole, WorkflowType } from "../contracts/index.js";

function readEnvInt(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function readEnvStr(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  const s = String(raw).trim();
  return s ? s : null;
}

export type AgentConstraints = {
  timeoutMs?: number;
  maxTokens?: number;
};

export type ResolvedAgentConfig = {
  model: string;
  constraints: AgentConstraints;
};

/**
 * Per-agent config (model + constraints).
 *
 * Resolution order:
 * - Model:
 *   1) `AGENT_MODEL__<workflow>__<role>`
 *   2) `AGENT_MODEL__<role>`
 *   3) `defaultModel`
 * - Timeout:
 *   1) `AGENT_TIMEOUT_MS__<workflow>__<role>`
 *   2) `AGENT_TIMEOUT_MS__<role>`
 *   3) `defaultTimeoutMs`
 * - Max tokens:
 *   1) `AGENT_MAX_TOKENS__<workflow>__<role>`
 *   2) `AGENT_MAX_TOKENS__<role>`
 *   3) `defaultMaxTokens`
 */
export function getAgentConfig(params: {
  workflow: WorkflowType;
  role: AgentRole;
  defaultModel: string;
  defaultTimeoutMs?: number;
  defaultMaxTokens?: number;
}): ResolvedAgentConfig {
  const { workflow, role } = params;

  const model =
    readEnvStr(`AGENT_MODEL__${workflow}__${role}`) ??
    readEnvStr(`AGENT_MODEL__${role}`) ??
    params.defaultModel;

  const timeoutMs =
    readEnvInt(`AGENT_TIMEOUT_MS__${workflow}__${role}`) ??
    readEnvInt(`AGENT_TIMEOUT_MS__${role}`) ??
    params.defaultTimeoutMs ??
    undefined;

  const maxTokens =
    readEnvInt(`AGENT_MAX_TOKENS__${workflow}__${role}`) ??
    readEnvInt(`AGENT_MAX_TOKENS__${role}`) ??
    params.defaultMaxTokens ??
    undefined;

  const constraints: AgentConstraints = {};
  if (timeoutMs !== undefined) constraints.timeoutMs = timeoutMs;
  if (maxTokens !== undefined) constraints.maxTokens = maxTokens;

  return { model, constraints };
}

