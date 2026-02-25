import { describe, expect, it } from "vitest";
import { inferLikelyFailedPayment } from "../src/domain/recoveryEngine";

describe("inferLikelyFailedPayment", () => {
  it("returns true after 15 minutes if checkout not completed", () => {
    const now = "2026-02-24T12:30:00.000Z";
    const result = inferLikelyFailedPayment(
      {
        checkoutToken: "chk_1",
        shopDomain: "example.myshopify.com",
        paymentInfoSubmittedAt: "2026-02-24T12:00:00.000Z"
      },
      now
    );

    expect(result).toBe(true);
  });

  it("returns false when checkout completed", () => {
    const result = inferLikelyFailedPayment(
      {
        checkoutToken: "chk_1",
        shopDomain: "example.myshopify.com",
        paymentInfoSubmittedAt: "2026-02-24T12:00:00.000Z",
        checkoutCompletedAt: "2026-02-24T12:02:00.000Z"
      },
      "2026-02-24T12:30:00.000Z"
    );

    expect(result).toBe(false);
  });
});
