import { z } from "zod";

export const MarketPulsePackageSchema = z.object({
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
