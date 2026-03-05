import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { InMemoryRecoveryStore } from "../services/recoveryStore";
import { ProviderNotifier } from "../services/notifier";
import { RecoveryRuntime } from "../services/recoveryRuntime";
import { appBaseUrl, appPort, env, shopifyScopes } from "../config/env";
import { exchangeCodeForToken, verifyOAuthHmac } from "../services/shopifyOAuth";
import { verifyRecoveryLink } from "../services/signedLink";
import {
  getCurrentCampaign,
  listRecoveryCampaigns,
  saveRecoveryCampaign,
  updateRecoveryCampaignStatus
} from "../services/db/campaignRepository";
import { listShopTokens, upsertShopToken } from "../services/db/shopRepository";
import { readAppSettings, writeAppSettings } from "../services/db/settingsRepository";
import { getRecoveryPayload, saveRecoveryPayload } from "../services/recoveryPayloadStore";
import { getRecoveryOffer, getOrCreateRecoveryOffer } from "../services/recoveryOfferStore";
import { getOperatorAction, saveOperatorAction } from "../services/operatorActionStore";
import { recordProviderEvent } from "../services/providerEventStore";
import { getEngagement, recordClick, recordOpen } from "../services/engagementStore";
import { getDeliveryStatus, saveDeliveryStatus } from "../services/deliveryStatusStore";
import { createShopifyDiscountCode } from "../services/shopifyDiscountService";
import { activateShopifyWebPixel, getShopifyWebPixelStatus } from "../services/shopifyPixelService";
import {
  normalizeCountryCode,
  normalizePaymentMethod,
  recommendedPaymentOptions,
  resolveRetryTarget
} from "../services/recoveryIntelligence";
import { getDiscountSync, saveDiscountSync } from "../services/discountSyncStore";
import { buildDraftTheme, type DraftMode } from "../services/aiDraftService";
import { getShopifyCustomerInsight } from "../services/shopifyCustomerInsightService";
import { listPixelDebugEvents, recordPixelDebug } from "../services/pixelDebugStore";

const app = express();
app.set("trust proxy", true);
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  return next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const distDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  app.use("/assets", express.static(path.join(distDir, "assets")));
}

const store = new InMemoryRecoveryStore();
const runtime = new RecoveryRuntime(
  store,
  new ProviderNotifier(() => readAppSettings(), () => getCurrentCampaign()),
  async () => {
    const settings = await readAppSettings();
    return settings.retryMinutes.length ? settings.retryMinutes : [1, 360, 1440];
  },
  () => getCurrentCampaign()
);
const dueJobIntervalMs = Math.max(Number(env.DUE_JOB_INTERVAL_SECONDS || 60), 15) * 1000;
setInterval(() => {
  void runtime.runDue(new Date().toISOString()).catch((error) => {
    console.error("Automatic due-job run failed", error);
  });
}, dueJobIntervalMs).unref();
const issuedOAuthStates = new Map<string, number>();
const TRACKING_PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64"
);

const paymentInfoSchema = z.object({
  checkoutToken: z.string().min(1),
  shopDomain: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  amountSubtotal: z.number().nonnegative().optional(),
  countryCode: z.string().length(2).optional(),
  customerSegment: z.enum(["all", "new", "returning", "vip"]).optional(),
  paymentMethod: z.string().min(1).optional(),
  paymentFailureLabel: z.string().min(1).optional(),
  checkoutUrl: z.string().url().optional(),
  cartUrl: z.string().url().optional(),
  currencyCode: z.string().length(3).optional(),
  lineItems: z.array(
    z.object({
      variantId: z.string().min(1),
      quantity: z.number().int().positive(),
      title: z.string().optional()
    })
  ).optional(),
  paymentInfoSubmittedAt: z.string().datetime(),
  checkoutCompletedAt: z.string().datetime().optional()
});

