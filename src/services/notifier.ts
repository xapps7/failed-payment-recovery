import type { RecoverySession } from "../domain/types";
import { emailHtml, smsText } from "./messageTemplates";
import type { AppSettings } from "./settingsStore";
import { signRecoveryLink } from "./signedLink";
import { appBaseUrl, env } from "../config/env";
import type { RecoveryCampaign } from "./campaignStore";

export interface Notifier {
  sendEmail(session: RecoverySession): Promise<void>;
  sendSms(session: RecoverySession): Promise<void>;
}

function buildRetryUrl(session: RecoverySession): string {
  const token = signRecoveryLink(
    {
      checkoutToken: session.checkoutToken,
      shopDomain: session.shopDomain,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString()
    },
    env.RECOVERY_LINK_SECRET || "dev-recovery-link-secret"
  );
  return `${appBaseUrl()}/recover/${token}`;
}

export class ProviderNotifier implements Notifier {
  constructor(
    private readonly settings: () => AppSettings,
    private readonly activeCampaign: () => RecoveryCampaign
  ) {}

  async sendEmail(session: RecoverySession): Promise<void> {
    const settings = this.settings();
    const campaign = this.activeCampaign();
    if (!settings.sendEmail || !session.email) return;

    const retryUrl = buildRetryUrl(session);
    const activeStep = campaign.steps[Math.min(session.attemptCount, campaign.steps.length - 1)];
    if (env.SENDGRID_API_KEY && env.SENDGRID_FROM_EMAIL) {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: session.email }] }],
          from: { email: env.SENDGRID_FROM_EMAIL, name: settings.brandName },
          subject: campaign.theme.headline,
          content: [{
            type: "text/html",
            value: emailHtml({
              shopName: settings.brandName,
              retryUrl,
              headline: campaign.theme.headline,
              body: campaign.theme.body,
              tone: activeStep?.tone
            })
          }]
        })
      });
      if (!response.ok) {
        throw new Error(`SendGrid send failed (${response.status})`);
      }
      return;
    }

    console.log(`[email:fallback] ${session.email} -> ${retryUrl}`);
  }

  async sendSms(session: RecoverySession): Promise<void> {
    const settings = this.settings();
    const campaign = this.activeCampaign();
    if (!settings.sendSms || !session.phone) return;

    const retryUrl = buildRetryUrl(session);
    const activeStep = campaign.steps[Math.min(session.attemptCount, campaign.steps.length - 1)];
    if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) {
      const body = new URLSearchParams({
        To: session.phone,
        From: env.TWILIO_FROM_NUMBER,
        Body: smsText({
          shopName: settings.brandName,
          retryUrl,
          smsBody: campaign.theme.sms,
          tone: activeStep?.tone
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
      return;
    }

    console.log(`[sms:fallback] ${session.phone} -> ${retryUrl}`);
  }
}
