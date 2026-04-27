export class TimeBudgetExceededError extends Error {
  readonly code = "TIME_BUDGET_EXCEEDED" as const;
  constructor(message: string) {
    super(message);
    this.name = "TimeBudgetExceededError";
  }
}

export type TimeBudget = {
  readonly deadlineMs: number;
  remainingMs: () => number;
  assertRemaining: (minMs: number, label: string) => void;
};

export function createTimeBudget(totalMs: number, nowMs: () => number = () => Date.now()): TimeBudget {
  const deadlineMs = nowMs() + Math.max(0, totalMs);
  return {
    deadlineMs,
    remainingMs: () => Math.max(0, deadlineMs - nowMs()),
    assertRemaining: (minMs: number, label: string) => {
      if (deadlineMs - nowMs() < minMs) {
        throw new TimeBudgetExceededError(`Time budget exceeded before ${label}`);
      }
    },
  };
}

export async function withTimeout<T>(
  p: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (!(timeoutMs > 0)) return p;
  let t: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new TimeBudgetExceededError(`Timed out: ${label}`)), timeoutMs);
    });
    return (await Promise.race([p, timeout])) as T;
  } finally {
    if (t) clearTimeout(t);
  }
}

