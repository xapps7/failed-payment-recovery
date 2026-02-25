import { describe, expect, it } from "vitest";
import { RecoveryRuntime } from "../src/services/recoveryRuntime";
import { InMemoryRecoveryStore } from "../src/services/recoveryStore";
import type { Notifier } from "../src/services/notifier";

class TestNotifier implements Notifier {
  sent = 0;

  async sendEmail() {
    this.sent += 1;
  }

  async sendSms() {
    this.sent += 1;
  }
}

describe("RecoveryRuntime", () => {
  it("creates a failed session and processes due attempts", async () => {
    const store = new InMemoryRecoveryStore();
    const notifier = new TestNotifier();
    const runtime = new RecoveryRuntime(store, notifier);

    runtime.ingestSignal(
      {
        checkoutToken: "chk_1",
        shopDomain: "example.myshopify.com",
        paymentInfoSubmittedAt: "2026-02-24T12:00:00.000Z"
      },
      "2026-02-24T12:30:00.000Z"
    );

    const processed = await runtime.runDue("2026-02-24T12:30:00.000Z");

    expect(processed).toBe(1);
    expect(notifier.sent).toBe(2);
    expect(runtime.metrics().detected).toBe(1);
  });

  it("marks recovered sessions", () => {
    const store = new InMemoryRecoveryStore();
    const notifier = new TestNotifier();
    const runtime = new RecoveryRuntime(store, notifier);

    runtime.ingestSignal(
      {
        checkoutToken: "chk_2",
        shopDomain: "example.myshopify.com",
        paymentInfoSubmittedAt: "2026-02-24T12:00:00.000Z"
      },
      "2026-02-24T12:30:00.000Z"
    );

    runtime.markCheckoutRecovered("chk_2", "order_99");

    expect(runtime.metrics().recovered).toBe(1);
  });
});
