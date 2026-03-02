import { findShopToken } from "./db/shopRepository";

export async function getShopAdminToken(shopDomain: string): Promise<string | null> {
  const token = await findShopToken(shopDomain);
  return token?.accessToken || null;
}

export async function postAdminGraphql<T>(
  shopDomain: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`https://${shopDomain}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`Admin GraphQL failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export async function postAdminRest<T>(
  shopDomain: string,
  token: string,
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; json?: T }> {
  const response = await fetch(`https://${shopDomain}/admin/api/2024-10/${endpoint}`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const json = response.ok ? ((await response.json()) as T) : undefined;
  return { ok: response.ok, status: response.status, json };
}
