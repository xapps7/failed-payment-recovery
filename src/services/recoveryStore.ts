import { randomUUID } from "node:crypto";
import type { Prisma, RecoveryState as PrismaRecoveryState } from "@prisma/client";
import { getPrisma } from "../db/prisma";
import type { RecoverySession } from "../domain/types";

export interface CreateSessionInput {
  campaignId?: string;
  checkoutToken: string;
  shopDomain: string;
  email?: string;
  phone?: string;
  amountSubtotal?: number;
  countryCode?: string;
  customerSegment?: "all" | "new" | "returning" | "vip";
  paymentMethod?: string;
  failedAt: string;
  nextAttemptAt?: string;
}

export interface DeliveryAttemptInput {
  sessionId: string;
  channel: "email" | "sms";
  provider: string;
  status: string;
  providerMessageId?: string;
  payload?: Record<string, unknown>;
}

export interface RecoveryStore {
  upsertFailedSession(input: CreateSessionInput): Promise<RecoverySession>;
  getByCheckoutToken(checkoutToken: string, shopDomain?: string): Promise<RecoverySession | undefined>;
  markRecovered(checkoutToken: string, orderId: string, shopDomain?: string): Promise<RecoverySession | undefined>;
  markUnsubscribed(checkoutToken: string, shopDomain?: string): Promise<RecoverySession | undefined>;
  listDue(nowIso: string): Promise<RecoverySession[]>;
  listRecent(limit?: number): Promise<RecoverySession[]>;
  update(session: RecoverySession): Promise<RecoverySession>;
  summary(): Promise<{
    detected: number;
    recovered: number;
    expired: number;
    active: number;
    recoveredRevenue: number;
    pendingRevenue: number;
  }>;
  recordDeliveryAttempt(input: DeliveryAttemptInput): Promise<void>;
}

type SessionRow = Prisma.RecoverySessionGetPayload<{
  include: { shop: true };
}>;

function mapSession(row: SessionRow): RecoverySession {
  return {
    id: row.id,
    campaignId: row.campaignId || undefined,
    checkoutToken: row.checkoutToken,
    shopDomain: row.shop.domain,
    email: row.email || undefined,
    phone: row.phone || undefined,
    amountSubtotal: row.amountSubtotal ?? undefined,
    countryCode: row.countryCode || undefined,
    customerSegment: (row.customerSegment as RecoverySession["customerSegment"]) || undefined,
    paymentMethod: row.paymentMethod || undefined,
    state: row.state as RecoverySession["state"],
    attemptCount: row.attemptCount,
    failedAt: row.failedAt?.toISOString(),
    lastAttemptAt: row.lastAttemptAt?.toISOString(),
    nextAttemptAt: row.nextAttemptAt?.toISOString(),
    recoveredOrderId: row.recoveredOrderId || undefined
  };
}

export class InMemoryRecoveryStore implements RecoveryStore {
  private sessions = new Map<string, RecoverySession>();

  private sessionKey(checkoutToken: string, shopDomain = "default-shop") {
    return `${shopDomain}::${checkoutToken}`;
  }

  private async ensureShop(shopDomain: string): Promise<string | null> {
    const prisma = getPrisma();
    if (!prisma) return null;

    const shop = await prisma.shop.upsert({
      where: { domain: shopDomain },
      update: {},
      create: {
        domain: shopDomain,
        accessToken: "",
        grantedScope: null
      }
    });
    return shop.id;
  }

  async upsertFailedSession(input: CreateSessionInput): Promise<RecoverySession> {
    const prisma = getPrisma();
    const key = this.sessionKey(input.checkoutToken, input.shopDomain);
    const existing = this.sessions.get(key);
    if (existing) return existing;

    const session: RecoverySession = {
      id: randomUUID(),
      campaignId: input.campaignId,
      checkoutToken: input.checkoutToken,
      shopDomain: input.shopDomain,
      email: input.email,
      phone: input.phone,
      amountSubtotal: input.amountSubtotal,
      countryCode: input.countryCode,
      customerSegment: input.customerSegment,
      paymentMethod: input.paymentMethod,
      state: "LIKELY_FAILED_PAYMENT",
      attemptCount: 0,
      failedAt: input.failedAt,
      nextAttemptAt: input.nextAttemptAt || input.failedAt
    };

    if (prisma) {
      const shopId = await this.ensureShop(input.shopDomain);
      const row = await prisma.recoverySession.upsert({
        where: {
          shopId_checkoutToken: {
            shopId: shopId!,
            checkoutToken: input.checkoutToken
          }
        },
        update: {
          email: input.email,
          phone: input.phone,
          amountSubtotal: input.amountSubtotal,
          countryCode: input.countryCode,
          customerSegment: input.customerSegment,
          paymentMethod: input.paymentMethod,
          campaignId: input.campaignId || null,
          failedAt: new Date(input.failedAt),
          nextAttemptAt: new Date(input.nextAttemptAt || input.failedAt),
          state: "LIKELY_FAILED_PAYMENT"
        },
        create: {
          id: session.id,
          shopId: shopId!,
          campaignId: input.campaignId || null,
          checkoutToken: input.checkoutToken,
          email: input.email,
          phone: input.phone,
          amountSubtotal: input.amountSubtotal,
          countryCode: input.countryCode,
          customerSegment: input.customerSegment,
          paymentMethod: input.paymentMethod,
          failedAt: new Date(input.failedAt),
          nextAttemptAt: new Date(input.nextAttemptAt || input.failedAt),
          state: "LIKELY_FAILED_PAYMENT"
        },
        include: { shop: true }
      });
      const mapped = mapSession(row);
      this.sessions.set(key, mapped);
      return mapped;
    }

    this.sessions.set(key, session);
    return session;
  }

