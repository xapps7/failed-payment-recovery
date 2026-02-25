import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const envSchema = z.object({
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_APP_URL: z.string().url(),
  SHOPIFY_SCOPES: z.string().min(1),
  SHOP_DOMAIN: z.string().min(1),
  PORT: z.string().optional()
});

export const env = envSchema.parse(process.env);

export function appBaseUrl(): string {
  return env.SHOPIFY_APP_URL.replace(/\/$/, "");
}

export function appPort(): number {
  return Number(env.PORT || 8080);
}
