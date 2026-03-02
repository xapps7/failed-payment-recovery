import type { RecoverySession } from "../domain/types";
import { nextAttemptAt } from "../domain/retryPolicy";
import type { RetryPolicy } from "../domain/types";
import type { CampaignStep } from "../services/campaignStore";

export interface DeliveryResult {
  channel: "email" | "sms";
  provider: string;
  status: string;
  sent: boolean;
  payload?: Record<string, unknown>;
}

export interface MessageSender {
  sendEmail: (session: RecoverySession) => Promise<DeliveryResult>;
  sendSms: (session: RecoverySession) => Promise<DeliveryResult>;
}

export async function processRecoveryAttempt(
  session: RecoverySession,
  nowIso: string,
  sender: MessageSender,
  retryPolicy?: RetryPolicy,
  activeStep?: CampaignStep
): Promise<{ session: RecoverySession; deliveries: DeliveryResult[] }> {
  if (session.state !== "LIKELY_FAILED_PAYMENT") return { session, deliveries: [] };

  const deliveries: DeliveryResult[] = [];

  if (activeStep?.channel === "sms") {
    deliveries.push(await sender.sendSms(session));
  } else {
    deliveries.push(await sender.sendEmail(session));
  }

  const next = nextAttemptAt(nowIso, session.attemptCount, retryPolicy);
  return {
    session: {
      ...session,
      attemptCount: session.attemptCount + 1,
      lastAttemptAt: nowIso,
      nextAttemptAt: next,
      state: next ? "LIKELY_FAILED_PAYMENT" : "EXPIRED"
    },
    deliveries
  };
}