const webPixelSchema = z.object({
  eventName: z.enum(["payment_info_submitted", "checkout_completed", "payment_page_viewed"]),
  payload: paymentInfoSchema.extend({
    orderId: z.string().optional()
  })
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

const manualOutreachSchema = z.object({
  action: z.enum(["mark_contacted", "escalate_support"]),
  shopDomain: z.string().min(1).optional()
});

const pixelActivationSchema = z.object({
  shopDomain: z.string().min(1).optional()
});

const devTestFailedSchema = z.object({
  shopDomain: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional()
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
    paymentMethods: z.array(z.string()),
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
  }),
  experience: z.object({
    destination: z.enum(["checkout", "cart", "support"]),
    discountAfterAttempt: z.number().int().positive().nullable(),
    discountType: z.enum(["percentage", "fixed"]),
    discountValue: z.number().nonnegative(),
    directContactAfterAttempt: z.number().int().positive().nullable(),
    allowAgentEscalation: z.boolean()
  })
});

const aiDraftSchema = z.object({
  mode: z.enum(["urgent", "concierge", "concise"]),
  campaign: campaignSchema
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

function buildConversionInsight(session: {
  state: string;
  amountSubtotal?: number;
  customerSegment?: string;
  paymentMethod?: string;
  attemptCount: number;
  engagement?: { opens: number; clicks: number };
  operatorAction?: { lastAction: string };
  deliveryStatus?: { emailStatus?: string; smsStatus?: string };
  customerInsight?: { historicalOrderCount: number; historicalSpendAmount: number };
}) {
  let score = 35;
  const reasons: string[] = [];

  if ((session.amountSubtotal || 0) >= 200) {
    score += 18;
    reasons.push("Higher order value");
  } else if ((session.amountSubtotal || 0) >= 75) {
    score += 10;
    reasons.push("Healthy order value");
  }

  if (session.customerSegment === "returning" || session.customerSegment === "vip") {
    score += 16;
    reasons.push("Repeat buyer behavior");
  }

  if ((session.customerInsight?.historicalOrderCount || 0) >= 3) {
    score += 12;
    reasons.push("Strong store purchase history");
  } else if ((session.customerInsight?.historicalOrderCount || 0) >= 1) {
    score += 6;
    reasons.push("Known customer in store");
  }

  if ((session.engagement?.opens || 0) > 0) {
    score += 12;
    reasons.push("Opened recovery message");
  }

  if ((session.engagement?.clicks || 0) > 0) {
    score += 18;
    reasons.push("Clicked retry link");
  }

  if (session.paymentMethod && session.paymentMethod !== "other") {
    score += 8;
    reasons.push("Recognized payment method");
  }

  if (session.deliveryStatus?.emailStatus === "delivered" || session.deliveryStatus?.smsStatus === "delivered") {
    score += 6;
    reasons.push("Message delivered");
  }

  if (session.operatorAction?.lastAction === "mark_contacted") {
    score += 6;
    reasons.push("Merchant outreach started");
  }

  if (session.attemptCount >= 2) {
    score -= 10;
    reasons.push("Multiple attempts already used");
  }

  if (session.state === "EXPIRED" || session.state === "UNSUBSCRIBED") {
    score -= 35;
    reasons.push("Recovery window is constrained");
  } else if (session.state === "RECOVERED") {
    score = 100;
    reasons.unshift("Already converted");
  }

  const normalized = Math.max(0, Math.min(100, Math.round(score)));
  const band = normalized >= 75 ? "High" : normalized >= 45 ? "Medium" : "Low";
  return {
    score: normalized,
    band,
    reasons: reasons.slice(0, 4)
  };
}

function buildRecoveryStage(session: {
  state: string;
  attemptCount: number;
  nextAttemptAt?: string;
}) {
  if (session.state === "RECOVERED") return "Recovered";
  if (session.state === "EXPIRED") return "Expired";
  if (session.state === "UNSUBSCRIBED") return "Suppressed";
  if (session.attemptCount === 0) return "Awaiting first retry";
  if (session.nextAttemptAt) return "Retry scheduled";
  return "Retry complete";
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

  recordClick(payload.checkoutToken, payload.shopDomain);

  if (payload.destination === "support" && payload.supportEmail) {
    const supportLink = `mailto:${payload.supportEmail}?subject=${encodeURIComponent("Payment recovery help")}&body=${encodeURIComponent(`Please help me complete checkout for ${payload.checkoutToken}.`)}`;
    return res.status(200).type("html").send(`<!doctype html><html><head><title>Need Help?</title><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;padding:24px;background:#f6f6f7;color:#202223;"><main style="max-width:560px;margin:32px auto;background:#fff;padding:24px;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.06);"><p style="margin:0 0 8px;color:#6d7175;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Retryly Support Assist</p><h1 style="margin:0 0 12px;font-size:28px;">A specialist can help complete this order.</h1><p style="margin:0 0 12px;line-height:1.6;">Your payment needs manual help. Contact the merchant directly and they can guide you through the fastest completion path.</p>${payload.discountText ? `<p style="margin:0 0 12px;line-height:1.6;"><strong>Offer available:</strong> ${payload.discountText}</p>` : ""}<p><a href="${supportLink}" style="display:inline-block;background:#008060;color:#fff;padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:600;">Contact support</a></p></main></body></html>`);
  }

  const recoveryPayload = getRecoveryPayload(payload.checkoutToken, payload.shopDomain);
  const retryResolution = resolveRetryTarget({
    shopDomain: payload.shopDomain,
    destination: payload.destination || "checkout",
    checkoutUrl: recoveryPayload?.checkoutUrl,
    cartUrl: recoveryPayload?.cartUrl,
    lineItems: recoveryPayload?.lineItems,
    discountText: payload.discountText
  });
  const targetUrl = retryResolution.targetUrl;
  if (!targetUrl) {
    return res.status(400).send("Retry target is unavailable.");
  }

  const alternatives = recommendedPaymentOptions(recoveryPayload?.paymentMethod || undefined);
  const suggestions = alternatives.map((option) => `<li style="margin:0 0 6px;">Try ${option}</li>`).join("");
  return res.status(200).type("html").send(`<!doctype html><html><head><title>Retry checkout</title><meta name="viewport" content="width=device-width, initial-scale=1" /><meta http-equiv="refresh" content="1;url=${targetUrl}" /></head><body style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;padding:24px;background:#f6f6f7;color:#202223;"><main style="max-width:560px;margin:32px auto;background:#fff;padding:24px;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.06);"><p style="margin:0 0 8px;color:#6d7175;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Retryly</p><h1 style="margin:0 0 12px;font-size:28px;">We saved your checkout.</h1><p style="margin:0 0 12px;line-height:1.6;">${retryResolution.strategy}. You can continue now, or try a different payment option if the last one failed.</p>${payload.discountText ? `<p style="margin:0 0 12px;line-height:1.6;"><strong>Offer available:</strong> ${payload.discountText}</p>` : ""}<ul style="padding-left:18px;margin:0 0 16px;line-height:1.6;">${suggestions}</ul><p><a href="${targetUrl}" style="display:inline-block;background:#008060;color:#fff;padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:600;">Continue to checkout</a></p></main></body></html>`);
});

function buildInstallUrl(shop: string, baseUrl: string): string {
  if (!env.SHOPIFY_API_KEY) {
    throw new Error("Missing SHOPIFY_API_KEY");
  }
  const state = crypto.randomBytes(16).toString("hex");
  issuedOAuthStates.set(state, Date.now());
  const redirectUri = `${baseUrl}/auth/callback`;
  const scopes = shopifyScopes();
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

app.get("/track/open.gif", (req, res) => {
  const checkoutToken = typeof req.query.checkoutToken === "string" ? req.query.checkoutToken : "";
  const shopDomain = typeof req.query.shopDomain === "string" ? req.query.shopDomain : "";
  if (checkoutToken && shopDomain) {
    recordOpen(checkoutToken, shopDomain);
  }

  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  return res.status(200).send(TRACKING_PIXEL_GIF);
});

app.get("/platform", async (_req, res) => {
  const metrics = await runtime.metrics();
  const settings = await readAppSettings();
  const campaigns = await listRecoveryCampaigns();
  const sessions = await runtime.recent(50);
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const activeCampaign = await getCurrentCampaign();
  const enrichedSessions = await Promise.all(sessions.map(async (session) => {
    const campaign = campaignById.get(session.campaignId || "") || activeCampaign;
    const operatorAction = getOperatorAction(session.checkoutToken, session.shopDomain);
    const offer = getRecoveryOffer(session.checkoutToken, session.shopDomain);
    const engagement = getEngagement(session.checkoutToken, session.shopDomain);
    const deliveryStatus = getDeliveryStatus(session.checkoutToken, session.shopDomain);
    const discountSync = getDiscountSync(session.checkoutToken, session.shopDomain);
    const customerInsight = await getShopifyCustomerInsight(session.shopDomain, session.email);
    const deliveryAttempts = await store.listDeliveryAttempts(session.id);
    const retryStrategy = resolveRetryTarget({
      shopDomain: session.shopDomain,
      destination: campaign.experience.destination,
      checkoutUrl: getRecoveryPayload(session.checkoutToken, session.shopDomain)?.checkoutUrl,
      cartUrl: getRecoveryPayload(session.checkoutToken, session.shopDomain)?.cartUrl,
      lineItems: getRecoveryPayload(session.checkoutToken, session.shopDomain)?.lineItems
    }).strategy;

    return {
      ...session,
      campaignName: session.campaignId ? (campaignById.get(session.campaignId)?.name || activeCampaign.name) : activeCampaign.name,
      operatorAction,
      offer,
      engagement,
      deliveryStatus,
      discountSync,
      customerInsight,
      recoveryStage: buildRecoveryStage(session),
      deliveryAttempts,
      retryStrategy,
      recommendedPaymentOptions: recommendedPaymentOptions(session.paymentMethod),
      conversionInsight: buildConversionInsight({
        state: session.state,
        amountSubtotal: session.amountSubtotal,
        customerSegment: session.customerSegment,
        paymentMethod: session.paymentMethod,
        attemptCount: session.attemptCount,
        engagement,
        operatorAction,
        deliveryStatus,
        customerInsight: customerInsight || undefined
      })
    };
  }));
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
    sessions: enrichedSessions,
    insights: {
      activeCampaign: activeCampaign.name,
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

app.post("/campaigns/ai-draft", async (req, res) => {
  const parsed = aiDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const theme = buildDraftTheme(parsed.data.campaign, parsed.data.mode as DraftMode);
  return res.status(200).json({ theme });
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

app.post("/events/payment-info-submitted", async (req, res) => {
  const parsed = paymentInfoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const normalizedCountryCode = normalizeCountryCode(parsed.data.countryCode, parsed.data.currencyCode);
  const normalizedPaymentMethod = normalizePaymentMethod(parsed.data.paymentMethod, parsed.data.paymentFailureLabel);

  saveRecoveryPayload({
    checkoutToken: parsed.data.checkoutToken,
    shopDomain: parsed.data.shopDomain,
    checkoutUrl: parsed.data.checkoutUrl,
    cartUrl: parsed.data.cartUrl,
    lineItems: parsed.data.lineItems || [],
    currencyCode: parsed.data.currencyCode,
    paymentMethod: normalizedPaymentMethod,
    paymentFailureLabel: parsed.data.paymentFailureLabel,
    updatedAt: new Date().toISOString()
  });
  await runtime.ingestSignal({
    ...parsed.data,
    countryCode: normalizedCountryCode,
    paymentMethod: normalizedPaymentMethod
  }, new Date().toISOString());
  return res.status(202).json({ ok: true });
});

app.post("/events/web-pixel", async (req, res) => {
  const parsedBody = (() => {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch {
        return req.body;
      }
    }
    return req.body;
  })();
  const parsed = webPixelSchema.safeParse(parsedBody);
  if (!parsed.success) {
    recordPixelDebug({
      kind: "rejected",
      payload: parsedBody,
      reason: JSON.stringify(parsed.error.flatten())
    });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { eventName, payload } = parsed.data;
  recordPixelDebug({
    kind: "accepted",
    eventName,
    payload
  });
  if (eventName === "checkout_completed" && payload.orderId) {
    await runtime.markCheckoutRecovered(payload.checkoutToken, payload.orderId, payload.shopDomain);
    return res.status(202).json({ ok: true, handled: eventName });
  }

  const normalizedCountryCode = normalizeCountryCode(payload.countryCode, payload.currencyCode);
  const normalizedPaymentMethod = normalizePaymentMethod(payload.paymentMethod, payload.paymentFailureLabel);

  saveRecoveryPayload({
    checkoutToken: payload.checkoutToken,
    shopDomain: payload.shopDomain,
    checkoutUrl: payload.checkoutUrl,
    cartUrl: payload.cartUrl,
    lineItems: payload.lineItems || [],
    currencyCode: payload.currencyCode,
    paymentMethod: normalizedPaymentMethod,
    paymentFailureLabel: payload.paymentFailureLabel,
    updatedAt: new Date().toISOString()
  });
  await runtime.ingestSignal({
    ...payload,
    countryCode: normalizedCountryCode,
    paymentMethod: normalizedPaymentMethod
  }, new Date().toISOString());
  return res.status(202).json({ ok: true, handled: eventName });
});

app.post("/events/checkout-completed", async (req, res) => {
  const parsed = recoveredSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  await runtime.markCheckoutRecovered(parsed.data.checkoutToken, parsed.data.orderId);
  return res.status(202).json({ ok: true });
});

app.post("/unsubscribe", async (req, res) => {
  const parsed = unsubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  await runtime.unsubscribe(parsed.data.checkoutToken);
  return res.status(202).json({ ok: true });
});

app.post("/jobs/run-due", async (_req, res) => {
  const processed = await runtime.runDue(new Date().toISOString());
  return res.status(200).json({ ok: true, processed });
});

app.post("/sessions/:checkoutToken/manual-outreach", async (req, res) => {
  const parsed = manualOutreachSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const shopDomain = parsed.data.shopDomain || env.SHOP_DOMAIN || "default-shop";
  const record = saveOperatorAction(req.params.checkoutToken, shopDomain, parsed.data.action);
  return res.status(200).json(record);
});

app.post("/sessions/:checkoutToken/generate-offer", async (req, res) => {
  const shopDomain = req.body?.shopDomain || env.SHOP_DOMAIN || "default-shop";
  const campaign = await getCurrentCampaign();
  const offer = getOrCreateRecoveryOffer({
    checkoutToken: req.params.checkoutToken,
    shopDomain,
    type: campaign.experience.discountType,
    value: campaign.experience.discountValue
  });
  const shopifyDiscount = await createShopifyDiscountCode(shopDomain, offer).catch((error) => ({
    created: false,
    reason: error instanceof Error ? error.message : "Unknown error"
  }));
  saveDiscountSync({
    checkoutToken: req.params.checkoutToken,
    shopDomain,
    status: shopifyDiscount.created ? "synced" : "failed",
    reason: shopifyDiscount.reason
  });
  return res.status(200).json({ offer, shopifyDiscount });
});

app.post("/pixels/activate", async (req, res) => {
  const parsed = pixelActivationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const shopDomain = parsed.data.shopDomain || env.SHOP_DOMAIN;
  if (!shopDomain) {
    return res.status(400).json({ error: "Missing shopDomain" });
  }

  const result = await activateShopifyWebPixel(shopDomain);
  const statusCode = result.activated ? 200 : 422;
  return res.status(statusCode).json(result);
});

app.get("/pixels/status", async (req, res) => {
  const shopDomain = (typeof req.query.shopDomain === "string" && req.query.shopDomain) || env.SHOP_DOMAIN;
  if (!shopDomain) {
    return res.status(400).json({ error: "Missing shopDomain" });
  }

  const result = await getShopifyWebPixelStatus(shopDomain);
  return res.status(200).json(result);
});

app.get("/pixels/debug", (_req, res) => {
  return res.status(200).json({ events: listPixelDebugEvents() });
});

app.post("/dev/test-failed-payment", async (req, res) => {
  const parsed = devTestFailedSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const shopDomain = parsed.data.shopDomain || env.SHOP_DOMAIN;
  if (!shopDomain) {
    return res.status(400).json({ error: "Missing shopDomain" });
  }

  const paymentInfoSubmittedAt = new Date(Date.now() - 2 * 60_000).toISOString();
  const checkoutToken = `chk_test_${crypto.randomUUID().slice(0, 8)}`;

  saveRecoveryPayload({
    checkoutToken,
    shopDomain,
    checkoutUrl: `https://${shopDomain}/checkouts/${checkoutToken}`,
    cartUrl: `https://${shopDomain}/cart`,
    lineItems: [],
    currencyCode: "USD",
    paymentMethod: "credit_card",
    paymentFailureLabel: "manual_test",
    updatedAt: new Date().toISOString()
  });

  await runtime.ingestSignal({
    checkoutToken,
    shopDomain,
    email: parsed.data.email,
    phone: parsed.data.phone,
    amountSubtotal: 129,
    countryCode: "US",
    customerSegment: "returning",
    paymentMethod: "credit_card",
    paymentInfoSubmittedAt
  }, new Date().toISOString());

  return res.status(202).json({
    ok: true,
    checkoutToken,
    paymentInfoSubmittedAt,
    message: "Test failed-payment session created."
  });
});

app.post("/webhooks/sendgrid/events", (req, res) => {
  const event = recordProviderEvent("sendgrid", req.body);
  const payloads = Array.isArray(req.body) ? req.body : [req.body];
  for (const payload of payloads) {
    const eventName = typeof payload?.event === "string" ? payload.event.toLowerCase() : "received";
    const checkoutToken = typeof payload?.custom_args?.checkoutToken === "string" ? payload.custom_args.checkoutToken : "";
    const shopDomain = typeof payload?.custom_args?.shopDomain === "string" ? payload.custom_args.shopDomain : "";
    if (!checkoutToken || !shopDomain) continue;
    saveDeliveryStatus({
      checkoutToken,
      shopDomain,
      channel: "email",
      status: eventName
    });
  }
  return res.status(202).json({ ok: true, receivedAt: event.receivedAt });
});

app.post("/webhooks/twilio/status", (req, res) => {
  const event = recordProviderEvent("twilio", req.body);
  const checkoutToken = typeof req.query.checkoutToken === "string" ? req.query.checkoutToken : "";
  const shopDomain = typeof req.query.shopDomain === "string" ? req.query.shopDomain : "";
  const status = typeof req.body?.MessageStatus === "string" ? req.body.MessageStatus.toLowerCase() : "received";
  if (checkoutToken && shopDomain) {
    saveDeliveryStatus({
      checkoutToken,
      shopDomain,
      channel: "sms",
      status
    });
  }
  return res.status(202).json({ ok: true, receivedAt: event.receivedAt });
});

app.get("/metrics", async (_req, res) => {
  return res.status(200).json(await runtime.metrics());
});

const port = appPort();
app.listen(port, () => {
  console.log(`Recovery API listening on http://127.0.0.1:${port}`);
});
