/**
 * Stagger groq/compound* calls: free/on_demand tiers can be ~30 RPM; parallel
 * fan-out spikes blow past the limit. Serial + spacing keeps us under the cap.
 */
const COMPOUND_MODELS = new Set(["groq/compound", "groq/compound-mini"]);

let lastCompoundCallAt = 0;

function minIntervalMs(): number {
  const n = Number(process.env.GROQ_COMPOUND_MIN_INTERVAL_MS);
  if (Number.isFinite(n) && n >= 0) return n;
  // ~27 RPM: safe default under 30 RPM on on_demand
  return 2300;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function isCompoundModel(model: string): boolean {
  return COMPOUND_MODELS.has(model);
}

/**
 * Wait until the next safe slot to issue a groq/compound request.
 * Call this immediately before `chat.completions.create` for compound models.
 */
export async function throttleCompoundIfNeeded(model: string): Promise<void> {
  if (!isCompoundModel(model)) return;

  const gap = minIntervalMs();
  const now = Date.now();
  const next = lastCompoundCallAt + gap;
  if (now < next) {
    await sleep(next - now);
  }
  lastCompoundCallAt = Date.now();
}
