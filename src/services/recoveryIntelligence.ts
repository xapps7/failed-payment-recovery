import type { RecoveryLineItem } from "./recoveryPayloadStore";

const currencyCountryMap: Record<string, string> = {
  USD: "US",
  CAD: "CA",
  GBP: "GB",
  EUR: "EU",
  AUD: "AU",
  NZD: "NZ",
  INR: "IN"
};

export function normalizeCountryCode(countryCode?: string, currencyCode?: string): string | undefined {
  if (countryCode && countryCode.trim().length === 2) {
    return countryCode.trim().toUpperCase();
  }
  if (currencyCode && currencyCountryMap[currencyCode.trim().toUpperCase()]) {
    return currencyCountryMap[currencyCode.trim().toUpperCase()];
  }
  return undefined;
}

export function normalizePaymentMethod(paymentMethod?: string, paymentFailureLabel?: string): string | undefined {
  const raw = `${paymentMethod || ""} ${paymentFailureLabel || ""}`.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw.includes("shop")) return "shop_pay";
  if (raw.includes("paypal")) return "paypal";
  if (raw.includes("apple")) return "apple_pay";
  if (raw.includes("google")) return "google_pay";
  if (raw.includes("card") || raw.includes("visa") || raw.includes("mastercard") || raw.includes("amex")) {
    return "credit_card";
  }
  return paymentMethod?.trim().toLowerCase().replace(/\s+/g, "_") || undefined;
}

export function recommendedPaymentOptions(paymentMethod?: string): string[] {
  switch (paymentMethod) {
    case "credit_card":
      return ["Shop Pay", "PayPal"];
    case "shop_pay":
      return ["Credit card", "PayPal"];
    case "paypal":
      return ["Credit card", "Shop Pay"];
    case "apple_pay":
    case "google_pay":
      return ["Credit card", "Shop Pay"];
    default:
      return ["Credit card", "Shop Pay", "PayPal"];
  }
}

export function resolveRetryTarget(input: {
  shopDomain: string;
  destination: "checkout" | "cart" | "support";
  checkoutUrl?: string;
  cartUrl?: string;
  lineItems?: RecoveryLineItem[];
  discountText?: string;
}): { targetUrl?: string; strategy: string } {
  if (input.destination === "support") {
    return { strategy: "Support route" };
  }

  if (input.destination !== "cart" && input.checkoutUrl) {
    return { targetUrl: input.checkoutUrl, strategy: "Resumes checkout" };
  }

  if (input.cartUrl) {
    return { targetUrl: input.cartUrl, strategy: "Falls back to cart" };
  }

  if (input.lineItems?.length) {
    const items = input.lineItems.map((item) => `${item.variantId}:${item.quantity}`).join(",");
    const url = new URL(`https://${input.shopDomain}/cart/${items}`);
    if (input.discountText) {
      url.searchParams.set("discount_hint", input.discountText);
    }
    return { targetUrl: url.toString(), strategy: "Rebuilds cart from saved items" };
  }

  const destination = input.destination === "cart" ? "cart" : "checkout";
  return {
    targetUrl: `https://${input.shopDomain}/${destination}`,
    strategy: input.destination === "cart" ? "Falls back to cart" : "Checkout fallback"
  };
}
