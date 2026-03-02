import { describe, expect, it } from "vitest";
import { RecoveryRuntime } from "../src/services/recoveryRuntime";
import { InMemoryRecoveryStore } from "../src/services/recoveryStore";
import type { Notifier } from "../src/services/notifier";

class TestNotifier implements Notifier {
  sent = 0;

  async sendEmail() {
    this.sent += 1;
    return { channel: "email" as const, provider: "test", status: "sent", sent: true };
  }

  async sendSms() {
    this.sent += 1;
    return { channel: "sms" as const, provider: "test", status: "sent", sent: true };
  }
}

describe("RecoveryRuntime", () => {
  it("creates a failed session and processes due attempts", async () => {
    const store = new InMemoryRecoveryStore();
    const notifier = new TestNotifier();
    const runtime = new RecoveryRuntime(store, notifier);

    await runtime.ingestSignal(
      {
        checkoutToken: "chk_1",
        shopDomain: "example.myshopify.com",
        paymentInfoSubmittedAt: "2026-02-24T12:00:00.000Z"
      },
      "2026-02-24T12:30:00.000Z"
    );

    const processed = await runtime.runDue("2026-02-24T12:30:00.000Z");
    const metrics = await runtime.metrics();

    expect(processed).toBe(1);
    expect(notifier.sent).toBe(1);
    expect(metrics.detected).toBe(1);
  });

  it("marks recovered sessions", async () => {
    const store = new InMemoryRecoveryStore();
    const notifier = new TestNotifier();
    const runtime = new RecoveryRuntime(store, notifier);

    await runtime.ingestSignal(
      {
        checkoutToken: "chk_2",
        shopDomain: "example.myshopify.com",
        paymentInfoSubmittedAt: "2026-02-24T12:00:00.000Z"
      },
      "2026-02-24T12:30:00.000Z"
    );

    await runtime.markCheckoutRecovered("chk_2", "order_99", "example.myshopify.com");
    const metrics = await runtime.metrics();

    expect(metrics.recovered).toBe(1);
  });
});
