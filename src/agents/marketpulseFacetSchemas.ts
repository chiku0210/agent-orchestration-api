import { z } from "zod";

export const MarketPulseFacetResultSchema = z.object({
  facetId: z.enum([
    "target_user",
    "alt_solutions",
    "pricing_willingness",
    "distribution",
    "risks_constraints",
  ]),
  summary: z.string(),
});

export type MarketPulseFacetResult = z.infer<typeof MarketPulseFacetResultSchema>;

