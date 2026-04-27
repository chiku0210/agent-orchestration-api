import { AgentRunner } from "../orchestrator/AgentRunner.js";
import type { z } from "zod";
import { FileBundleListSchema, SpecForgeArchitectureBlockSchema, SpecForgeDbBlockSchema } from "./specForgeSchemas.js";

// Use a high-limit, reliable JSON-following model to avoid Groq TPM caps
// seen with `qwen/qwen3-32b` for larger prompts.
const MODEL = "openai/gpt-oss-20b" as const;

type Arch = z.infer<typeof SpecForgeArchitectureBlockSchema>;
type Db = z.infer<typeof SpecForgeDbBlockSchema>;

export class FrontendAgent {
  private readonly runner = new AgentRunner(MODEL);

  async run(params: {
    architecture: Arch;
    db: Db;
    backendFileSummary: string;
    refinementPrompt: string;
  }) {
    return this.runner.run({
      systemPrompt: [
        "You are FrontendAgent.",
        "Generate a small Next.js/React UI that calls the defined backend API routes.",
        "Return JSON ONLY: { files: [ { path, content } ] } with a handful of real files (package.json, app/page, components, etc.).",
        "Keep each file under ~400 lines; split across multiple files.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        architecture: params.architecture,
        db: params.db,
        backendFileSummary: params.backendFileSummary,
        refinementPrompt: params.refinementPrompt,
      }),
      schema: FileBundleListSchema,
    });
  }
}
