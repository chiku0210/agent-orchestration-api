import type { MarketPulsePackage } from "../contracts/index.js";
import { AgentRunner } from "../orchestrator/AgentRunner.js";
import { SpecForgeRiskListSchema } from "./specForgeSchemas.js";

const MODEL =
  process.env.GROQ_SPEC_FORGE_RISK_MODEL?.trim() || "openai/gpt-oss-safeguard-20b";

export class RiskAgent {
  private readonly runner = new AgentRunner(MODEL);

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
