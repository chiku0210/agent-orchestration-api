import type { MarketPulsePackage } from "./index.js";

const E = "…" as const;

function cap(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - E.length)) + E;
}

function capArr(strings: string[], maxItems: number, each: number): string[] {
  return strings.slice(0, maxItems).map((s) => cap(s, each));
}

/**
 * Groq on_demand tiers often cap a single request at ~8k **tokens** for smaller models
 * (e.g. gpt-oss-safeguard-20b). A full `MarketPulsePackage` JSON can exceed that
 * (facets, long rationale strings, etc.) while the MarketPulse **synth** run uses
 * a different model / prompt shape and can stay under the limit.
 *
 * This keeps the same public shape (still a valid `MarketPulsePackage`) but trims
 * verbose fields so PRD / Risk can send one request on free tier.
 */
export function compactMarketPulseForSpecForge(
  pkg: MarketPulsePackage,
  options: { mode?: "normal" | "tight" } = {},
): MarketPulsePackage {
  const tight = options.mode === "tight";
  const L = tight ? 900 : 1800;
  const M = tight ? 500 : 1200;
  const S = tight ? 220 : 500;
  const np = tight ? 2 : 4;
  const nc = tight ? 2 : 4;
  const nv = tight ? 3 : 6;
  const nprice = tight ? 2 : 3;
  const nsm = tight ? 2 : 4;
  const nvalp = tight ? 1 : 2;
  const noq = tight ? 3 : 6;
  const arrEach = (xs: string[], mi: number, n: number) => capArr(xs, mi, n);

  return {
    version: 1,
    runId: pkg.runId,
    createdAt: pkg.createdAt,
    featureIdea: cap(pkg.featureIdea, tight ? 1200 : 2500),
    market_fit_summary: {
      ...pkg.market_fit_summary,
      rationale: cap(pkg.market_fit_summary.rationale, L),
      assumptions: capArr(pkg.market_fit_summary.assumptions, np, S + 200),
    },
    personas_jtbd: pkg.personas_jtbd.slice(0, np).map((p) => ({
      ...p,
      persona: cap(p.persona, S + 200),
      jobToBeDone: cap(p.jobToBeDone, M),
      currentWorkarounds: capArr(p.currentWorkarounds, np, S),
    })),
    competitive_landscape: pkg.competitive_landscape.slice(0, nc).map((c2) => ({
      ...c2,
      name: cap(c2.name, 100),
      strengths: capArr(c2.strengths, 3, S),
      weaknesses: capArr(c2.weaknesses, 3, S),
      differentiatorsForUs: capArr(c2.differentiatorsForUs, 3, S),
    })),
    value_hypotheses: capArr(pkg.value_hypotheses, nv, M),
    pricing_hypotheses: pkg.pricing_hypotheses.slice(0, nprice).map((p) => ({
      ...p,
      valueMetric: cap(p.valueMetric, 200),
      pricePointRange: cap(p.pricePointRange, 200),
      notes: cap(p.notes, S + 200),
    })),
    mvp_scope: {
      goals: capArr(pkg.mvp_scope.goals, np, S + 200),
      nonGoals: capArr(pkg.mvp_scope.nonGoals, Math.max(1, np - 1), S + 200),
      mustHave: capArr(pkg.mvp_scope.mustHave, tight ? 5 : 8, S + 200),
      niceToHave: capArr(pkg.mvp_scope.niceToHave, tight ? 2 : 4, S + 200),
    },
    success_metrics: pkg.success_metrics.slice(0, nsm).map((m) => ({
      ...m,
      metric: cap(m.metric, 200),
      target: cap(m.target, 200),
      measurementPlan: cap(m.measurementPlan, S + 200),
    })),
    validation_plan: pkg.validation_plan.slice(0, nvalp).map((v) => ({
      ...v,
      experiment: cap(v.experiment, M + 200),
      timeBox: cap(v.timeBox, 80),
      successCriteria: cap(v.successCriteria, S + 200),
    })),
    open_questions: capArr(pkg.open_questions, noq, S + 300),
  };
}

const DEFAULT_REFINEMENT_CAP = 4000;
/**
 * Groq on_demand: small models (e.g. gpt-oss-safeguard-20b) can reject a single call when
 * "Requested" input tokens over ~8k. JSON is token-dense, so the serialized user payload
 * should stay in a low character budget.
 */
const TIGHTER_THRESHOLD_CHARS = 10_000;

/**
 * Capped user refinement so one agent request does not blow past TPM.
 */
export function capRefinementPrompt(refinementPrompt: string, maxChars = DEFAULT_REFINEMENT_CAP): string {
  return cap(refinementPrompt, maxChars);
}

function userPayloadSize(mp: MarketPulsePackage, r: string): number {
  return JSON.stringify({ marketPulsePackage: mp, refinementPrompt: r }).length;
}

/**
 * Re-compact and trim until the user JSON is small enough for low-tier Groq small models
 * (e.g. 8k TPM for `openai/gpt-oss-safeguard-20b` on on_demand).
 */
export function buildSpecForgeMpContext(
  marketPulse: MarketPulsePackage,
  refinementPrompt: string,
): { marketPulsePackage: MarketPulsePackage; refinementPrompt: string } {
  let r = capRefinementPrompt(refinementPrompt);
  let mp = compactMarketPulseForSpecForge(marketPulse, { mode: "normal" });
  if (userPayloadSize(mp, r) <= TIGHTER_THRESHOLD_CHARS) {
    return { marketPulsePackage: mp, refinementPrompt: r };
  }
  mp = compactMarketPulseForSpecForge(marketPulse, { mode: "tight" });
  if (userPayloadSize(mp, r) <= TIGHTER_THRESHOLD_CHARS) {
    return { marketPulsePackage: mp, refinementPrompt: r };
  }
  r = capRefinementPrompt(refinementPrompt, 2000);
  if (userPayloadSize(mp, r) <= TIGHTER_THRESHOLD_CHARS) {
    return { marketPulsePackage: mp, refinementPrompt: r };
  }
  r = capRefinementPrompt(refinementPrompt, 1000);
  return { marketPulsePackage: mp, refinementPrompt: r };
}
