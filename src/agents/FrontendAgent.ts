import { AgentRunner } from "../orchestrator/AgentRunner.js";
import type { z } from "zod";
import { FileBundleListSchema, SpecForgeArchitectureBlockSchema, SpecForgeDbBlockSchema } from "./specForgeSchemas.js";

// Use a high-limit, reliable JSON-following model to avoid Groq TPM caps
// seen with `qwen/qwen3-32b` for larger prompts.
const MODEL = "openai/gpt-oss-20b" as const;

type Arch = z.infer<typeof SpecForgeArchitectureBlockSchema>;
type Db = z.infer<typeof SpecForgeDbBlockSchema>;

function parseLooseJson(raw: string): unknown {
  const strippedThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const text = strippedThink;
  if (!text) throw new SyntaxError("Empty model response");

  const candidates: string[] = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const o0 = text.indexOf("{");
  const o1 = text.lastIndexOf("}");
  if (o0 >= 0 && o1 > o0) candidates.push(text.slice(o0, o1 + 1));
  const a0 = text.indexOf("[");
  const a1 = text.lastIndexOf("]");
  if (a0 >= 0 && a1 > a0) candidates.push(text.slice(a0, a1 + 1));

  for (const c of candidates) {
    try {
      return JSON.parse(c) as unknown;
    } catch {
      // try next
    }
  }
  throw new SyntaxError(`Could not parse JSON from model output: ${text.slice(0, 120)}`);
}

export class FrontendAgent {
  private readonly runner = new AgentRunner(MODEL);

  async run(params: {
    architecture: Arch;
    db: Db;
    backendFileSummary: string;
    refinementPrompt: string;
  }) {
    const raw = await this.runner.run({
      systemPrompt: [
        "You are FrontendAgent.",
        "Generate a small Next.js/React UI that calls the defined backend API routes.",
        "Return JSON ONLY: { files: [ { path, content } ] } with at least 3 real files (frontend/package.json, frontend/app/page.tsx, and at least one frontend/components/*.tsx component).",
        "",
        "IMPORTANT: ALL file paths MUST be under the `frontend/` directory (e.g. `frontend/package.json`, `frontend/app/page.tsx`, `frontend/components/Calculator.tsx`).",
        "This is required to avoid collisions with the separate backend bundle.",
        "",
        "Nested JSON rule: each `content` is a single plain string of file text. For package.json, output normal JSON file content as that string — do NOT double-encode JSON (no JSON-inside-JSON strings). Keep dependencies minimal.",
        "No markdown fences inside `content`.",
        "Keep each file under ~400 lines; split across multiple files.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        architecture: params.architecture,
        db: params.db,
        backendFileSummary: params.backendFileSummary,
        refinementPrompt: params.refinementPrompt,
      }),
      // Intentionally avoid schema-enforced mode here; this model is prone to returning
      // slightly different keys / wrappers. We'll parse + normalize locally for durability.
      maxTokens: 6000,
    });

    const parsed = typeof raw === "string" ? parseLooseJson(raw) : raw;
    const validated = FileBundleListSchema.safeParse(parsed);
    if (validated.success) return validated.data;

    // Last-resort durable fallback so spec_forge doesn't crash.
    return {
      files: [
        {
          path: "README_FRONTEND_AGENT_OUTPUT.md",
          content: [
            "# FrontendAgent output did not match expected schema",
            "",
            "The model returned JSON, but it could not be normalized into `{ files: [{ path, content }] }`.",
            "",
            "## Validation issues",
            JSON.stringify(validated.error.issues, null, 2),
            "",
            "## Raw output (truncated)",
            typeof raw === "string" ? raw.slice(0, 4000) : JSON.stringify(raw).slice(0, 4000),
            "",
          ].join("\n"),
        },
      ],
    };
  }
}
