import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { InMemoryRecoveryStore } from "../services/recoveryStore";
import { ConsoleNotifier } from "../services/notifier";
import { RecoveryRuntime } from "../services/recoveryRuntime";
import { appBaseUrl, appPort, env } from "../config/env";
import { exchangeCodeForToken, verifyOAuthHmac } from "../services/shopifyOAuth";
import { listShops, saveShopToken } from "../services/shopTokenStore";

const app = express();
app.set("trust proxy", true);
app.use(express.json());

const runtime = new RecoveryRuntime(new InMemoryRecoveryStore(), new ConsoleNotifier());
const issuedOAuthStates = new Map<string, number>();

const paymentInfoSchema = z.object({
  checkoutToken: z.string().min(1),
  shopDomain: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  paymentInfoSubmittedAt: z.string().datetime(),
  checkoutCompletedAt: z.string().datetime().optional()
});

const recoveredSchema = z.object({
  checkoutToken: z.string().min(1),
  orderId: z.string().min(1)
});

const unsubscribeSchema = z.object({
  checkoutToken: z.string().min(1)
});

app.get("/", (_req, res) => {
  return res.status(200).json({ ok: true, service: "failed-payment-recovery" });
});

app.get("/health", (_req, res) => {
  return res.status(200).json({ ok: true });
});

function buildInstallUrl(shop: string, baseUrl: string): string {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_SCOPES) {
    throw new Error("Missing SHOPIFY_API_KEY or SHOPIFY_SCOPES");
  }
  const state = crypto.randomBytes(16).toString("hex");
  issuedOAuthStates.set(state, Date.now());
  const redirectUri = `${baseUrl}/auth/callback`;
  const scopes = env.SHOPIFY_SCOPES;
  const query = new URLSearchParams({
    client_id: env.SHOPIFY_API_KEY,
    scope: scopes,
    redirect_uri: redirectUri,
    state
  });

  return `https://${shop}/admin/oauth/authorize?${query.toString()}`;
}

app.get("/auth/start", (req, res) => {
  const shop = (req.query.shop as string | undefined) || env.SHOP_DOMAIN;
  if (!shop) return res.status(400).json({ error: "Missing shop parameter" });
  const protocol = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("host");
  const baseUrl = host ? `${protocol}://${host}` : appBaseUrl();
  try {
    return res.status(200).json({ installUrl: buildInstallUrl(shop, baseUrl) });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/auth/callback", (req, res) => {
  const shop = req.query.shop as string | undefined;
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  if (!shop || !code || !state) {
    return res.status(400).send("Invalid callback payload");
  }

  const url = new URL(req.originalUrl, appBaseUrl());
  if (!verifyOAuthHmac(url.searchParams)) {
    return res.status(401).send("Invalid OAuth signature");
  }
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) {
    return res.status(500).send("Missing SHOPIFY API credentials");
  }
  const issuedAt = issuedOAuthStates.get(state);
  if (!issuedAt) {
    return res.status(401).send("Invalid OAuth state");
  }
  issuedOAuthStates.delete(state);

  exchangeCodeForToken(shop, code)
    .then((token) => {
      saveShopToken({
        shop,
        accessToken: token.access_token,
        scope: token.scope,
        updatedAt: new Date().toISOString()
      });
      res.status(200).send("App installed successfully. OAuth token stored.");
    })
    .catch((error) => {
      console.error(error);
      res.status(500).send("OAuth token exchange failed.");
    });
});

app.get("/auth/shops", (_req, res) => {
  return res.status(200).json({ shops: listShops() });
});

app.post("/events/payment-info-submitted", (req, res) => {
  const parsed = paymentInfoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  runtime.ingestSignal(parsed.data, new Date().toISOString());
  return res.status(202).json({ ok: true });
});

app.post("/events/checkout-completed", (req, res) => {
  const parsed = recoveredSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  runtime.markCheckoutRecovered(parsed.data.checkoutToken, parsed.data.orderId);
  return res.status(202).json({ ok: true });
});

app.post("/unsubscribe", (req, res) => {
  const parsed = unsubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  runtime.unsubscribe(parsed.data.checkoutToken);
  return res.status(202).json({ ok: true });
});

app.post("/jobs/run-due", async (_req, res) => {
  const processed = await runtime.runDue(new Date().toISOString());
  return res.status(200).json({ ok: true, processed });
});

app.get("/metrics", (_req, res) => {
  return res.status(200).json(runtime.metrics());
});

const port = appPort();
app.listen(port, () => {
  console.log(`Recovery API listening on http://127.0.0.1:${port}`);
});
