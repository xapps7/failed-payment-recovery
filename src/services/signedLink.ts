import crypto from "node:crypto";

interface SignedPayload {
  checkoutToken: string;
  shopDomain: string;
  expiresAt: string;
}

function b64url(input: Buffer): string {
  return input.toString("base64url");
}

export function signRecoveryLink(payload: SignedPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function verifyRecoveryLink(token: string, secret: string): SignedPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64url");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedPayload;
  if (new Date(payload.expiresAt).getTime() < Date.now()) return null;
  return payload;
}
