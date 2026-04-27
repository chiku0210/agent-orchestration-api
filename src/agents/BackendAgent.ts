import { AgentRunner } from "../orchestrator/AgentRunner.js";
import type { z } from "zod";
import { FileBundleListSchema, SpecForgeArchitectureBlockSchema, SpecForgeDbBlockSchema } from "./specForgeSchemas.js";

const MODEL = "llama-3.3-70b-versatile" as const;

type Arch = z.infer<typeof SpecForgeArchitectureBlockSchema>;
type Db = z.infer<typeof SpecForgeDbBlockSchema>;

export class BackendAgent {
  private readonly runner = new AgentRunner(MODEL);

  async run(params: { architecture: Arch; db: Db; refinementPrompt: string }) {
    return this.runner.run({
      systemPrompt: [
        "You are BackendAgent.",
        "Generate server source files (Node/Express or similar) that implement the API contracts and reflect the DB migrations at a high level.",
        "Return JSON ONLY: { files: [ { path, content } ] } with at least 2 files (e.g. backend/package.json, backend/src entry or routes).",
        "",
        "IMPORTANT: ALL file paths MUST be under the `backend/` directory (e.g. `backend/package.json`, `backend/src/index.ts`).",
        "This is required to avoid collisions with the separate frontend bundle.",
        "",
        "Nested JSON rule: each `content` is a single plain string of file text. For package.json, output normal JSON file content as that string — do NOT double-encode JSON (no JSON-inside-JSON strings). Keep dependencies minimal (a few packages with simple semver like \"^1.0.0\").",
        "Keep every file short and skimmable: prioritize working stubs over exhaustive boilerplate; avoid huge blocks that blow the token limit.",
        "UTF-8 string content only; no markdown fences inside `content`.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        architecture: params.architecture,
        db: params.db,
        refinementPrompt: params.refinementPrompt,
      }),
      schema: FileBundleListSchema,
      maxTokens: 6000,
    });
  }
}
