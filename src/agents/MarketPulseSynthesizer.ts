import { AgentRunner } from "../orchestrator/AgentRunner.js";
import type { MarketPulsePackage } from "../contracts/index.js";
import { MarketPulsePackageSchema } from "../contracts/marketPulsePackage.zod.js";
import { getAgentConfig } from "../config/agentConfig.js";

export { MarketPulsePackageSchema };

export class MarketPulseSynthesizer {
  private readonly runner: AgentRunner;
  private readonly maxTokens: number;

  constructor() {
    const cfg = getAgentConfig({
      workflow: "market_pulse",
      role: "MarketPulseSynthesizer",
      defaultModel: "llama-3.3-70b-versatile",
      defaultMaxTokens: 6000,
    });
    this.runner = new AgentRunner(cfg.model);
    this.maxTokens = cfg.constraints.maxTokens ?? 6000;
  }

  async synthesize(params: {
    runId: string;
    createdAt: number;
    featureIdea: string;
    facetSummaries: Array<{ facetId: string; summary: string }>;
  }): Promise<MarketPulsePackage> {
    return this.runner.run({
      systemPrompt: [
        "You are MarketPulseSynthesizer.",
        "You must output ONE JSON object that strictly matches the MarketPulsePackage schema.",
        "Populate ALL required fields; do not omit any keys.",
        "Use ONLY the provided inputs as source of truth (no external facts).",
        'Set version to 1 exactly. Set runId/createdAt/featureIdea exactly equal to the input values.',
        "Return ONLY valid JSON; no markdown; no code fences; no extra keys.",
        "",
        "Required top-level keys:",
        "version, runId, createdAt, featureIdea, market_fit_summary, personas_jtbd, competitive_landscape, value_hypotheses, pricing_hypotheses, mvp_scope, success_metrics, validation_plan, open_questions",
        "",
        "Critical nested shapes (use these EXACT keys):",
        'competitive_landscape: array of { name: string, category: "competitor"|"substitute", strengths: string[], weaknesses: string[], differentiatorsForUs: string[] }',
        'validation_plan: array of { experiment: string, timeBox: string, successCriteria: string }',
        "",
        "Examples (for structure only; do not copy text):",
        'competitive_landscape item example: {"name":"ExampleCo","category":"competitor","strengths":["..."],"weaknesses":["..."],"differentiatorsForUs":["..."]}',
        'validation_plan item example: {"experiment":"...","timeBox":"1 week","successCriteria":"..."}',
      ].join("\n"),
      userPrompt: JSON.stringify(params),
      schema: MarketPulsePackageSchema,
      maxTokens: this.maxTokens,
    }) as Promise<MarketPulsePackage>;
  }
}

