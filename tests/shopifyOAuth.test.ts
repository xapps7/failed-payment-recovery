import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { env } from "../src/config/env";
import { verifyOAuthHmac } from "../src/services/shopifyOAuth";

function sign(params: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  params.forEach((value, key) => {
    if (key === "hmac" || key === "signature") return;
    pairs.push([key, value]);
  });
  pairs.sort(([a], [b]) => a.localeCompare(b));
  const msg = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  return crypto.createHmac("sha256", env.SHOPIFY_API_SECRET).update(msg).digest("hex");
}

describe("verifyOAuthHmac", () => {
  it("accepts a valid HMAC", () => {
    const params = new URLSearchParams({
      code: "abc",
      shop: "xappsdev.myshopify.com",
      state: "state123",
      timestamp: "1700000000"
    });
    params.set("hmac", sign(params));

    expect(verifyOAuthHmac(params)).toBe(true);
  });

  it("rejects an invalid HMAC", () => {
    const params = new URLSearchParams({
      code: "abc",
      shop: "xappsdev.myshopify.com",
      state: "state123",
      timestamp: "1700000000",
      hmac: "deadbeef"
    });

    expect(verifyOAuthHmac(params)).toBe(false);
  });
});
