import { randomUUID } from "node:crypto";

import type { AgentRole, FacetId, MarketPulsePackage } from "../contracts/index.js";
import { AltSolutionsAgent } from "../agents/AltSolutionsAgent.js";
import { DistributionAgent } from "../agents/DistributionAgent.js";
import { PricingWillingnessAgent } from "../agents/PricingWillingnessAgent.js";
import { RisksConstraintsAgent } from "../agents/RisksConstraintsAgent.js";
import { TargetUserAgent } from "../agents/TargetUserAgent.js";
import { MarketPulseSynthesizer } from "../agents/MarketPulseSynthesizer.js";
import { MARKETPULSE_FACET_MODEL } from "../config/models.js";
import { EventLogger } from "./EventLogger.js";
import { logWorkflowMilestone } from "./workflowLog.js";
import { createTimeBudget, TimeBudgetExceededError, withTimeout } from "./timeBudget.js";
import { MarketPulsePackageSchema } from "../contracts/marketPulsePackage.zod.js";
import { getAgentTimeoutMs } from "./agentBudgets.js";
import { getAgentConfig } from "../config/agentConfig.js";
import { saveMarketPulsePackageArtifact } from "../storage/artifacts.js";

export class MarketPulseWorkflow {
  private readonly targetUserAgent = new TargetUserAgent();
  private readonly altSolutionsAgent = new AltSolutionsAgent();
  private readonly pricingWillingnessAgent = new PricingWillingnessAgent();
  private readonly distributionAgent = new DistributionAgent();
  private readonly risksConstraintsAgent = new RisksConstraintsAgent();

  private readonly synthesizer = new MarketPulseSynthesizer();

