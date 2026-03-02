import type { RecoveryOffer } from "./recoveryOfferStore";
import { getShopAdminToken, postAdminGraphql, postAdminRest } from "./shopifyAdminApi";

export async function createShopifyDiscountCode(
  shopDomain: string,
  offer: RecoveryOffer
): Promise<{ created: boolean; reason?: string }> {
  const accessToken = await getShopAdminToken(shopDomain);
  if (!accessToken) {
    return { created: false, reason: "Missing shop access token" };
  }

  const startAt = new Date().toISOString();
  const endAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  const graphQlAttempt = await postAdminGraphql<{
    data?: {
      discountCodeBasicCreate?: {
        codeDiscountNode?: { id: string };
        userErrors?: Array<{ message: string }>;
      };
    };
  }>(
    shopDomain,
    accessToken,
    `
      mutation DiscountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode { id }
          userErrors { message }
        }
      }
    `,
    {
      basicCodeDiscount: {
        title: offer.code,
        code: offer.code,
        startsAt: startAt,
        endsAt: endAt,
        customerSelection: { all: true },
        customerGets: {
          items: { all: true },
          value:
            offer.type === "percentage"
              ? { percentage: Number((offer.value / 100).toFixed(2)) }
              : { discountAmount: { amount: offer.value, appliesOnEachItem: false } }
        },
        appliesOncePerCustomer: true,
        usageLimit: 1
      }
    }
  ).catch(() => null);

  const graphQlErrors = graphQlAttempt?.data?.discountCodeBasicCreate?.userErrors || [];
  if (graphQlAttempt?.data?.discountCodeBasicCreate?.codeDiscountNode?.id && graphQlErrors.length === 0) {
    return { created: true };
  }

  const priceRuleResponse = await postAdminRest<{ price_rule?: { id?: number } }>(
    shopDomain,
    accessToken,
    "price_rules.json",
    {
      price_rule: {
        title: offer.code,
        target_type: "line_item",
        target_selection: "all",
        allocation_method: "across",
        value_type: offer.type === "percentage" ? "percentage" : "fixed_amount",
        value: `${-offer.value}`,
        customer_selection: "all",
        starts_at: startAt,
        ends_at: endAt,
        usage_limit: 1
      }
    }
  );

  if (!priceRuleResponse.ok) {
    const message = graphQlErrors[0]?.message || `Price rule failed (${priceRuleResponse.status})`;
    return { created: false, reason: message };
  }

  const priceRuleJson = priceRuleResponse.json || {};
  const priceRuleId = priceRuleJson.price_rule?.id;
  if (!priceRuleId) {
    return { created: false, reason: "Missing price rule id" };
  }

  const codeResponse = await postAdminRest(
    shopDomain,
    accessToken,
    `price_rules/${priceRuleId}/discount_codes.json`,
    {
      discount_code: {
        code: offer.code
      }
    }
  );

  if (!codeResponse.ok) {
    return { created: false, reason: `Discount code failed (${codeResponse.status})` };
  }

  return { created: true };
}
