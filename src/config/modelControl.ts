import type { AgentRole } from "../contracts/index.js";

/**
 * MODEL REGISTRY
 * Add or update model names here.
 */
export const MODELS = {
  model_1: "meta/llama-3.1-8b-instruct", // Fast / Reasoning (Mistral alternative)
  model_2: "meta/llama-3.1-70b-instruct", // High-reasoning (Llama 70B)
} as const;

export type ModelKey = keyof typeof MODELS;

/**
 * AGENT-TO-MODEL MAPPING
 * Map each agent role to a model key from the registry above.
 */
export const AGENT_MODEL_MAPPING: Record<AgentRole, ModelKey> = {
  // MarketPulse Agents (Fast facets)
  TargetUserAgent: "model_1",
  AltSolutionsAgent: "model_1",
  PricingWillingnessAgent: "model_1",
  DistributionAgent: "model_1",
  RisksConstraintsAgent: "model_1",
  
  // Synthesis & Heavy Orchestration
  MarketPulseSynthesizer: "model_2",
  MarketPulseOrchestrator: "model_1",

  // SpecForge Agents (Heavy generation)
  PRDAgent: "model_2",
  RiskAgent: "model_1",
  ArchitectureAgent: "model_2",
  DemoScribeAgent: "model_1",
  ScribeAgent: "model_2",

  // Infrastructure
  RouterAgent: "model_1",
};

/**
 * Helper to get the actual model string for a given role.
 */
export function getModelForRole(role: AgentRole): string {
  const key = AGENT_MODEL_MAPPING[role];
  return MODELS[key];
}
