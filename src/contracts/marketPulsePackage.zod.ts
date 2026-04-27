import { z } from "zod";

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (typeof x === "string") return x;
        if (x == null) return null;
        if (typeof x === "number" || typeof x === "boolean") return String(x);
        if (typeof x === "object") {
          const o = x as Record<string, unknown>;
          const pick =
            (typeof o.hypothesis === "string" && o.hypothesis) ||
            (typeof o.value === "string" && o.value) ||
            (typeof o.text === "string" && o.text) ||
            (typeof o.title === "string" && o.title) ||
            (typeof o.metric === "string" && o.metric) ||
            null;
          return pick ?? JSON.stringify(o);
        }
        return null;
      })
      .filter((s): s is string => Boolean(s && s.trim()));
  }
  if (typeof v === "string") return v.trim() ? [v] : [];
  return [];
}

function normalizeEnum(v: unknown, allowed: string[], fallback: string): string {
  if (typeof v === "string") {
    const norm = v.trim().toLowerCase();
    if (allowed.includes(norm)) return norm;
  }
  return fallback;
}

function normalizeMarketPulsePackage(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const pkg = input as Record<string, unknown>;

  const rawMfs = pkg.market_fit_summary;
  const market_fit_summary =
    rawMfs && typeof rawMfs === "object"
      ? (() => {
          const o = rawMfs as Record<string, unknown>;
          const verdict = normalizeEnum(o.verdict, ["build", "do_not_build", "pivot", "needs_validation"], "needs_validation");
          const confidenceRaw = typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
          const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;
          const rationale =
            (typeof o.rationale === "string" && o.rationale) ||
            (typeof o.summary === "string" && o.summary) ||
            (typeof o.market_fit_summary === "string" && o.market_fit_summary) ||
            "TBD rationale";
          const assumptions = asStringArray(o.assumptions);
          return { verdict, confidence, rationale, assumptions };
        })()
      : typeof rawMfs === "string"
        ? {
            verdict: "needs_validation",
            confidence: 0.5,
            rationale: rawMfs,
            assumptions: [],
          }
        : {
            verdict: "needs_validation",
            confidence: 0.5,
            rationale: "TBD rationale",
            assumptions: [],
          };

  const personasRaw = Array.isArray(pkg.personas_jtbd) ? pkg.personas_jtbd : [];
  const personas = personasRaw.map((p) => {
    if (p && typeof p === "object") {
      const o = p as Record<string, unknown>;
      return {
        persona: typeof o.persona === "string" ? o.persona : "TBD persona",
        jobToBeDone: typeof o.jobToBeDone === "string" ? o.jobToBeDone : "TBD job to be done",
        painIntensity: normalizeEnum(o.painIntensity, ["low", "medium", "high"], "medium"),
        currentWorkarounds: asStringArray(o.currentWorkarounds),
      };
    }
    if (typeof p === "string") {
      return {
        persona: p,
        jobToBeDone: "TBD job to be done",
        painIntensity: "medium",
        currentWorkarounds: [],
      };
    }
    return {
      persona: "TBD persona",
      jobToBeDone: "TBD job to be done",
      painIntensity: "medium",
      currentWorkarounds: [],
    };
  });

  const competitiveRaw = Array.isArray(pkg.competitive_landscape) ? pkg.competitive_landscape : [];
  const competitive = competitiveRaw.map((c) => {
    if (c && typeof c === "object") {
      const o = c as Record<string, unknown>;
      return {
        name: typeof o.name === "string" ? o.name : "TBD",
        category: normalizeEnum(o.category, ["competitor", "substitute"], "competitor"),
        strengths: asStringArray(o.strengths),
        weaknesses: asStringArray(o.weaknesses),
        differentiatorsForUs: asStringArray(o.differentiatorsForUs),
      };
    }
    if (typeof c === "string") {
      return {
        name: c,
        category: "competitor",
        strengths: [],
        weaknesses: [],
        differentiatorsForUs: [],
      };
    }
    return {
      name: "TBD",
      category: "competitor",
      strengths: [],
      weaknesses: [],
      differentiatorsForUs: [],
    };
  });

  const pricingRaw = Array.isArray(pkg.pricing_hypotheses) ? pkg.pricing_hypotheses : [];
  const pricing = pricingRaw.map((ph) => {
    if (ph && typeof ph === "object") {
      const o = ph as Record<string, unknown>;
      return {
        valueMetric: typeof o.valueMetric === "string" ? o.valueMetric : "TBD value metric",
        pricePointRange: typeof o.pricePointRange === "string" ? o.pricePointRange : "TBD",
        notes: typeof o.notes === "string" ? o.notes : "TBD",
      };
    }
    return { valueMetric: "TBD value metric", pricePointRange: "TBD", notes: "TBD" };
  });

  const successRaw = Array.isArray(pkg.success_metrics) ? pkg.success_metrics : [];
  const success = successRaw.map((sm) => {
    if (sm && typeof sm === "object") {
      const o = sm as Record<string, unknown>;
      return {
        metric: typeof o.metric === "string" ? o.metric : "TBD metric",
        target: typeof o.target === "string" ? o.target : "TBD target",
        measurementPlan: typeof o.measurementPlan === "string" ? o.measurementPlan : "TBD measurement plan",
      };
    }
    return { metric: "TBD metric", target: "TBD target", measurementPlan: "TBD measurement plan" };
  });

  const validationRaw = Array.isArray(pkg.validation_plan) ? pkg.validation_plan : [];
  const validation = validationRaw.map((vp) => {
    if (vp && typeof vp === "object") {
      const o = vp as Record<string, unknown>;
      return {
        experiment: typeof o.experiment === "string" ? o.experiment : "TBD experiment",
        timeBox: typeof o.timeBox === "string" ? o.timeBox : "TBD",
        successCriteria: typeof o.successCriteria === "string" ? o.successCriteria : "TBD success criteria",
      };
    }
    return { experiment: "TBD experiment", timeBox: "TBD", successCriteria: "TBD success criteria" };
  });

  const rawMvp = pkg.mvp_scope;
  const mvp_scope =
    rawMvp && typeof rawMvp === "object"
      ? (() => {
          const o = rawMvp as Record<string, unknown>;
          return {
            goals: asStringArray(o.goals),
            nonGoals: asStringArray(o.nonGoals ?? o.non_goals),
            mustHave: asStringArray(o.mustHave ?? o.must_have),
            niceToHave: asStringArray(o.niceToHave ?? o.nice_to_have),
          };
        })()
      : {
          goals: [],
          nonGoals: [],
          mustHave: [],
          niceToHave: [],
        };

  return {
    ...pkg,
    personas_jtbd: personas,
    competitive_landscape: competitive,
    value_hypotheses: asStringArray(pkg.value_hypotheses),
    pricing_hypotheses: pricing,
    market_fit_summary,
    mvp_scope,
    success_metrics: success,
    validation_plan: validation,
    open_questions: asStringArray(pkg.open_questions),
  };
}

