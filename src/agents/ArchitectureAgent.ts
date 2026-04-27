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
      defaultModel: "llama-3.3-70b-versatile",
      defaultMaxTokens: 4096,
    });
    this.runner = new AgentRunner(cfg.model);
    this.maxTokens = cfg.constraints.maxTokens ?? 4096;
  }

  async run(params: { step1: Step1; refinementPrompt: string }) {
    return this.runner.run({
      systemPrompt: [
        "You are ArchitectureAgent.",
        "You receive the PRD + risks (Step 1) and a refinement prompt.",
        "Define API route contracts (method/path) and a proposed file structure.",
        "Output ONLY JSON: overview, apiContracts, dataModelNotes, fileStructure.",
        "apiContracts.requestSchema/responseSchema may be empty objects or JSON schema shapes as plain JSON values.",
        "",
        "Critical: fileStructure MUST be an array of objects with EXACTLY: { path: string, purpose: string }.",
        "Do not omit `purpose` — it must be a short sentence explaining why the file exists and what it contains.",
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
