import { getShopAdminToken, postAdminGraphql } from "./shopifyAdminApi";

export interface ShopifyCustomerInsight {
  historicalOrderCount: number;
  historicalSpendAmount: number;
  currencyCode?: string;
}

interface CustomerInsightResponse {
  data?: {
    customers?: {
      nodes?: Array<{
        numberOfOrders?: number;
        amountSpent?: {
          amount?: string;
          currencyCode?: string;
        };
      }>;
    };
  };
}

export async function getShopifyCustomerInsight(
  shopDomain: string,
  email?: string
): Promise<ShopifyCustomerInsight | null> {
  if (!email) return null;

  const token = await getShopAdminToken(shopDomain);
  if (!token) return null;

  try {
    const result = await postAdminGraphql<CustomerInsightResponse>(
      shopDomain,
      token,
      `
        query RecoveryCustomerInsight($query: String!) {
          customers(first: 1, query: $query) {
            nodes {
              numberOfOrders
              amountSpent {
                amount
                currencyCode
              }
            }
          }
        }
      `,
      { query: `email:${email}` }
    );

    const customer = result.data?.customers?.nodes?.[0];
    if (!customer) return null;

    return {
      historicalOrderCount: Number(customer.numberOfOrders || 0),
      historicalSpendAmount: Number(customer.amountSpent?.amount || 0),
      currencyCode: customer.amountSpent?.currencyCode
    };
  } catch {
    return null;
  }
}