const MarketPulsePackageSchemaStrict = z.object({
  version: z.literal(1),
  runId: z.string(),
  createdAt: z.number(),
  featureIdea: z.string(),
  market_fit_summary: z.object({
    verdict: z.enum(["build", "do_not_build", "pivot", "needs_validation"]),
    confidence: z.number(),
    rationale: z.string(),
    assumptions: z.array(z.string()),
  }),
  personas_jtbd: z.array(
    z.object({
      persona: z.string(),
      jobToBeDone: z.string(),
      painIntensity: z.enum(["low", "medium", "high"]),
      currentWorkarounds: z.array(z.string()),
    }),
  ),
  competitive_landscape: z.array(
    z.object({
      name: z.string(),
      category: z.enum(["competitor", "substitute"]),
      strengths: z.array(z.string()),
      weaknesses: z.array(z.string()),
      differentiatorsForUs: z.array(z.string()),
    }),
  ),
  value_hypotheses: z.array(z.string()),
  pricing_hypotheses: z.array(
    z.object({
      valueMetric: z.string(),
      pricePointRange: z.string(),
      notes: z.string(),
    }),
  ),
  mvp_scope: z.object({
    goals: z.array(z.string()),
    nonGoals: z.array(z.string()),
    mustHave: z.array(z.string()),
    niceToHave: z.array(z.string()),
  }),
  success_metrics: z.array(
    z.object({
      metric: z.string(),
      target: z.string(),
      measurementPlan: z.string(),
    }),
  ),
  validation_plan: z.array(
    z.object({
      experiment: z.string(),
      timeBox: z.string(),
      successCriteria: z.string(),
    }),
  ),
  open_questions: z.array(z.string()),
});

export const MarketPulsePackageSchema = z.preprocess(
  (val) => normalizeMarketPulsePackage(val),
  MarketPulsePackageSchemaStrict,
);
