import type { AgentRole, DagNodeId, MarketPulsePackage, SpecForgeHtmlArtifact } from "../contracts/index.js";
import { PRDAgent } from "../agents/PRDAgent.js";
import { RiskAgent } from "../agents/RiskAgent.js";
import { ArchitectureAgent } from "../agents/ArchitectureAgent.js";
import { DemoScribeAgent } from "../agents/DemoScribeAgent.js";
import { EventLogger } from "./EventLogger.js";
import { getMarketPulsePackageBySourceRunId, saveSpecForgeHtmlArtifact } from "../storage/artifacts.js";
import { createTimeBudget, withTimeout } from "./timeBudget.js";
import { TimeBudgetExceededError } from "./timeBudget.js";
import { getAgentTimeoutMs } from "./agentBudgets.js";
import { getAgentConfig } from "../config/agentConfig.js";
import { capRefinementPrompt } from "../contracts/marketPulseCompact.js";

function approxBytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

export class SpecForgeWorkflow {
  private readonly prdAgent = new PRDAgent();
  private readonly riskAgent = new RiskAgent();
  private readonly architectureAgent = new ArchitectureAgent();
  private readonly demoScribeAgent = new DemoScribeAgent();

  async run(params: { runId: string; marketPulseRunId: string; refinementPrompt: string }): Promise<SpecForgeHtmlArtifact> {
    const { runId, marketPulseRunId, refinementPrompt } = params;
    const events = new EventLogger({ runId, workflow: "spec_forge" });
    const budgetMs = Number.parseInt(process.env.SPEC_FORGE_BUDGET_MS ?? "120000", 10) || 120_000;
    const nodeTimeoutMs = Number.parseInt(process.env.SPEC_FORGE_NODE_TIMEOUT_MS ?? "30000", 10) || 30_000;
    const budget = createTimeBudget(budgetMs);

    const marketPulse: MarketPulsePackage | null = await getMarketPulsePackageBySourceRunId(marketPulseRunId);
    if (!marketPulse) {
      throw new Error(`MarketPulse package not found for run ${marketPulseRunId}`);
    }

    const refinementPromptCapped = capRefinementPrompt(refinementPrompt, 4_000);

    // Step 1: PRD
    const prd = await this.runDagNodeSequentialBudgeted(
      events,
      "prd_and_risks",
      "PRDAgent",
      "openai/gpt-oss-20b",
      budget,
      nodeTimeoutMs,
      async () => this.prdAgent.run({ marketPulsePackage: marketPulse, refinementPrompt: refinementPromptCapped }),
      () => ({
        problemStatement: "Fallback PRD",
        users: [],
        userStories: [],
        acceptanceCriteria: [],
        outOfScope: [],
      })
    );

    // Step 2: Risks (serial for demo handoff style)
    const risks = await this.runDagNodeSequentialBudgeted(
      events,
      "prd_and_risks",
      "RiskAgent",
      "openai/gpt-oss-20b",
      budget,
      nodeTimeoutMs,
      async () => this.riskAgent.run({ marketPulsePackage: marketPulse, refinementPrompt: refinementPromptCapped }),
      () => []
    );

    // Step 3: Architecture
    const architecture = await this.runDagNodeSequentialBudgeted(
      events,
      "architecture",
      "ArchitectureAgent",
      "openai/gpt-oss-20b",
      budget,
      nodeTimeoutMs,
      async () => this.architectureAgent.run({ step1: { prd, risks }, refinementPrompt: refinementPromptCapped }),
      () => ({
        overview: "Fallback architecture",
        apiContracts: [],
        dataModelNotes: [],
        fileStructure: [],
      })
    );

    // Step 4: Demo Scribe (Final HTML generation)
    const htmlOut = await this.runDagNodeSequentialBudgeted(
      events,
      "frontend",
      "DemoScribeAgent",
      "openai/gpt-oss-20b",
      budget,
      nodeTimeoutMs,
      async () =>
        this.demoScribeAgent.run({
          architecture,
          db: { sqlMigrations: [], notes: ["Database omitted in demo-only mode."] },
          backendFileSummary: "Backend omitted in demo-only mode.",
          refinementPrompt: refinementPromptCapped,
        }),
      () => ({
        summary: "Degraded HTML demo (timed out).",
        html: "<html><body><h1>Timeout</h1></body></html>",
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
    budget: createTimeBudget,
    nodeTimeoutMs: number,
    work: () => Promise<T>,
    fallback: () => T,
  ): Promise<T> {
    const t0 = Date.now();
    await events.append({ type: "dag_node_started", dag: { nodeId, agentRole: role } });
    const agentTimeoutMs = getAgentTimeoutMs({ workflow: "spec_forge", role, defaultMs: nodeTimeoutMs });
    const cfg = getAgentConfig({ workflow: "spec_forge", role, defaultModel: model, defaultTimeoutMs: agentTimeoutMs });
    const constraints =
      cfg.constraints.timeoutMs === undefined && cfg.constraints.maxTokens === undefined
        ? undefined
        : {
            ...(cfg.constraints.timeoutMs !== undefined ? { timeoutMs: cfg.constraints.timeoutMs } : {}),
            ...(cfg.constraints.maxTokens !== undefined ? { maxTokens: cfg.constraints.maxTokens } : {}),
          };
    await events.append({
      type: "agent_started",
      agent: { role, model: cfg.model, ...(constraints ? { constraints } : {}) },
    });

    const timeoutForNode = Math.min(cfg.constraints.timeoutMs ?? agentTimeoutMs, Math.max(500, (budget as any).remainingMs() - 10_000));
    const { out, outcome, error } = await withTimeout(work(), timeoutForNode, `spec_forge node ${nodeId}/${role}`)
      .then((v) => ({ out: v, outcome: "succeeded" as const, error: undefined }))
      .catch((err) => {
        if (err instanceof TimeBudgetExceededError) {
          return { out: fallback(), outcome: "timed_out" as const, error: { message: err.message, code: err.code } };
        }
        return {
          out: fallback(),
          outcome: "failed" as const,
          error: { message: err instanceof Error ? err.message : String(err), code: "AGENT_FAILED" },
        };
      });
    const durationMs = Date.now() - t0;
    await events.append({
      agent: { role, model: cfg.model, outcome, ...(error ? { error } : {}) },
      durationMs,
      type: "agent_finished"
    });
    await events.append({ type: "dag_node_finished", dag: { nodeId, agentRole: role }, durationMs, summary: `${role} complete` });
    return out;
  }
}
