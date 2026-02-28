import type { CheckoutSignal } from "../domain/types";
import { inferLikelyFailedPayment } from "../domain/recoveryEngine";
import type { Notifier } from "./notifier";
import type { RecoveryStore } from "./recoveryStore";
import { processRecoveryAttempt } from "../workers/recoveryWorker";
import type { RecoveryCampaign } from "./campaignStore";

export class RecoveryRuntime {
  constructor(
    private readonly store: RecoveryStore,
    private readonly notifier: Notifier,
    private readonly getRetryMinutes: () => number[] = () => [15, 360, 1440],
    private readonly getActiveCampaign?: () => RecoveryCampaign
  ) {}

  ingestSignal(signal: CheckoutSignal, nowIso: string): void {
    const failed = inferLikelyFailedPayment(signal, nowIso);
    if (!failed) return;

    const campaign = this.getActiveCampaign?.();
    if (campaign) {
      if ((signal.amountSubtotal || 0) < campaign.rules.minimumOrderValue) return;
      if (
        campaign.rules.includeCountries.length > 0 &&
        signal.countryCode &&
        !campaign.rules.includeCountries.includes(signal.countryCode)
      ) {
        return;
      }
      if (
        campaign.rules.customerSegment !== "all" &&
        signal.customerSegment &&
        signal.customerSegment !== campaign.rules.customerSegment
      ) {
        return;
      }
    }

    this.store.upsertFailedSession({
      checkoutToken: signal.checkoutToken,
      shopDomain: signal.shopDomain,
      email: signal.email,
      phone: signal.phone,
      amountSubtotal: signal.amountSubtotal,
      countryCode: signal.countryCode,
      customerSegment: signal.customerSegment,
      failedAt: nowIso
    });
  }

  markCheckoutRecovered(checkoutToken: string, orderId: string): void {
    this.store.markRecovered(checkoutToken, orderId);
  }

  unsubscribe(checkoutToken: string): void {
    this.store.markUnsubscribed(checkoutToken);
  }

  async runDue(nowIso: string): Promise<number> {
    const due = this.store.listDue(nowIso);

    for (const session of due) {
      const retryMinutes = this.getRetryMinutes();
      const updated = await processRecoveryAttempt(session, nowIso, {
        sendEmail: (s) => this.notifier.sendEmail(s),
        sendSms: (s) => this.notifier.sendSms(s)
      }, {
        maxAttempts: retryMinutes.length,
        minutesAfterFailure: retryMinutes
      });
      this.store.update(updated);
    }

    return due.length;
  }

  metrics() {
    return this.store.summary();
  }

  recent(limit = 10) {
    return this.store.listRecent(limit);
  }
}
