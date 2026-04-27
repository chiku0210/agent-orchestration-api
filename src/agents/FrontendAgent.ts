import { AgentRunner } from "../orchestrator/AgentRunner.js";
import type { z } from "zod";
import { SpecForgeArchitectureBlockSchema, SpecForgeDbBlockSchema, SpecForgeHtmlOutputSchema } from "./specForgeSchemas.js";

// Use a high-limit, reliable JSON-following model to avoid Groq TPM caps
// seen with `qwen/qwen3-32b` for larger prompts.
const MODEL = "openai/gpt-oss-20b" as const;

type Arch = z.infer<typeof SpecForgeArchitectureBlockSchema>;
type Db = z.infer<typeof SpecForgeDbBlockSchema>;
type HtmlOut = z.infer<typeof SpecForgeHtmlOutputSchema>;

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
  }): Promise<HtmlOut> {
    const raw = await this.runner.run({
      systemPrompt: [
        "You are FrontendAgent.",
        "Generate a single self-contained HTML document that demonstrates the feature.",
        "This is a demo artifact that will be rendered inside an existing Next.js app, so DO NOT scaffold a backend, DO NOT scaffold a Next.js project, and DO NOT output multiple files.",
        "",
        "Return JSON ONLY with this shape:",
        '{ "summary": string, "html": string }',
        "",
        "The `summary` must be ONE short sentence describing what the HTML demo does.",
        "The `html` must be a complete HTML document (start with <!doctype html>) with inline CSS + inline JS if needed.",
        "Keep it small and fast: avoid external dependencies, CDNs, images, or network calls unless essential.",
        "",
        "Output rules:",
        "- No markdown fences.",
        "- No extra keys.",
        "- The HTML must be safe to embed (no <script src=...>), and must not assume a backend exists.",
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
    const validated = SpecForgeHtmlOutputSchema.safeParse(parsed);
    if (validated.success) return validated.data;

    // Last-resort durable fallback so spec_forge doesn't crash.
    return {
      summary: "Degraded HTML demo (schema mismatch).",
      html: [
        "<!doctype html>",
        "<html>",
        "  <head>",
        '    <meta charset="utf-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
        "    <title>SpecForge (degraded)</title>",
        "    <style>",
        "      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; margin: 24px; }",
        "      pre { background: #0b1220; color: #d7e0ff; padding: 12px; border-radius: 8px; overflow: auto; }",
        "      .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; margin-top: 12px; }",
        "    </style>",
        "  </head>",
        "  <body>",
        "    <h1>SpecForge HTML (degraded)</h1>",
        "    <p>The model returned output, but it did not match <code>{ summary, html }</code>.</p>",
        '    <div class="card">',
        "      <h2>Validation issues</h2>",
        '      <pre id="issues"></pre>',
        "    </div>",
        '    <div class="card">',
        "      <h2>Raw output (truncated)</h2>",
        '      <pre id="raw"></pre>',
        "    </div>",
        "    <script>",
        `      document.getElementById("issues").textContent = ${JSON.stringify(
          JSON.stringify(validated.error.issues, null, 2).slice(0, 4000),
        )};`,
        `      document.getElementById("raw").textContent = ${JSON.stringify(
          (typeof raw === "string" ? raw.slice(0, 4000) : JSON.stringify(raw).slice(0, 4000)) ?? "",
        )};`,
        "    </script>",
        "  </body>",
        "</html>",
        "",
      ].join("\n"),
    };
  }
}