  async run(params: { featureIdea: string; runId?: string; createdAt?: number }): Promise<MarketPulsePackage> {
    const runId = params.runId ?? randomUUID();
    const createdAt = params.createdAt ?? Date.now();
    const events = new EventLogger({ runId, workflow: "market_pulse" });
    const budgetMs = Number.parseInt(process.env.MARKET_PULSE_BUDGET_MS ?? "60000", 10) || 60_000;
    const facetTimeoutMs = Number.parseInt(process.env.MARKET_PULSE_FACET_TIMEOUT_MS ?? "15000", 10) || 15_000;
    const synthTimeoutMs = Number.parseInt(process.env.MARKET_PULSE_SYNTH_TIMEOUT_MS ?? "20000", 10) || 20_000;
    const budget = createTimeBudget(budgetMs);
    logWorkflowMilestone({
      runId,
      workflow: "market_pulse",
      message: "step 1 — run 5 research facets in parallel (target user, alternatives, pricing, distribution, risks)",
    });

    const sleep = async (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const runFacet = async (facet: {
      id: FacetId;
      role: AgentRole;
      run: () => Promise<{ facetId: FacetId; summary: string }>;
    }) => {
      await events.append({ type: "facet_started", facet: { id: facet.id, agentRole: facet.role } });
      const agentTimeoutMs = getAgentTimeoutMs({
        workflow: "market_pulse",
        role: facet.role,
        defaultMs: facetTimeoutMs,
      });
      const cfg = getAgentConfig({
        workflow: "market_pulse",
        role: facet.role,
        defaultModel: MARKETPULSE_FACET_MODEL,
        defaultTimeoutMs: agentTimeoutMs,
      });
      const constraints =
        cfg.constraints.timeoutMs === undefined && cfg.constraints.maxTokens === undefined
          ? undefined
          : {
              ...(cfg.constraints.timeoutMs !== undefined ? { timeoutMs: cfg.constraints.timeoutMs } : {}),
              ...(cfg.constraints.maxTokens !== undefined ? { maxTokens: cfg.constraints.maxTokens } : {}),
            };
      await events.append({
        type: "agent_started",
        agent: { role: facet.role, model: cfg.model, ...(constraints ? { constraints } : {}) },
      });

      const t0 = Date.now();
      const timeoutForFacet = Math.min(cfg.constraints.timeoutMs ?? agentTimeoutMs, Math.max(250, budget.remainingMs() - 4_000));
      const { result, outcome, error } = await withTimeout(facet.run(), timeoutForFacet, `market_pulse facet ${facet.id}`)
        .then((r) => ({ result: r, outcome: "succeeded" as const, error: undefined }))
        .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[MarketPulse] Facet ${facet.id} failed`, err);
        const status = err && typeof err === "object" ? (err as { status?: number }).status : undefined;
        if (err instanceof TimeBudgetExceededError) {
          return {
            result: { facetId: facet.id, summary: "Timed out (degraded facet)." },
            outcome: "timed_out" as const,
            error: { message: err.message, code: err.code },
          };
        }
        if (status === 429) {
          return {
            result: { facetId: facet.id, summary: "Rate-limited (429) (degraded facet)." },
            outcome: "degraded" as const,
            error: { message: "Rate-limited (429)", code: "RATE_LIMITED" },
          };
        }
        if (status === 413) {
          return {
            result: { facetId: facet.id, summary: "Request too large (413) (degraded facet)." },
            outcome: "degraded" as const,
            error: { message: "Request too large (413)", code: "REQUEST_TOO_LARGE" },
          };
        }
        return {
          result: { facetId: facet.id, summary: "Facet unavailable (agent failed) (degraded facet)." },
          outcome: "failed" as const,
          error: { message: err instanceof Error ? err.message : String(err), code: "AGENT_FAILED" },
        };
      });
      const durationMs = Date.now() - t0;

      await events.append({
        type: "agent_finished",
        agent: { role: facet.role, model: cfg.model, outcome, ...(error ? { error } : {}) },
        durationMs,
      });
      await events.append({
        type: "facet_finished",
        facet: { id: facet.id, agentRole: facet.role },
        durationMs,
        summary: result.summary,
      });

      return result;
    };

    // Fan-out: facets use a plain chat model (default `openai/gpt-oss-20b`), not `groq/compound`,
    // to avoid 413/429 and flaky JSON from the Compound system. Parallel is OK (high RPM on 20B).
    const [targetUser, altSolutions, pricing, distribution, risks] = await Promise.all([
      runFacet({
        id: "target_user",
        role: "TargetUserAgent",
        run: () => this.targetUserAgent.run(params.featureIdea),
      }),
      (async () => {
        await sleep(300);
        return runFacet({
        id: "alt_solutions",
        role: "AltSolutionsAgent",
        run: () => this.altSolutionsAgent.run(params.featureIdea),
        });
      })(),
      (async () => {
        await sleep(600);
        return runFacet({
        id: "pricing_willingness",
        role: "PricingWillingnessAgent",
        run: () => this.pricingWillingnessAgent.run(params.featureIdea),
        });
      })(),
      (async () => {
        await sleep(900);
        return runFacet({
        id: "distribution",
        role: "DistributionAgent",
        run: () => this.distributionAgent.run(params.featureIdea),
        });
      })(),
      (async () => {
        await sleep(1200);
        return runFacet({
        id: "risks_constraints",
        role: "RisksConstraintsAgent",
        run: () => this.risksConstraintsAgent.run(params.featureIdea),
        });
      })(),
    ]);

    // Fan-in: synthesize a strict MarketPulsePackage.
    await events.append({ type: "synthesizer_started", synthesizer: { role: "MarketPulseSynthesizer" } });
    const synthRole: AgentRole = "MarketPulseSynthesizer";
    const synthTimeoutResolved = getAgentTimeoutMs({
      workflow: "market_pulse",
      role: synthRole,
      defaultMs: synthTimeoutMs,
    });
    const synthCfg = getAgentConfig({
      workflow: "market_pulse",
      role: synthRole,
      defaultModel: "llama-3.3-70b-versatile",
      defaultTimeoutMs: synthTimeoutResolved,
    });
    const synthConstraints =
      synthCfg.constraints.timeoutMs === undefined && synthCfg.constraints.maxTokens === undefined
        ? undefined
        : {
            ...(synthCfg.constraints.timeoutMs !== undefined ? { timeoutMs: synthCfg.constraints.timeoutMs } : {}),
            ...(synthCfg.constraints.maxTokens !== undefined ? { maxTokens: synthCfg.constraints.maxTokens } : {}),
          };
    await events.append({
      type: "agent_started",
      agent: { role: synthRole, model: synthCfg.model, ...(synthConstraints ? { constraints: synthConstraints } : {}) },
    });
    const t0 = Date.now();

    const facetSummaries = [targetUser, altSolutions, pricing, distribution, risks].map((r) => ({
      facetId: r.facetId,
      summary: r.summary,
    }));

    const remainingForSynth = budget.remainingMs();
    const synthFallback = (rationale: string) =>
      MarketPulsePackageSchema.parse({
            version: 1,
            runId,
            createdAt,
            featureIdea: params.featureIdea,
            market_fit_summary: {
              verdict: "needs_validation",
              confidence: 0.5,
              rationale,
              assumptions: [],
            },
            personas_jtbd: [],
            competitive_landscape: [],
            value_hypotheses: facetSummaries.map((f) => `${f.facetId}: ${f.summary}`).slice(0, 8),
            pricing_hypotheses: [],
            mvp_scope: { goals: [], nonGoals: [], mustHave: [], niceToHave: [] },
            success_metrics: [],
            validation_plan: [],
            open_questions: [],
          });

    const { pkg, outcome: synthOutcome, error: synthError } =
      remainingForSynth < 6_000
        ? {
            pkg: synthFallback("Degraded synthesis: time budget low; review facet summaries."),
            outcome: "degraded" as const,
            error: { message: "Time budget low for synthesis", code: "TIME_BUDGET_LOW" },
          }
        : await withTimeout(
            this.synthesizer.synthesize({
              runId,
              createdAt,
              featureIdea: params.featureIdea,
              facetSummaries,
            }),
            Math.min(synthCfg.constraints.timeoutMs ?? synthTimeoutResolved, Math.max(500, remainingForSynth - 1_500)),
            "market_pulse synth",
          )
            .then((p) => ({ pkg: p, outcome: "succeeded" as const, error: undefined }))
            .catch((err) => {
              if (err instanceof TimeBudgetExceededError) {
                return {
                  pkg: synthFallback("Degraded synthesis: synthesizer timed out; review facet summaries."),
                  outcome: "timed_out" as const,
                  error: { message: err.message, code: err.code },
                };
              }
              return {
                pkg: synthFallback("Degraded synthesis: synthesizer failed; review facet summaries."),
                outcome: "failed" as const,
                error: { message: err instanceof Error ? err.message : String(err), code: "AGENT_FAILED" },
              };
            });

    const durationMs = Date.now() - t0;
    await events.append({
      type: "agent_finished",
      agent: { role: synthRole, model: synthCfg.model, outcome: synthOutcome, ...(synthError ? { error: synthError } : {}) },
      durationMs,
    });

    // Critical ordering: persist the package before emitting any "finished"/artifact-ref events.
    await saveMarketPulsePackageArtifact(runId, pkg);

    await events.append({
      type: "synthesizer_finished",
      synthesizer: { role: "MarketPulseSynthesizer" },
      durationMs,
      artifactRef: { kind: "market_pulse_package", runId },
    });

    return pkg;
  }
}