  async getByCheckoutToken(checkoutToken: string, shopDomain = "default-shop"): Promise<RecoverySession | undefined> {
    const prisma = getPrisma();
    if (prisma) {
      const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
      if (!shop) return undefined;
      const row = await prisma.recoverySession.findUnique({
        where: { shopId_checkoutToken: { shopId: shop.id, checkoutToken } },
        include: { shop: true }
      });
      return row ? mapSession(row) : undefined;
    }

    return this.sessions.get(this.sessionKey(checkoutToken, shopDomain));
  }

  async markRecovered(checkoutToken: string, orderId: string, shopDomain = "default-shop"): Promise<RecoverySession | undefined> {
    const existing = await this.getByCheckoutToken(checkoutToken, shopDomain);
    if (!existing) return undefined;

    const updated: RecoverySession = {
      ...existing,
      state: "RECOVERED",
      recoveredOrderId: orderId,
      nextAttemptAt: undefined
    };

    return this.update(updated);
  }

  async markUnsubscribed(checkoutToken: string, shopDomain = "default-shop"): Promise<RecoverySession | undefined> {
    const existing = await this.getByCheckoutToken(checkoutToken, shopDomain);
    if (!existing) return undefined;

    const updated: RecoverySession = {
      ...existing,
      state: "UNSUBSCRIBED",
      nextAttemptAt: undefined
    };

    return this.update(updated);
  }

  async listDue(nowIso: string): Promise<RecoverySession[]> {
    const prisma = getPrisma();
    if (prisma) {
      const rows = await prisma.recoverySession.findMany({
        where: {
          state: "LIKELY_FAILED_PAYMENT",
          nextAttemptAt: { lte: new Date(nowIso) }
        },
        include: { shop: true },
        orderBy: { nextAttemptAt: "asc" }
      });
      return rows.map(mapSession);
    }

    const now = new Date(nowIso).getTime();
    return [...this.sessions.values()].filter((session) => {
      if (session.state !== "LIKELY_FAILED_PAYMENT") return false;
      if (!session.nextAttemptAt) return false;
      return new Date(session.nextAttemptAt).getTime() <= now;
    });
  }

  async listRecent(limit = 10): Promise<RecoverySession[]> {
    const prisma = getPrisma();
    if (prisma) {
      const rows = await prisma.recoverySession.findMany({
        include: { shop: true },
        orderBy: { failedAt: "desc" },
        take: limit
      });
      return rows.map(mapSession);
    }

    return [...this.sessions.values()]
      .sort((a, b) => new Date(b.failedAt || 0).getTime() - new Date(a.failedAt || 0).getTime())
      .slice(0, limit);
  }

  async update(session: RecoverySession): Promise<RecoverySession> {
    const prisma = getPrisma();
    const key = this.sessionKey(session.checkoutToken, session.shopDomain);
    this.sessions.set(key, session);

    if (prisma) {
      const shopId = await this.ensureShop(session.shopDomain);
      await prisma.recoverySession.update({
        where: { shopId_checkoutToken: { shopId: shopId!, checkoutToken: session.checkoutToken } },
        data: {
          campaignId: session.campaignId || null,
          email: session.email,
          phone: session.phone,
          amountSubtotal: session.amountSubtotal,
          countryCode: session.countryCode,
          customerSegment: session.customerSegment,
          paymentMethod: session.paymentMethod,
          state: session.state as PrismaRecoveryState,
          attemptCount: session.attemptCount,
          failedAt: session.failedAt ? new Date(session.failedAt) : null,
          lastAttemptAt: session.lastAttemptAt ? new Date(session.lastAttemptAt) : null,
          nextAttemptAt: session.nextAttemptAt ? new Date(session.nextAttemptAt) : null,
          recoveredOrderId: session.recoveredOrderId || null
        }
      });
    }

    return session;
  }

  async summary() {
    const values = getPrisma() ? await this.listRecent(500) : [...this.sessions.values()];
    return {
      detected: values.length,
      recovered: values.filter((s) => s.state === "RECOVERED").length,
      expired: values.filter((s) => s.state === "EXPIRED").length,
      active: values.filter((s) => s.state === "LIKELY_FAILED_PAYMENT").length,
      recoveredRevenue: values.filter((s) => s.state === "RECOVERED").reduce((sum, s) => sum + (s.amountSubtotal || 0), 0),
      pendingRevenue: values.filter((s) => s.state === "LIKELY_FAILED_PAYMENT").reduce((sum, s) => sum + (s.amountSubtotal || 0), 0)
    };
  }

  async recordDeliveryAttempt(input: DeliveryAttemptInput): Promise<void> {
    const prisma = getPrisma();
    if (!prisma) return;

    await prisma.deliveryAttempt.create({
      data: {
        sessionId: input.sessionId,
        channel: input.channel,
        provider: input.provider,
        status: input.status,
        providerMessageId: input.providerMessageId,
        payload: (input.payload || undefined) as Prisma.InputJsonValue | undefined
      }
    });
  }
}
