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
import { readSettings } from "../services/settingsStore";
import { verifyRecoveryLink } from "../services/signedLink";
import { getActiveCampaign } from "../services/campaignStore";
import {
  getCurrentCampaign,
  listRecoveryCampaigns,
  saveRecoveryCampaign,
  updateRecoveryCampaignStatus
} from "../services/db/campaignRepository";
import { listShopTokens, upsertShopToken } from "../services/db/shopRepository";
import { readAppSettings, writeAppSettings } from "../services/db/settingsRepository";

const app = express();
app.set("trust proxy", true);
app.use(express.json());

const distDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  app.use("/assets", express.static(path.join(distDir, "assets")));
}

const store = new InMemoryRecoveryStore();
const runtime = new RecoveryRuntime(
  store,
  new ProviderNotifier(() => readSettings(), () => getActiveCampaign()),
  () => getActiveCampaign().steps.map((step) => step.delayMinutes),
  () => getActiveCampaign()
);
const issuedOAuthStates = new Map<string, number>();

const paymentInfoSchema = z.object({
  checkoutToken: z.string().min(1),
  shopDomain: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  amountSubtotal: z.number().nonnegative().optional(),
  countryCode: z.string().length(2).optional(),
  customerSegment: z.enum(["all", "new", "returning", "vip"]).optional(),
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

const campaignSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  status: z.enum(["ACTIVE", "DRAFT", "PAUSED"]),
  priority: z.number().int().positive(),
  isDefault: z.boolean(),
  rules: z.object({
    minimumOrderValue: z.number().nonnegative(),
    customerSegment: z.enum(["all", "new", "returning", "vip"]),
    includeCountries: z.array(z.string().length(2)),
    quietHoursStart: z.number().int().min(0).max(23),
    quietHoursEnd: z.number().int().min(0).max(23)
  }),
  steps: z.array(
    z.object({
      id: z.string(),
      delayMinutes: z.number().int().positive(),
      channel: z.enum(["email", "sms"]),
      tone: z.enum(["steady", "urgent", "concierge", "rescue"]),
      stopIfPurchased: z.boolean()
    })
  ).min(1),
  theme: z.object({
    headline: z.string().min(1),
    body: z.string().min(1),
    sms: z.string().min(1)
  })
});

app.get("/status", (_req, res) => {
  return res.status(200).json({ ok: true, service: "failed-payment-recovery" });
});

app.get("/health", (_req, res) => {
  return res.status(200).json({ ok: true });
});

function applyEmbeddedHeaders(req: express.Request, res: express.Response): void {
  const shop = (req.query.shop as string | undefined) || env.SHOP_DOMAIN;
  const ancestors = ["https://admin.shopify.com"];
  if (shop) ancestors.push(`https://${shop}`);
  res.setHeader("Content-Security-Policy", `frame-ancestors ${ancestors.join(" ")};`);
}

function renderAppShell(req: express.Request, res: express.Response, embedded = false) {
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    return res.status(404).send("Frontend build not found. Run npm run build.");
  }

  applyEmbeddedHeaders(req, res);
  const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  const appConfig = {
    shopifyApiKey: env.SHOPIFY_API_KEY || "",
    shop: (req.query.shop as string | undefined) || env.SHOP_DOMAIN || "",
    host: (req.query.host as string | undefined) || "",
    embedded: embedded || Boolean(req.query.embedded) || Boolean(req.query.host)
  };
  const injected = html.replace(
    "</head>",
    `<script>window.__APP_CONFIG__ = ${JSON.stringify(appConfig)};</script></head>`
  );
  return res.status(200).type("html").send(injected);
}

app.get("/", (req, res, next) => {
  if ((req.headers.accept || "").includes("text/html") || req.query.embedded || req.query.shop || req.query.host) {
    return renderAppShell(req, res, true);
  }
  return next();
});

app.get("/app", (req, res) => {
  return renderAppShell(req, res, false);
});

app.get("/embedded", (req, res) => {
  return renderAppShell(req, res, true);
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
      return upsertShopToken({
        shop,
        accessToken: token.access_token,
        scope: token.scope,
        updatedAt: new Date().toISOString()
      }).then(() => {
        const host = req.query.host as string | undefined;
        if (env.SHOPIFY_API_KEY) {
          const redirectUrl = new URL(`https://${shop}/admin/apps/${env.SHOPIFY_API_KEY}`);
          if (host) redirectUrl.searchParams.set("host", host);
          redirectUrl.searchParams.set("shop", shop);
          return res.redirect(302, redirectUrl.toString());
        }
        return res.redirect(302, `/embedded?shop=${encodeURIComponent(shop)}${host ? `&host=${encodeURIComponent(host)}` : ""}`);
      });
    })
    .catch((error) => {
      console.error(error);
      res.status(500).send("OAuth token exchange failed.");
    });
});

app.get("/auth/shops", async (_req, res) => {
  return res.status(200).json({ shops: await listShopTokens() });
});

app.get("/platform", async (_req, res) => {
  const metrics = runtime.metrics();
  const settings = await readAppSettings();
  const campaigns = await listRecoveryCampaigns();
  const sessions = runtime.recent(12);
  const recoveryRate = metrics.detected ? Number(((metrics.recovered / metrics.detected) * 100).toFixed(1)) : 0;
  const channelMix = campaigns
    .flatMap((campaign) => campaign.steps)
    .reduce(
      (acc, step) => {
        acc[step.channel] += 1;
        return acc;
      },
      { email: 0, sms: 0 }
    );

  return res.status(200).json({
    commandCenter: {
      ...metrics,
      recoveryRate
    },
    settings,
    campaigns,
    sessions,
    insights: {
      activeCampaign: (await getCurrentCampaign()).name,
      channelMix,
      highestPriorityCampaign: campaigns[0]?.name || null,
      countriesCovered: Array.from(
        new Set(campaigns.flatMap((campaign) => campaign.rules.includeCountries))
      )
    }
  });
});

app.get("/dashboard", (_req, res) => {
  return res.redirect(302, "/platform");
});

app.get("/settings", async (_req, res) => {
  return res.status(200).json(await readAppSettings());
});

app.post("/settings", async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  return res.status(200).json(await writeAppSettings(parsed.data));
});

app.get("/campaigns", async (_req, res) => {
  const campaigns = await listRecoveryCampaigns();
  return res.status(200).json({ campaigns, activeCampaignId: (await getCurrentCampaign()).id });
});

app.post("/campaigns", async (req, res) => {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  return res.status(200).json(await saveRecoveryCampaign(parsed.data));
});

app.post("/campaigns/:id/status", async (req, res) => {
  const status = req.body?.status;
  if (!status || !["ACTIVE", "DRAFT", "PAUSED"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const updated = await updateRecoveryCampaignStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: "Campaign not found" });
  return res.status(200).json(updated);
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
