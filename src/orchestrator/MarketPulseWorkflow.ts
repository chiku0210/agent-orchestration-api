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
import { createTimeBudget, withTimeout } from "./timeBudget.js";
import { MarketPulsePackageSchema } from "../contracts/marketPulsePackage.zod.js";

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

    const runFacet = async (facet: {
      id: FacetId;
      role: AgentRole;
      run: () => Promise<{ facetId: FacetId; summary: string }>;
    }) => {
      await events.append({ type: "facet_started", facet: { id: facet.id, agentRole: facet.role } });
      await events.append({ type: "agent_started", agent: { role: facet.role, model: MARKETPULSE_FACET_MODEL } });

      const t0 = Date.now();
      const timeoutForFacet = Math.min(facetTimeoutMs, Math.max(250, budget.remainingMs() - 4_000));
      const result = await withTimeout(
        facet.run(),
        timeoutForFacet,
        `market_pulse facet ${facet.id}`,
      ).catch(() => ({
        facetId: facet.id,
        summary: "Timed out (degraded facet).",
      }));
      const durationMs = Date.now() - t0;

      await events.append({ type: "agent_finished", agent: { role: facet.role, model: MARKETPULSE_FACET_MODEL }, durationMs });
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
      runFacet({
        id: "alt_solutions",
        role: "AltSolutionsAgent",
        run: () => this.altSolutionsAgent.run(params.featureIdea),
      }),
      runFacet({
        id: "pricing_willingness",
        role: "PricingWillingnessAgent",
        run: () => this.pricingWillingnessAgent.run(params.featureIdea),
      }),
      runFacet({
        id: "distribution",
        role: "DistributionAgent",
        run: () => this.distributionAgent.run(params.featureIdea),
      }),
      runFacet({
        id: "risks_constraints",
        role: "RisksConstraintsAgent",
        run: () => this.risksConstraintsAgent.run(params.featureIdea),
      }),
    ]);

    // Fan-in: synthesize a strict MarketPulsePackage.
    await events.append({ type: "synthesizer_started", synthesizer: { role: "MarketPulseSynthesizer" } });
    await events.append({ type: "agent_started", agent: { role: "MarketPulseSynthesizer", model: "llama-3.3-70b-versatile" } });
    const t0 = Date.now();

    const facetSummaries = [targetUser, altSolutions, pricing, distribution, risks].map((r) => ({
      facetId: r.facetId,
      summary: r.summary,
    }));

    const remainingForSynth = budget.remainingMs();
    const pkg =
      remainingForSynth < 6_000
        ? MarketPulsePackageSchema.parse({
            version: 1,
            runId,
            createdAt,
            featureIdea: params.featureIdea,
            market_fit_summary: {
              verdict: "needs_validation",
              confidence: 0.5,
              rationale: "Degraded synthesis: time budget low; review facet summaries.",
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
          })
        : await withTimeout(
            this.synthesizer.synthesize({
              runId,
              createdAt,
              featureIdea: params.featureIdea,
              facetSummaries,
            }),
            Math.min(synthTimeoutMs, Math.max(500, remainingForSynth - 1_500)),
            "market_pulse synth",
          ).catch(() =>
            MarketPulsePackageSchema.parse({
              version: 1,
              runId,
              createdAt,
              featureIdea: params.featureIdea,
              market_fit_summary: {
                verdict: "needs_validation",
                confidence: 0.5,
                rationale: "Degraded synthesis: synthesizer timed out; review facet summaries.",
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
            }),
          );

    const durationMs = Date.now() - t0;
    await events.append({
      type: "agent_finished",
      agent: { role: "MarketPulseSynthesizer", model: "llama-3.3-70b-versatile" },
      durationMs,
    });
    await events.append({
      type: "synthesizer_finished",
      synthesizer: { role: "MarketPulseSynthesizer" },
      durationMs,
      artifactRef: { kind: "market_pulse_package", runId },
    });

    return pkg;
  }
}

