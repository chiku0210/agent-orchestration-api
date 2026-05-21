import { AgentRunner } from "../orchestrator/AgentRunner.js";
import type { z } from "zod";
import { SpecForgeArchitectureBlockSchema, SpecForgeDbBlockSchema, SpecForgeHtmlOutputSchema } from "./specForgeSchemas.js";
import { getAgentConfig } from "../config/agentConfig.js";

type Arch = z.infer<typeof SpecForgeArchitectureBlockSchema>;
type Db = z.infer<typeof SpecForgeDbBlockSchema>;
type HtmlOut = z.infer<typeof SpecForgeHtmlOutputSchema>;

function parseLooseHtml(raw: string): HtmlOut {
  const strippedThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const text = strippedThink;
  if (!text) throw new SyntaxError("Empty model response");

  // If it's already raw HTML starting with doctype or html tag
  if (text.toLowerCase().startsWith("<!doctype html>") || text.toLowerCase().startsWith("<html")) {
    return { summary: "Generated Demo", html: text };
  }

  // Look for markdown fences
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    return { summary: "Generated Demo", html: fence[1].trim() };
  }

  // Fallback: try to find an <html> tag anywhere in the string
  const htmlMatch = text.match(/<html[\s\S]*<\/html>/i);
  if (htmlMatch?.[0]) {
    return { summary: "Generated Demo", html: htmlMatch[0] };
  }

  // Last resort, return the whole text wrapped
  return { summary: "Generated Demo", html: `<html><body>${text}</body></html>` };
}

export class DemoScribeAgent {
  private readonly runner: AgentRunner;
  private readonly maxTokens: number;

  constructor() {
    const cfg = getAgentConfig({
      workflow: "spec_forge",
      role: "DemoScribeAgent",
      defaultMaxTokens: 6000,
    });
    this.runner = new AgentRunner(cfg.model);
    this.maxTokens = cfg.constraints.maxTokens ?? 6000;
  }

  async run(params: {
    architecture: Arch;
    db: Db;
    backendFileSummary: string;
    refinementPrompt: string;
  }): Promise<HtmlOut> {
    const raw = await this.runner.run({
      systemPrompt: [
        "You are DemoScribeAgent.",
        "Generate a complete, single-file HTML/CSS/JS prototype based on the Architecture and PRD.",
        "The HTML must be visually polished, using modern CSS (flexbox/grid) and a clean aesthetic.",
        "This is a demo artifact that will be rendered inside an existing Next.js app, so DO NOT scaffold a backend, DO NOT scaffold a Next.js project, and DO NOT output multiple files.",
        "",
        "CRITICAL RULES:",
        "1. Output ONLY raw HTML. Start with <!doctype html>.",
        "2. Do NOT wrap your output in a JSON object.",
        "3. Do NOT include markdown code fences (like ```html).",
        "4. Include all CSS within <style> tags and all JS within <script> tags inside the HTML document.",
        "5. Keep it small and fast: avoid external dependencies, CDNs, images, or network calls unless essential.",
      ].join("\n"),
      userPrompt: JSON.stringify({
        architecture: params.architecture,
        db: params.db,
        backendFileSummary: params.backendFileSummary,
        refinementPrompt: params.refinementPrompt,
      }),
      // Intentionally avoid schema-enforced mode here; we extract the HTML directly.
      maxTokens: this.maxTokens,
    });

    const parsed = typeof raw === "string" ? parseLooseHtml(raw) : (raw as HtmlOut);
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
        "    <title>DemoScribe (degraded)</title>",
        "    <style>",
        "      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; margin: 24px; }",
        "      pre { background: #0b1220; color: #d7e0ff; padding: 12px; border-radius: 8px; overflow: auto; }",
        "      .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; margin-top: 12px; }",
        "    </style>",
        "  </head>",
        "  <body>",
        "    <h1>DemoScribe HTML (degraded)</h1>",
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
