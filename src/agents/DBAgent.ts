import { AgentRunner } from "../orchestrator/AgentRunner.js";
import type { z } from "zod";
import { SpecForgeArchitectureBlockSchema, SpecForgeDbBlockSchema } from "./specForgeSchemas.js";
import { getAgentConfig } from "../config/agentConfig.js";

const ArchInputSchema = SpecForgeArchitectureBlockSchema;
type Architecture = z.infer<typeof ArchInputSchema>;

export class DBAgent {
  private readonly runner: AgentRunner;

  constructor() {
    const cfg = getAgentConfig({
      workflow: "spec_forge",
      role: "DBAgent",
      defaultModel: "llama-3.3-70b-versatile",
    });
    this.runner = new AgentRunner(cfg.model);
  }

  async run(params: { architecture: Architecture; refinementPrompt: string }) {
    return this.runner.run({
      systemPrompt: [
        "You are DBAgent.",
        "You receive the architecture contracts and file structure.",
        "Write one or more SQL migration files (PostgreSQL) that match the data model implied by the architecture.",
        "Output ONLY JSON: sqlMigrations[{ filename, sql }], notes.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        architecture: params.architecture,
        refinementPrompt: params.refinementPrompt,
      }),
      schema: SpecForgeDbBlockSchema,
    });
  }
}
