import type { MarketPulsePackage } from "../contracts/index.js";
import { AgentRunner } from "../orchestrator/AgentRunner.js";
import { SpecForgeRiskListSchema } from "./specForgeSchemas.js";
import { getAgentConfig } from "../config/agentConfig.js";

export class RiskAgent {
  private readonly runner: AgentRunner;

  constructor() {
    const cfg = getAgentConfig({
      workflow: "spec_forge",
      role: "RiskAgent",
    });
    this.runner = new AgentRunner(cfg.model);
  }

  async run(params: { marketPulsePackage: MarketPulsePackage; refinementPrompt: string }) {
    return this.runner.run({
      systemPrompt: [
        "You are RiskAgent for SpecForge.",
        "Your job is to identify potential risks in the proposed product and provide concrete mitigations.",
        "Categories of risk to consider: security, privacy, reliability, abuse, compliance.",
        "Output ONLY a JSON object with a `risks` array. Each item must have: { category, risk, mitigation }.",
        "Ensure the risks are specific to the feature idea and the MarketPulsePackage context provided.",
        "Do NOT include markdown fences or any text outside the JSON object.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        marketPulsePackage: params.marketPulsePackage,
        refinementPrompt: params.refinementPrompt,
      }),
      schema: SpecForgeRiskListSchema,
    });
  }
}
