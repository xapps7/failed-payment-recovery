import type { CheckoutSignal, RecoverySession } from "./types";

const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export function inferLikelyFailedPayment(signal: CheckoutSignal, nowIso: string): boolean {
  if (!signal.paymentInfoSubmittedAt) return false;
  if (signal.checkoutCompletedAt) return false;

  const submitted = new Date(signal.paymentInfoSubmittedAt).getTime();
  const now = new Date(nowIso).getTime();
  return now - submitted >= FAILURE_WINDOW_MS;
}

export function markRecovered(
  session: RecoverySession,
  orderId: string
): RecoverySession {
  return {
    ...session,
    state: "RECOVERED",
    recoveredOrderId: orderId,
    nextAttemptAt: undefined
  };
}
