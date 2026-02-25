import crypto from "node:crypto";
import { env } from "../config/env";

interface ExchangeResponse {
  access_token: string;
  scope: string;
}

function canonicalQuery(params: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  params.forEach((value, key) => {
    if (key === "hmac" || key === "signature") return;
    pairs.push([key, value]);
  });

  pairs.sort(([a], [b]) => a.localeCompare(b));
  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
}

export function verifyOAuthHmac(search: URLSearchParams): boolean {
  if (!env.SHOPIFY_API_SECRET) return false;
  const hmac = search.get("hmac");
  if (!hmac) return false;

  const message = canonicalQuery(search);
  const digest = crypto
    .createHmac("sha256", env.SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");

  if (hmac.length !== digest.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hmac, "utf8"), Buffer.from(digest, "utf8"));
}

export async function exchangeCodeForToken(shop: string, code: string): Promise<ExchangeResponse> {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) {
    throw new Error("Missing SHOPIFY API credentials");
  }
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      code
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  return (await response.json()) as ExchangeResponse;
}
