import { findShopToken } from "./db/shopRepository";
import type { RecoveryOffer } from "./recoveryOfferStore";

export async function createShopifyDiscountCode(
  shopDomain: string,
  offer: RecoveryOffer
): Promise<{ created: boolean; reason?: string }> {
  const token = await findShopToken(shopDomain);
  if (!token?.accessToken) {
    return { created: false, reason: "Missing shop access token" };
  }

  const startAt = new Date().toISOString();
  const endAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

  const priceRuleResponse = await fetch(`https://${shopDomain}/admin/api/2024-10/price_rules.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token.accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      price_rule: {
        title: offer.code,
        target_type: "line_item",
        target_selection: "all",
        allocation_method: "across",
        value_type: offer.type === "percentage" ? "percentage" : "fixed_amount",
        value: `${offer.type === "percentage" ? -offer.value : -offer.value}`,
        customer_selection: "all",
        starts_at: startAt,
        ends_at: endAt,
        usage_limit: 1
      }
    })
  });

  if (!priceRuleResponse.ok) {
    return { created: false, reason: `Price rule failed (${priceRuleResponse.status})` };
  }

  const priceRuleJson = (await priceRuleResponse.json()) as { price_rule?: { id?: number } };
  const priceRuleId = priceRuleJson.price_rule?.id;
  if (!priceRuleId) {
    return { created: false, reason: "Missing price rule id" };
  }

  const codeResponse = await fetch(`https://${shopDomain}/admin/api/2024-10/price_rules/${priceRuleId}/discount_codes.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token.accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      discount_code: {
        code: offer.code
      }
    })
  });

  if (!codeResponse.ok) {
    return { created: false, reason: `Discount code failed (${codeResponse.status})` };
  }

  return { created: true };
}
