import type { AgentRole, DagNodeId, FileBundleItem, MarketPulsePackage } from "../contracts/index.js";
import { PRDAgent } from "../agents/PRDAgent.js";
import { RiskAgent } from "../agents/RiskAgent.js";
import { ArchitectureAgent } from "../agents/ArchitectureAgent.js";
import { DBAgent } from "../agents/DBAgent.js";
import { BackendAgent } from "../agents/BackendAgent.js";
import { FrontendAgent } from "../agents/FrontendAgent.js";
import { EventLogger } from "./EventLogger.js";
import { logWorkflowMilestone } from "./workflowLog.js";
import { buildSpecForgeMpContext, capRefinementPrompt, compactMarketPulseForSpecForge } from "../contracts/marketPulseCompact.js";
import { getMarketPulsePackageBySourceRunId, saveFileBundleArtifact } from "../storage/artifacts.js";

const MODEL_120B = "openai/gpt-oss-120b" as const;
const MODEL_RISK = process.env.GROQ_SPEC_FORGE_RISK_MODEL?.trim() || "openai/gpt-oss-safeguard-20b";
const MODEL_FE = "openai/gpt-oss-20b" as const;

function mergeFileBundles(a: FileBundleItem[], b: FileBundleItem[]): FileBundleItem[] {
  const byPath = new Map<string, string>();
  for (const f of a) byPath.set(f.path, f.content);
  for (const f of b) byPath.set(f.path, f.content);
  return [...byPath.entries()].map(([path, content]) => ({ path, content }));
}

function approxBytes(files: FileBundleItem[]): number {
  return files.reduce((sum, f) => sum + Buffer.byteLength(f.content, "utf8"), 0);
}

export class SpecForgeWorkflow {
  private readonly prdAgent = new PRDAgent();
  private readonly riskAgent = new RiskAgent();
  private readonly architectureAgent = new ArchitectureAgent();
  private readonly dbAgent = new DBAgent();
  private readonly backendAgent = new BackendAgent();
  private readonly frontendAgent = new FrontendAgent();

  async run(params: { runId: string; marketPulseRunId: string; refinementPrompt: string }): Promise<FileBundleItem[]> {
    const { runId, marketPulseRunId, refinementPrompt } = params;
    const events = new EventLogger({ runId, workflow: "spec_forge" });

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

    // PRD uses 120B (high context). Risk uses gpt-oss-safeguard-20b, which on on_demand can
    // 413 if the same full MarketPulse JSON + refinement exceeds ~8k input tokens — so Risk
    // gets a tighter, budgeted copy via `buildSpecForgeMpContext` (see `marketPulseCompact.ts`).
    const prdContext = {
      marketPulsePackage: compactMarketPulseForSpecForge(marketPulse, { mode: "normal" }),
      refinementPrompt: capRefinementPrompt(refinementPrompt, 4_000),
    };
    const riskContext = buildSpecForgeMpContext(marketPulse, refinementPrompt);

    // Step 1 — PRD + Risk: sequential to reduce global Groq request bursts on free tier.
    await events.append({ type: "dag_node_started", dag: { nodeId: "prd_and_risks", agentRole: "PRDAgent" } });
    await events.append({ type: "agent_started", agent: { role: "PRDAgent", model: MODEL_120B } });
    const tPrd0 = Date.now();
    const prd = await this.prdAgent.run(prdContext);
    const prdDurationMs = Date.now() - tPrd0;
    await events.append({ type: "agent_finished", agent: { role: "PRDAgent", model: MODEL_120B }, durationMs: prdDurationMs });
    await events.append({
      type: "dag_node_finished",
      dag: { nodeId: "prd_and_risks", agentRole: "PRDAgent" },
      durationMs: prdDurationMs,
      summary: "PRD complete",
    });

    await events.append({ type: "dag_node_started", dag: { nodeId: "prd_and_risks", agentRole: "RiskAgent" } });
    await events.append({ type: "agent_started", agent: { role: "RiskAgent", model: MODEL_RISK } });
    const tRisk0 = Date.now();
    const riskList = await this.riskAgent.run(riskContext);
    const riskDurationMs = Date.now() - tRisk0;
    await events.append({ type: "agent_finished", agent: { role: "RiskAgent", model: MODEL_RISK }, durationMs: riskDurationMs });
    await events.append({
      type: "dag_node_finished",
      dag: { nodeId: "prd_and_risks", agentRole: "RiskAgent" },
      durationMs: riskDurationMs,
      summary: "Risk analysis complete",
    });

    const step1 = { prd, risks: riskList };

    // Step 2 — Architecture (sequential)
    const architecture = await this.runDagNodeSequential(
      events,
      "architecture",
      "ArchitectureAgent",
      MODEL_120B,
      async () => this.architectureAgent.run({ step1, refinementPrompt }),
    );

    // Step 3 — DB
    const db = await this.runDagNodeSequential(
      events,
      "db",
      "DBAgent",
      MODEL_120B,
      async () => this.dbAgent.run({ architecture, refinementPrompt }),
    );

    // Step 4 — Backend
    const backendFiles = await this.runDagNodeSequential(
      events,
      "backend",
      "BackendAgent",
      MODEL_120B,
      async () => this.backendAgent.run({ architecture, db, refinementPrompt }),
    );

    // Step 5 — Frontend
    const beSummary = backendFiles.files
      .slice(0, 12)
      .map((f) => `${f.path} (${f.content.length} chars)`)
      .join("\n");
    const frontendFiles = await this.runDagNodeSequential(
      events,
      "frontend",
      "FrontendAgent",
      MODEL_FE,
      async () =>
        this.frontendAgent.run({ architecture, db, backendFileSummary: beSummary, refinementPrompt }),
    );

    const fileBundle = mergeFileBundles(backendFiles.files, frontendFiles.files);
    await saveFileBundleArtifact(runId, fileBundle);
    await events.append({
      type: "file_bundle_generated",
      fileBundle: { fileCount: fileBundle.length, byteSizeApprox: approxBytes(fileBundle) },
    });

    return fileBundle;
  }

  private async runDagNodeSequential<T>(
    events: EventLogger,
    nodeId: DagNodeId,
    role: AgentRole,
    model: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const t0 = Date.now();
    await events.append({ type: "dag_node_started", dag: { nodeId, agentRole: role } });
    await events.append({ type: "agent_started", agent: { role, model } });
    const out = await work();
    const durationMs = Date.now() - t0;
    await events.append({ type: "agent_finished", agent: { role, model }, durationMs });
    await events.append({ type: "dag_node_finished", dag: { nodeId, agentRole: role }, durationMs, summary: `${role} complete` });
    return out;
  }
}
