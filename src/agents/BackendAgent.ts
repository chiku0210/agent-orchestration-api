import { AgentRunner } from "../orchestrator/AgentRunner.js";
import type { z } from "zod";
import { FileBundleListSchema, SpecForgeArchitectureBlockSchema, SpecForgeDbBlockSchema } from "./specForgeSchemas.js";

const MODEL = "openai/gpt-oss-120b" as const;

type Arch = z.infer<typeof SpecForgeArchitectureBlockSchema>;
type Db = z.infer<typeof SpecForgeDbBlockSchema>;

export class BackendAgent {
  private readonly runner = new AgentRunner(MODEL);

  async run(params: { architecture: Arch; db: Db; refinementPrompt: string }) {
    return this.runner.run({
      systemPrompt: [
        "You are BackendAgent.",
        "Generate server source files (Node/Express or similar) that implement the API contracts and apply the SQL migrations conceptually.",
        "Return JSON ONLY: { files: [ { path, content } ] } with at least 2 files, typically including package.json, src/index or src/routes, and a README snippet if needed.",
        "Keep files concise but real; use UTF-8 string content only.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        architecture: params.architecture,
        db: params.db,
        refinementPrompt: params.refinementPrompt,
      }),
      schema: FileBundleListSchema,
    });
  }
}
