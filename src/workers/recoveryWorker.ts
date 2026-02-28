import type { RecoverySession } from "../domain/types";
import { nextAttemptAt } from "../domain/retryPolicy";
import type { RetryPolicy } from "../domain/types";

export interface MessageSender {
  sendEmail: (session: RecoverySession) => Promise<void>;
  sendSms: (session: RecoverySession) => Promise<void>;
}

export async function processRecoveryAttempt(
  session: RecoverySession,
  nowIso: string,
  sender: MessageSender,
  retryPolicy?: RetryPolicy
): Promise<RecoverySession> {
  if (session.state !== "LIKELY_FAILED_PAYMENT") return session;

  await sender.sendEmail(session);
  await sender.sendSms(session);

  const next = nextAttemptAt(nowIso, session.attemptCount, retryPolicy);
  return {
    ...session,
    attemptCount: session.attemptCount + 1,
    lastAttemptAt: nowIso,
    nextAttemptAt: next,
    state: next ? "LIKELY_FAILED_PAYMENT" : "EXPIRED"
  };
}
