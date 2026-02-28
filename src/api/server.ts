import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { InMemoryRecoveryStore } from "../services/recoveryStore";
import { ProviderNotifier } from "../services/notifier";
import { RecoveryRuntime } from "../services/recoveryRuntime";
import { appBaseUrl, appPort, env } from "../config/env";
import { exchangeCodeForToken, verifyOAuthHmac } from "../services/shopifyOAuth";
import { listShops, saveShopToken } from "../services/shopTokenStore";
import { readSettings, writeSettings } from "../services/settingsStore";
import { verifyRecoveryLink } from "../services/signedLink";

const app = express();
app.set("trust proxy", true);
app.use(express.json());

const distDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  app.use("/app", express.static(distDir));
}

const store = new InMemoryRecoveryStore();
const runtime = new RecoveryRuntime(
  store,
  new ProviderNotifier(() => readSettings()),
  () => readSettings().retryMinutes
);
const issuedOAuthStates = new Map<string, number>();

const paymentInfoSchema = z.object({
  checkoutToken: z.string().min(1),
  shopDomain: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  amountSubtotal: z.number().nonnegative().optional(),
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

const settingsSchema = z.object({
  brandName: z.string().min(1).optional(),
  supportEmail: z.string().email().optional(),
  accentColor: z.string().min(4).optional(),
  sendEmail: z.boolean().optional(),
  sendSms: z.boolean().optional(),
  retryMinutes: z.array(z.number().int().positive()).min(1).optional()
});

app.get("/", (_req, res) => {
  return res.status(200).json({ ok: true, service: "failed-payment-recovery" });
});

app.get("/health", (_req, res) => {
  return res.status(200).json({ ok: true });
});

app.get("/app", (_req, res) => {
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    return res.status(404).send("Frontend build not found. Run npm run build.");
  }
  return res.sendFile(path.join(distDir, "index.html"));
});

app.get("/recover/:token", (req, res) => {
  const payload = verifyRecoveryLink(
    req.params.token,
    env.RECOVERY_LINK_SECRET || "dev-recovery-link-secret"
  );
  if (!payload) {
    return res.status(401).send("Recovery link is invalid or expired.");
  }

  const checkoutUrl = `https://${payload.shopDomain}/cart`;
  return res.redirect(checkoutUrl);
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

app.get("/dashboard", (_req, res) => {
  const metrics = runtime.metrics();
  const settings = readSettings();
  const sessions = runtime.recent(8);
  const recoveryRate = metrics.detected ? Number(((metrics.recovered / metrics.detected) * 100).toFixed(1)) : 0;

  return res.status(200).json({
    metrics: {
      ...metrics,
      recoveryRate
    },
    settings,
    sessions
  });
});

app.get("/settings", (_req, res) => {
  return res.status(200).json(readSettings());
});

app.post("/settings", (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  return res.status(200).json(writeSettings(parsed.data));
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
