import type { RecoverySession } from "../domain/types";
import { nextAttemptAt } from "../domain/retryPolicy";

export interface MessageSender {
  sendEmail: (session: RecoverySession) => Promise<void>;
  sendSms: (session: RecoverySession) => Promise<void>;
}

export async function processRecoveryAttempt(
  session: RecoverySession,
  nowIso: string,
  sender: MessageSender
): Promise<RecoverySession> {
  if (session.state !== "LIKELY_FAILED_PAYMENT") return session;

  await sender.sendEmail(session);
  await sender.sendSms(session);

  const next = nextAttemptAt(nowIso, session.attemptCount);
  return {
    ...session,
    attemptCount: session.attemptCount + 1,
    nextAttemptAt: next,
    state: next ? "LIKELY_FAILED_PAYMENT" : "EXPIRED"
  };
}
