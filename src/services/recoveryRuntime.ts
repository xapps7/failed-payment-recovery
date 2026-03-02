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
    private readonly getActiveCampaign?: () => Promise<RecoveryCampaign> | RecoveryCampaign
  ) {}

  async ingestSignal(signal: CheckoutSignal, nowIso: string): Promise<void> {
    const failed = inferLikelyFailedPayment(signal, nowIso);
    if (!failed) return;

    const campaign = this.getActiveCampaign ? await Promise.resolve(this.getActiveCampaign()) : undefined;
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
      if (
        campaign.rules.paymentMethods.length > 0 &&
        signal.paymentMethod &&
        !campaign.rules.paymentMethods.includes(signal.paymentMethod)
      ) {
        return;
      }
    }

    await this.store.upsertFailedSession({
      campaignId: campaign?.id,
      checkoutToken: signal.checkoutToken,
      shopDomain: signal.shopDomain,
      email: signal.email,
      phone: signal.phone,
      amountSubtotal: signal.amountSubtotal,
      countryCode: signal.countryCode,
      customerSegment: signal.customerSegment,
      paymentMethod: signal.paymentMethod,
      failedAt: nowIso
    });
  }

  async markCheckoutRecovered(checkoutToken: string, orderId: string, shopDomain?: string): Promise<void> {
    await this.store.markRecovered(checkoutToken, orderId, shopDomain);
  }

  async unsubscribe(checkoutToken: string, shopDomain?: string): Promise<void> {
    await this.store.markUnsubscribed(checkoutToken, shopDomain);
  }

  async runDue(nowIso: string): Promise<number> {
    const due = await this.store.listDue(nowIso);
    const campaign = this.getActiveCampaign ? await Promise.resolve(this.getActiveCampaign()) : undefined;

    for (const session of due) {
      const retryMinutes = campaign
        ? campaign.steps.map((step) => step.delayMinutes)
        : this.getRetryMinutes();
      const activeStep = campaign?.steps[Math.min(session.attemptCount, campaign.steps.length - 1)];
      const result = await processRecoveryAttempt(session, nowIso, {
        sendEmail: (s) => this.notifier.sendEmail(s),
        sendSms: (s) => this.notifier.sendSms(s)
      }, {
        maxAttempts: retryMinutes.length,
        minutesAfterFailure: retryMinutes
      }, activeStep);
      await this.store.update(result.session);
      for (const delivery of result.deliveries) {
        if (!delivery.sent) continue;
        await this.store.recordDeliveryAttempt({
          sessionId: result.session.id,
          channel: delivery.channel,
          provider: delivery.provider,
          status: delivery.status,
          payload: delivery.payload
        });
      }
    }

    return due.length;
  }

  async metrics() {
    return this.store.summary();
  }

  async recent(limit = 10) {
    return this.store.listRecent(limit);
  }
}
