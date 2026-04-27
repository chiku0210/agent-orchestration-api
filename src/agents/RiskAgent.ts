import type { MarketPulsePackage } from "../contracts/index.js";
import { AgentRunner } from "../orchestrator/AgentRunner.js";
import { SpecForgeRiskListSchema } from "./specForgeSchemas.js";
import { getAgentConfig } from "../config/agentConfig.js";

export class RiskAgent {
  private readonly runner: AgentRunner;

  constructor() {
    const defaultModel = process.env.GROQ_SPEC_FORGE_RISK_MODEL?.trim() || "openai/gpt-oss-safeguard-20b";
    const cfg = getAgentConfig({
      workflow: "spec_forge",
      role: "RiskAgent",
      defaultModel,
    });
    this.runner = new AgentRunner(cfg.model);
  }

  async run(params: { marketPulsePackage: MarketPulsePackage; refinementPrompt: string }) {
    return this.runner.run({
      systemPrompt: [
        "You are RiskAgent for SpecForge (security, privacy, reliability, abuse, compliance).",
        "You receive a MarketPulsePackage and a user refinement prompt.",
        "Output ONLY JSON with a `risks` array: { category, risk, mitigation }.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        marketPulsePackage: params.marketPulsePackage,
        refinementPrompt: params.refinementPrompt,
      }),
      schema: SpecForgeRiskListSchema,
    });
  }
}
