import type { MarketPulsePackage } from "../contracts/index.js";
import { AgentRunner } from "../orchestrator/AgentRunner.js";
import { SpecForgePrdBlockSchema } from "./specForgeSchemas.js";

const MODEL = "openai/gpt-oss-120b" as const;

export class PRDAgent {
  private readonly runner = new AgentRunner(MODEL);

  async run(params: { marketPulsePackage: MarketPulsePackage; refinementPrompt: string }) {
    return this.runner.run({
      systemPrompt: [
        "You are PRDAgent for SpecForge.",
        "You receive a MarketPulsePackage (source of truth) and a user refinement prompt.",
        "Output ONLY JSON matching: problemStatement, users, userStories, acceptanceCriteria, outOfScope.",
        "Scoping must align with the MarketPulse MVP and non-goals.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        marketPulsePackage: params.marketPulsePackage,
        refinementPrompt: params.refinementPrompt,
      }),
      schema: SpecForgePrdBlockSchema,
    });
  }
}
