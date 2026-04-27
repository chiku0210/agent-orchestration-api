/**
 * MarketPulse facet agents use a plain chat model (not `groq/compound`).
 * Compound is a multi-tool system and can return 413 request_too_large, tight RPM,
 * or non-JSON on small inputs. `openai/gpt-oss-20b` matches the plan’s “reasoning” tier,
 * supports `json_object`, and has much higher RPM than compound on free tier.
 */
export const MARKETPULSE_FACET_MODEL = (process.env.MARKETPULSE_FACET_MODEL ?? "openai/gpt-oss-20b").trim();
