import { getModelForRole } from "./modelControl.js";

/**
 * MarketPulse facet agents use a plain chat model.
 */
export const MARKETPULSE_FACET_MODEL = (process.env.MARKETPULSE_FACET_MODEL ?? getModelForRole("TargetUserAgent")).trim();
