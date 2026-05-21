/**
 * Stagger NVIDIA NIM calls to avoid hitting rate limits (RPM/TPM) during parallel fan-out.
 * Uses a simple promise chain to ensure serial execution with a minimum gap.
 */

let throttlePromise = Promise.resolve();
let lastCallAt = 0;

function minIntervalMs(): number {
  const n = Number(process.env.NIM_REQUEST_INTERVAL_MS);
  if (Number.isFinite(n) && n >= 0) return n;
  return 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wait until the next safe slot to issue a NIM request.
 */
export async function throttleNIMIfNeeded(_model?: string): Promise<void> {
  const gap = minIntervalMs();

  // Chain onto the existing promise to ensure serial access to the timing logic.
  throttlePromise = throttlePromise.then(async () => {
    const now = Date.now();
    const next = lastCallAt + gap;

    if (now < next) {
      await sleep(next - now);
    }
    lastCallAt = Date.now();
  });

  return throttlePromise;
}
