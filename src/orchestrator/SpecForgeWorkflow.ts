import type { AgentRole, DagNodeId, MarketPulsePackage, SpecForgeHtmlArtifact } from "../contracts/index.js";
import { FrontendAgent } from "../agents/FrontendAgent.js";
import { EventLogger } from "./EventLogger.js";
import { logWorkflowMilestone } from "./workflowLog.js";
import { capRefinementPrompt, compactMarketPulseForSpecForge } from "../contracts/marketPulseCompact.js";
import { getMarketPulsePackageBySourceRunId, saveSpecForgeHtmlArtifact } from "../storage/artifacts.js";
import { createTimeBudget, withTimeout } from "./timeBudget.js";

const MODEL_FE = "openai/gpt-oss-20b" as const;

function approxBytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

export class SpecForgeWorkflow {
  private readonly frontendAgent = new FrontendAgent();

  async run(params: { runId: string; marketPulseRunId: string; refinementPrompt: string }): Promise<SpecForgeHtmlArtifact> {
    const { runId, marketPulseRunId, refinementPrompt } = params;
    const events = new EventLogger({ runId, workflow: "spec_forge" });
    const budgetMs = Number.parseInt(process.env.SPEC_FORGE_BUDGET_MS ?? "60000", 10) || 60_000;
    const nodeTimeoutMs = Number.parseInt(process.env.SPEC_FORGE_NODE_TIMEOUT_MS ?? "25000", 10) || 25_000;
    const budget = createTimeBudget(budgetMs);

    const marketPulse: MarketPulsePackage | null = await getMarketPulsePackageBySourceRunId(marketPulseRunId);
    if (!marketPulse) {
      throw new Error(`MarketPulse package not found for run ${marketPulseRunId}`);
    }
    logWorkflowMilestone({
      runId,
      workflow: "spec_forge",
      message: "step 0 — loaded MarketPulse package from artifact store",
      data: { marketPulseRunId, featureIdeaPreview: marketPulse.featureIdea.slice(0, 120) },
    });

    // HTML-only mode: generate a single demo HTML document (no backend/frontend scaffolds).
    const mpCompact = compactMarketPulseForSpecForge(marketPulse, { mode: "tight" });
    const refinementPromptCapped = capRefinementPrompt(refinementPrompt, 4_000);

    const htmlOut = await this.runDagNodeSequentialBudgeted(
      events,
      "frontend",
      "FrontendAgent",
      MODEL_FE,
      budget,
      nodeTimeoutMs,
      async () =>
        this.frontendAgent.run({
          architecture: {
            overview: `HTML-only mode. MarketPulse summary: ${mpCompact.market_fit_summary?.verdict ?? "unknown"} — ${String(
              mpCompact.market_fit_summary?.rationale ?? "",
            ).slice(0, 240)}`,
            apiContracts: [],
            dataModelNotes: [],
            fileStructure: [],
          },
          db: { sqlMigrations: [], notes: ["No DB generated in HTML-only mode."] },
          backendFileSummary: "No backend generated in HTML-only mode.",
          refinementPrompt: refinementPromptCapped,
        }),
      () => ({
        summary: "Degraded HTML demo (timed out).",
        html: [
          "<!doctype html>",
          "<html>",
          "  <head>",
          '    <meta charset="utf-8" />',
          '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
          "    <title>SpecForge (degraded)</title>",
          "  </head>",
          "  <body>",
          "    <h1>SpecForge HTML (degraded)</h1>",
          "    <p>Timed out while generating HTML. Re-run with a larger budget.</p>",
          "  </body>",
          "</html>",
          "",
        ].join("\n"),
      }),
    );

    const artifact: SpecForgeHtmlArtifact = {
      summary: htmlOut.summary,
      html: htmlOut.html,
    };
    await saveSpecForgeHtmlArtifact(runId, artifact);
    await events.append({
      type: "spec_forge_html_generated",
      html: { summary: artifact.summary, byteSizeApprox: approxBytes(artifact.html) },
    });

    return artifact;
  }

  private async runDagNodeSequentialBudgeted<T>(
    events: EventLogger,
    nodeId: DagNodeId,
    role: AgentRole,
    model: string,
    budget: ReturnType<typeof createTimeBudget>,
    nodeTimeoutMs: number,
    work: () => Promise<T>,
    fallback: () => T,
  ): Promise<T> {
    const t0 = Date.now();
    await events.append({ type: "dag_node_started", dag: { nodeId, agentRole: role } });
    await events.append({ type: "agent_started", agent: { role, model } });
    const timeoutForNode = Math.min(nodeTimeoutMs, Math.max(500, budget.remainingMs() - 10_000));
    const out = await withTimeout(work(), timeoutForNode, `spec_forge node ${nodeId}/${role}`).catch(() => fallback());
    const durationMs = Date.now() - t0;
    await events.append({ type: "agent_finished", agent: { role, model }, durationMs });
    await events.append({ type: "dag_node_finished", dag: { nodeId, agentRole: role }, durationMs, summary: `${role} complete` });
    return out;
  }
}
