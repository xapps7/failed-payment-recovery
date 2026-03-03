import type { RecoveryCampaign } from "./campaignStore";

export type DraftMode = "urgent" | "concierge" | "concise";

export function buildDraftTheme(campaign: RecoveryCampaign, mode: DraftMode): RecoveryCampaign["theme"] {
  const brand = campaign.name || "your order";

  switch (mode) {
    case "urgent":
      return {
        headline: `Finish your ${brand} checkout before it expires`,
        body: "Your payment did not complete. We saved the order, but availability can change quickly. Return now and finish checkout with the fastest available payment option.",
        sms: "Your payment did not complete. Your order is still open for a short time. Return now and try another payment option."
      };
    case "concierge":
      return {
        headline: `Need help completing ${brand}?`,
        body: "We saved your order and can help you complete payment. Return to checkout, or contact the merchant directly if you want a guided completion path.",
        sms: "We saved your order. Return to checkout now, or contact the merchant if you want direct payment help."
      };
    case "concise":
      return {
        headline: `Complete your purchase`,
        body: "Your payment did not complete. Return now to finish checkout.",
        sms: "Your payment did not complete. Return now to finish checkout."
      };
    default:
      return campaign.theme;
  }
}
