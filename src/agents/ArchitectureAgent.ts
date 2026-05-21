import { z } from "zod";

import { AgentRunner } from "../orchestrator/AgentRunner.js";
import {
  SpecForgeArchitectureBlockSchema,
  SpecForgePrdBlockSchema,
  SpecForgeRiskListSchema,
} from "./specForgeSchemas.js";
import { getAgentConfig } from "../config/agentConfig.js";

const Step1ContextSchema = z.object({
  prd: SpecForgePrdBlockSchema,
  risks: SpecForgeRiskListSchema,
});
type Step1 = z.infer<typeof Step1ContextSchema>;

export class ArchitectureAgent {
  private readonly runner: AgentRunner;
  private readonly maxTokens: number;

  constructor() {
    const cfg = getAgentConfig({
      workflow: "spec_forge",
      role: "ArchitectureAgent",
      defaultMaxTokens: 2048,
    });
    this.runner = new AgentRunner(cfg.model);
    this.maxTokens = cfg.constraints.maxTokens ?? 2048;
  }

  async run(params: { step1: Step1; refinementPrompt: string }) {
    return this.runner.run({
      systemPrompt: [
        "You are ArchitectureAgent.",
        "You receive the PRD + risks (Step 1) and a refinement prompt.",
        "Your job is to define a high-level technical architecture, including API contracts and file structure.",
        "Output ONLY a single JSON object with the following keys: overview, apiContracts, dataModelNotes, fileStructure.",
        "apiContracts.requestSchema/responseSchema may be empty objects or simple JSON schema shapes.",
        "",
        "CRITICAL RULES:",
        "1. fileStructure MUST be an array of objects with EXACTLY: { path: string, purpose: string }.",
        "2. Do not omit `purpose` — it must be a clear sentence explaining the file's role.",
        "3. Output ONLY the JSON object. No markdown fences, no preambles, no explanations.",
        'Example fileStructure item: { "path": "src/routes/users.ts", "purpose": "User CRUD routes and request validation." }',
        "Keep apiContracts to 5 routes maximum. Keep fileStructure to 8 files maximum.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        step1: params.step1,
        refinementPrompt: params.refinementPrompt,
      }),
      schema: SpecForgeArchitectureBlockSchema,
      maxTokens: this.maxTokens,
    });
  }
}
