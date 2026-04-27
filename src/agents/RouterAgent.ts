import { z } from "zod";

import { AgentRunner } from "../orchestrator/AgentRunner.js";
import type { WorkflowType } from "../contracts/index.js";
import { getAgentConfig } from "../config/agentConfig.js";

const RouterOutputSchema = z.object({
  workflow: z.enum(["market_pulse", "spec_forge"]),
});

export class RouterAgent {
  private readonly runner: AgentRunner;

  constructor() {
    const cfg = getAgentConfig({
      // Router is workflow-agnostic; allow generic override via AGENT_MODEL__RouterAgent.
      workflow: "market_pulse",
      role: "RouterAgent",
      defaultModel: "openai/gpt-oss-20b",
    });
    this.runner = new AgentRunner(cfg.model);
  }

  async route(userInput: string): Promise<WorkflowType> {
    const systemPrompt = [
      "You are RouterAgent for a multi-agent orchestration system.",
      "Your job is to choose which workflow should run next based on the user's input.",
      "",
      "Return ONLY JSON matching this shape:",
      '{ "workflow": "market_pulse" | "spec_forge" }',
      "",
      "Routing rules:",
      '- Use "market_pulse" when the user is exploring whether an idea is worth building, validating market fit, or doing research facets.',
      '- Use "spec_forge" when the user wants to generate an MVP, routes, or repo files, or says build/implement/scaffold/ship code (usually after a MarketPulse package exists in the system).',
    ].join("\n");

    const result = await this.runner.run({
      systemPrompt,
      userPrompt: userInput,
      schema: RouterOutputSchema,
    });

    return result.workflow;
  }
}

