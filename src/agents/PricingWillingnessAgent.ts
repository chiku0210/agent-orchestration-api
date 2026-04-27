import { MARKETPULSE_FACET_MODEL } from "../config/models.js";
import { AgentRunner } from "../orchestrator/AgentRunner.js";
import { MarketPulseFacetResultSchema } from "./marketpulseFacetSchemas.js";

export class PricingWillingnessAgent {
  private readonly runner = new AgentRunner(MARKETPULSE_FACET_MODEL);

  async run(featureIdea: string) {
    return this.runner.run({
      systemPrompt: [
        "You are PricingWillingnessAgent for MarketPulse.",
        "Return ONLY a valid JSON object with EXACTLY these keys: facetId, summary.",
        'facetId MUST be the string "pricing_willingness".',
        "summary MUST be a single concise string (no nested objects/arrays anywhere in the output).",
        "No markdown, no code fences, no extra keys.",
        "",
        'Output shape example: {"facetId":"pricing_willingness","summary":"..."}',
      ].join("\n"),
      userPrompt: featureIdea,
      schema: MarketPulseFacetResultSchema,
    });
  }
}

