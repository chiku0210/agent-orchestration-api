import type { MarketPulsePackage } from "../contracts/index.js";
import { AgentRunner } from "../orchestrator/AgentRunner.js";
import { SpecForgePrdBlockSchema } from "./specForgeSchemas.js";
import { getAgentConfig } from "../config/agentConfig.js";

const FAST_MODE = process.env.GROQ_SPEC_FORGE_FAST_MODE?.trim() === "1";

export class PRDAgent {
  private readonly runner: AgentRunner;

  constructor() {
    const defaultModel =
      process.env.GROQ_SPEC_FORGE_PRD_MODEL?.trim() || (FAST_MODE ? "openai/gpt-oss-20b" : "openai/gpt-oss-120b");
    const cfg = getAgentConfig({
      workflow: "spec_forge",
      role: "PRDAgent",
      defaultModel,
    });
    this.runner = new AgentRunner(cfg.model);
  }

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
