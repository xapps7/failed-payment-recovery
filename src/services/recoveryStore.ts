import { randomUUID } from "node:crypto";
import type { RecoverySession } from "../domain/types";

export interface CreateSessionInput {
  checkoutToken: string;
  shopDomain: string;
  email?: string;
  phone?: string;
  amountSubtotal?: number;
  failedAt: string;
}

export interface RecoveryStore {
  upsertFailedSession(input: CreateSessionInput): RecoverySession;
  getByCheckoutToken(checkoutToken: string): RecoverySession | undefined;
  markRecovered(checkoutToken: string, orderId: string): RecoverySession | undefined;
  markUnsubscribed(checkoutToken: string): RecoverySession | undefined;
  listDue(nowIso: string): RecoverySession[];
  listRecent(limit?: number): RecoverySession[];
  update(session: RecoverySession): RecoverySession;
  summary(): {
    detected: number;
    recovered: number;
    expired: number;
    active: number;
    recoveredRevenue: number;
    pendingRevenue: number;
  };
}

export class InMemoryRecoveryStore implements RecoveryStore {
  private sessions = new Map<string, RecoverySession>();

  upsertFailedSession(input: CreateSessionInput): RecoverySession {
    const existing = this.sessions.get(input.checkoutToken);
    if (existing) return existing;

    const session: RecoverySession = {
      id: randomUUID(),
      checkoutToken: input.checkoutToken,
      shopDomain: input.shopDomain,
      email: input.email,
      phone: input.phone,
      amountSubtotal: input.amountSubtotal,
      state: "LIKELY_FAILED_PAYMENT",
      attemptCount: 0,
      failedAt: input.failedAt,
      nextAttemptAt: input.failedAt
    };

    this.sessions.set(input.checkoutToken, session);
    return session;
  }

  getByCheckoutToken(checkoutToken: string): RecoverySession | undefined {
    return this.sessions.get(checkoutToken);
  }

  markRecovered(checkoutToken: string, orderId: string): RecoverySession | undefined {
    const session = this.sessions.get(checkoutToken);
    if (!session) return undefined;

    const updated: RecoverySession = {
      ...session,
      state: "RECOVERED",
      recoveredOrderId: orderId,
      nextAttemptAt: undefined
    };

    this.sessions.set(checkoutToken, updated);
    return updated;
  }

  markUnsubscribed(checkoutToken: string): RecoverySession | undefined {
    const session = this.sessions.get(checkoutToken);
    if (!session) return undefined;

    const updated: RecoverySession = {
      ...session,
      state: "UNSUBSCRIBED",
      nextAttemptAt: undefined
    };

    this.sessions.set(checkoutToken, updated);
    return updated;
  }

  listDue(nowIso: string): RecoverySession[] {
    const now = new Date(nowIso).getTime();
    return [...this.sessions.values()].filter((session) => {
      if (session.state !== "LIKELY_FAILED_PAYMENT") return false;
      if (!session.nextAttemptAt) return false;
      return new Date(session.nextAttemptAt).getTime() <= now;
    });
  }

  listRecent(limit = 10): RecoverySession[] {
    return [...this.sessions.values()]
      .sort((a, b) => {
        const aTime = new Date(a.failedAt || 0).getTime();
        const bTime = new Date(b.failedAt || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, limit);
  }

  update(session: RecoverySession): RecoverySession {
    this.sessions.set(session.checkoutToken, session);
    return session;
  }

  summary() {
    const values = [...this.sessions.values()];
    return {
      detected: values.length,
      recovered: values.filter((s) => s.state === "RECOVERED").length,
      expired: values.filter((s) => s.state === "EXPIRED").length,
      active: values.filter((s) => s.state === "LIKELY_FAILED_PAYMENT").length,
      recoveredRevenue: values
        .filter((s) => s.state === "RECOVERED")
        .reduce((sum, s) => sum + (s.amountSubtotal || 0), 0),
      pendingRevenue: values
        .filter((s) => s.state === "LIKELY_FAILED_PAYMENT")
        .reduce((sum, s) => sum + (s.amountSubtotal || 0), 0)
    };
  }
}
