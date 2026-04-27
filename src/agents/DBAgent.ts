import { AgentRunner } from "../orchestrator/AgentRunner.js";
import type { z } from "zod";
import { SpecForgeArchitectureBlockSchema, SpecForgeDbBlockSchema } from "./specForgeSchemas.js";

const MODEL = "openai/gpt-oss-120b" as const;

const ArchInputSchema = SpecForgeArchitectureBlockSchema;
type Architecture = z.infer<typeof ArchInputSchema>;

export class DBAgent {
  private readonly runner = new AgentRunner(MODEL);

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
