import { AgentRunner } from "../orchestrator/AgentRunner.js";
import type { MarketPulsePackage } from "../contracts/index.js";
import { MarketPulsePackageSchema } from "../contracts/marketPulsePackage.zod.js";
import { getAgentConfig } from "../config/agentConfig.js";
import { MARKETPULSE_FACET_MODEL } from "../config/models.js";

export { MarketPulsePackageSchema };

export class MarketPulseSynthesizer {
  private readonly runner: AgentRunner;
  private readonly maxTokens: number;

  constructor() {
    const cfg = getAgentConfig({
      workflow: "market_pulse",
      role: "MarketPulseSynthesizer",
      defaultModel: MARKETPULSE_FACET_MODEL,
      defaultMaxTokens: 2048,
    });
    this.runner = new AgentRunner(cfg.model);
    this.maxTokens = cfg.constraints.maxTokens ?? 2048;
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
        "CRITICAL RULES:",
        "1. DO NOT output 'TBD' or placeholders anywhere. If you lack information, invent plausible, high-quality hypotheses based on the featureIdea.",
        "2. The `mvp_scope` MUST have at least 3 items in `goals`, `mustHave`, and `nonGoals`.",
        "3. Return ONLY valid JSON; no markdown; no code fences; no extra keys.",
        "",
        "Critical nested shapes (use these EXACT keys):",
        'competitive_landscape: array of { name: string, category: "competitor"|"substitute", strengths: string[], weaknesses: string[], differentiatorsForUs: string[] }',
        'validation_plan: array of { experiment: string, timeBox: string, successCriteria: string }',
      ].join("\n"),
      userPrompt: JSON.stringify(params),
      schema: MarketPulsePackageSchema,
      maxTokens: this.maxTokens,
    }) as Promise<MarketPulsePackage>;
  }
}

