import { MARKETPULSE_FACET_MODEL } from "../config/models.js";
import { AgentRunner } from "../orchestrator/AgentRunner.js";
import { MarketPulseFacetResultSchema } from "./marketpulseFacetSchemas.js";
import { getAgentConfig } from "../config/agentConfig.js";

export class DistributionAgent {
  private readonly runner: AgentRunner;

  constructor() {
    const cfg = getAgentConfig({
      workflow: "market_pulse",
      role: "DistributionAgent",
      defaultModel: MARKETPULSE_FACET_MODEL,
    });
    this.runner = new AgentRunner(cfg.model);
  }

  async run(featureIdea: string) {
    return this.runner.run({
      systemPrompt: [
        "You are DistributionAgent for MarketPulse.",
        "Return ONLY a valid JSON object with EXACTLY these keys: facetId, summary.",
        'facetId MUST be the string "distribution".',
        "summary MUST be a single concise string (no nested objects/arrays anywhere in the output).",
        "No markdown, no code fences, no extra keys.",
        "",
        'Output shape example: {"facetId":"distribution","summary":"..."}',
      ].join("\n"),
      userPrompt: featureIdea,
      schema: MarketPulseFacetResultSchema,
    });
  }
}

