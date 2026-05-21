import type { MarketPulsePackage } from "../contracts/index.js";
import { AgentRunner } from "../orchestrator/AgentRunner.js";
import { SpecForgePrdBlockSchema } from "./specForgeSchemas.js";
import { getAgentConfig } from "../config/agentConfig.js";

const FAST_MODE = process.env.NIM_SPEC_FORGE_FAST_MODE?.trim() === "1";

export class PRDAgent {
  private readonly runner: AgentRunner;

  constructor() {
    const cfg = getAgentConfig({
      workflow: "spec_forge",
      role: "PRDAgent",
      // defaultModel will fall back to modelControl.ts
    });
    this.runner = new AgentRunner(cfg.model);
  }

  async run(params: { marketPulsePackage: MarketPulsePackage; refinementPrompt: string }) {
    return this.runner.run({
      systemPrompt: [
        "You are PRDAgent for SpecForge.",
        "Your job is to transform a MarketPulsePackage into a detailed Product Requirements Document (PRD).",
        "Output ONLY a single JSON object with the following keys: problemStatement, users, userStories, acceptanceCriteria, outOfScope.",
        "Scoping must align strictly with the MarketPulse MVP and non-goals.",
        "CRITICAL RULE: The `users`, `userStories`, `acceptanceCriteria`, and `outOfScope` arrays MUST contain ONLY plain-text strings (sentences or paragraphs). DO NOT put JSON objects or stringified JSON objects inside these arrays.",
        "Do NOT include markdown fences, preambles, or any text outside the JSON object.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        marketPulsePackage: params.marketPulsePackage,
        refinementPrompt: params.refinementPrompt,
      }),
      schema: SpecForgePrdBlockSchema,
    });
  }
}
