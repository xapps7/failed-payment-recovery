import type { RecoverySession } from "../domain/types";
import { emailHtml, smsText } from "./messageTemplates";
import type { AppSettings } from "./settingsStore";
import { signRecoveryLink } from "./signedLink";
import { appBaseUrl, env } from "../config/env";
import type { RecoveryCampaign } from "./campaignStore";
import type { DeliveryResult, MessageSender } from "../workers/recoveryWorker";
import { getOrCreateRecoveryOffer } from "./recoveryOfferStore";

function discountLabel(campaign: RecoveryCampaign, attemptNumber: number): string | null {
  const trigger = campaign.experience.discountAfterAttempt;
  if (!trigger || attemptNumber < trigger) return null;
  if (campaign.experience.discountType === "fixed") return `$${campaign.experience.discountValue} off`;
  return `${campaign.experience.discountValue}% off`;
}

function paymentMethodHint(paymentMethod?: string): string | undefined {
  if (!paymentMethod) return undefined;
  const normalized = paymentMethod.toLowerCase();
  if (normalized.includes("shop")) return "Try re-authorizing with Shop Pay or switch to card if it fails again.";
  if (normalized.includes("paypal")) return "If PayPal failed, retry PayPal or complete checkout with card.";
  if (normalized.includes("card")) return "If your card was declined, retry the same card or choose another payment method.";
  return `You can retry using ${paymentMethod} or choose another payment method at checkout.`;
}

function buildRetryUrl(session: RecoverySession, campaign: RecoveryCampaign, settings: AppSettings): string {
  const incentive = discountLabel(campaign, session.attemptCount + 1);
  const offer = incentive
    ? getOrCreateRecoveryOffer({
        checkoutToken: session.checkoutToken,
        shopDomain: session.shopDomain,
        type: campaign.experience.discountType,
        value: campaign.experience.discountValue
      })
    : null;

  const token = signRecoveryLink(
    {
      checkoutToken: session.checkoutToken,
      shopDomain: session.shopDomain,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
      destination: campaign.experience.destination,
      supportEmail: settings.supportEmail,
      discountText: offer ? `${incentive} with code ${offer.code}` : incentive || undefined
    },
    env.RECOVERY_LINK_SECRET || "dev-recovery-link-secret"
  );

  return `${appBaseUrl()}/recover/${token}`;
}

function buildOpenTrackingUrl(session: RecoverySession): string {
  const url = new URL(`${appBaseUrl()}/track/open.gif`);
  url.searchParams.set("checkoutToken", session.checkoutToken);
  url.searchParams.set("shopDomain", session.shopDomain);
  return url.toString();
}

function fallback(provider: string, channel: "email" | "sms", target: string, retryUrl: string): DeliveryResult {
  console.log(`[${channel}:fallback:${provider}] ${target} -> ${retryUrl}`);
  return {
    channel,
    provider,
    status: "fallback_logged",
    sent: true,
    payload: { target, retryUrl }
  };
}

export interface Notifier extends MessageSender {}

export class ProviderNotifier implements Notifier {
  constructor(
    private readonly settings: () => Promise<AppSettings> | AppSettings,
    private readonly activeCampaign: () => Promise<RecoveryCampaign> | RecoveryCampaign
  ) {}

  async sendEmail(session: RecoverySession): Promise<DeliveryResult> {
    const settings = await Promise.resolve(this.settings());
    const campaign = await Promise.resolve(this.activeCampaign());
    if (!settings.sendEmail || !session.email) {
      return { channel: "email", provider: "sendgrid", status: "skipped", sent: false };
    }

    const retryUrl = buildRetryUrl(session, campaign, settings);
    const openTrackingUrl = buildOpenTrackingUrl(session);
    const activeStep = campaign.steps[Math.min(session.attemptCount, campaign.steps.length - 1)];
    const incentive = discountLabel(campaign, session.attemptCount + 1);
    const paymentHint = paymentMethodHint(session.paymentMethod);
    const supportNote =
      campaign.experience.allowAgentEscalation &&
      campaign.experience.directContactAfterAttempt &&
      session.attemptCount + 1 >= campaign.experience.directContactAfterAttempt
        ? `Reply to this email or contact ${settings.supportEmail} for direct help with this payment issue.`
        : undefined;

    if (env.SENDGRID_API_KEY && env.SENDGRID_FROM_EMAIL) {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: session.email }] }],
          custom_args: {
            checkoutToken: session.checkoutToken,
            shopDomain: session.shopDomain
          },
          from: { email: env.SENDGRID_FROM_EMAIL, name: settings.brandName },
          subject: campaign.theme.headline,
          content: [{
            type: "text/html",
            value: emailHtml({
              shopName: settings.brandName,
              retryUrl,
              openTrackingUrl,
              headline: campaign.theme.headline,
              body: [campaign.theme.body, paymentHint].filter(Boolean).join(" "),
              tone: activeStep?.tone,
              incentive,
              supportNote
            })
          }]
        })
      });
      if (!response.ok) {
        throw new Error(`SendGrid send failed (${response.status})`);
      }
      return {
        channel: "email",
        provider: "sendgrid",
        status: "sent",
        sent: true,
        providerMessageId: response.headers.get("x-message-id") || undefined,
        payload: { email: session.email, retryUrl, incentive }
      };
    }

    return fallback("sendgrid", "email", session.email, retryUrl);
  }

  async sendSms(session: RecoverySession): Promise<DeliveryResult> {
    const settings = await Promise.resolve(this.settings());
    const campaign = await Promise.resolve(this.activeCampaign());
    if (!settings.sendSms || !session.phone) {
      return { channel: "sms", provider: "twilio", status: "skipped", sent: false };
    }

    const retryUrl = buildRetryUrl(session, campaign, settings);
    const activeStep = campaign.steps[Math.min(session.attemptCount, campaign.steps.length - 1)];
    const incentive = discountLabel(campaign, session.attemptCount + 1);
    const paymentHint = paymentMethodHint(session.paymentMethod);
    const supportNote =
      campaign.experience.allowAgentEscalation &&
      campaign.experience.directContactAfterAttempt &&
      session.attemptCount + 1 >= campaign.experience.directContactAfterAttempt
        ? `Need help? ${settings.supportEmail}`
        : undefined;

    if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) {
      const body = new URLSearchParams({
        To: session.phone,
        From: env.TWILIO_FROM_NUMBER,
        StatusCallback: `${appBaseUrl()}/webhooks/twilio/status?checkoutToken=${encodeURIComponent(session.checkoutToken)}&shopDomain=${encodeURIComponent(session.shopDomain)}`,
        Body: smsText({
          shopName: settings.brandName,
          retryUrl,
          smsBody: [campaign.theme.sms, paymentHint].filter(Boolean).join(" "),
          tone: activeStep?.tone,
          incentive,
          supportNote
        })
      });

      const basicAuth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body
        }
      );
      if (!response.ok) {
        throw new Error(`Twilio send failed (${response.status})`);
      }
      const responseJson = (await response.json()) as { sid?: string };
      return {
        channel: "sms",
        provider: "twilio",
        status: "sent",
        sent: true,
        providerMessageId: responseJson.sid,
        payload: { phone: session.phone, retryUrl, incentive }
      };
    }

    return fallback("twilio", "sms", session.phone, retryUrl);
  }
}
