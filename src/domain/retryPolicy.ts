import type { RetryPolicy } from "./types";

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  minutesAfterFailure: [15, 360, 1440]
};

export function nextAttemptAt(
  failedAtIso: string,
  attemptNumber: number,
  policy: RetryPolicy = defaultRetryPolicy
): string | undefined {
  if (attemptNumber >= policy.maxAttempts) return undefined;

  const minutes = policy.minutesAfterFailure[attemptNumber];
  if (minutes === undefined) return undefined;

  const failedAt = new Date(failedAtIso).getTime();
  return new Date(failedAt + minutes * 60_000).toISOString();
}
