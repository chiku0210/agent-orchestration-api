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
    logWorkflowMilestone({
      runId,
      workflow: "market_pulse",
      message: "step 1 — run 5 research facets in parallel (target user, alternatives, pricing, distribution, risks)",
    });

    const runFacet = async (facet: { id: FacetId; role: AgentRole; run: () => Promise<{ facetId: FacetId; summary: string }> }) => {
      await events.append({ type: "facet_started", facet: { id: facet.id, agentRole: facet.role } });
      await events.append({ type: "agent_started", agent: { role: facet.role, model: MARKETPULSE_FACET_MODEL } });

      const t0 = Date.now();
      const result = await facet.run();
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

    const pkg = await this.synthesizer.synthesize({
      runId,
      createdAt,
      featureIdea: params.featureIdea,
      facetSummaries: [
        targetUser,
        altSolutions,
        pricing,
        distribution,
        risks,
      ].map((r) => ({ facetId: r.facetId, summary: r.summary })),
    });

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

