import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const envSchema = z.object({
  SHOPIFY_API_KEY: z.string().min(1).optional(),
  SHOPIFY_API_SECRET: z.string().min(1).optional(),
  SHOPIFY_APP_URL: z.string().url().optional(),
  SHOPIFY_SCOPES: z.string().min(1).optional(),
  SHOP_DOMAIN: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  DIRECT_DATABASE_URL: z.string().min(1).optional(),
  SENDGRID_API_KEY: z.string().min(1).optional(),
  SENDGRID_FROM_EMAIL: z.string().email().optional(),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_FROM_NUMBER: z.string().min(1).optional(),
  RECOVERY_LINK_SECRET: z.string().min(16).optional(),
  DUE_JOB_INTERVAL_SECONDS: z.string().optional(),
  PORT: z.string().optional()
});

export const env = envSchema.parse(process.env);

const requiredShopifyScopes = [
  "read_orders",
  "read_customers",
  "read_discounts",
  "write_discounts",
  "read_pixels",
  "write_pixels",
  "read_customer_events"
];

export function shopifyScopes(): string {
  const requested = (env.SHOPIFY_SCOPES || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  return Array.from(new Set([...requested, ...requiredShopifyScopes])).join(",");
}

export function appBaseUrl(): string {
  return (env.SHOPIFY_APP_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
}

export function appPort(): number {
  return Number(env.PORT || 8080);
}
