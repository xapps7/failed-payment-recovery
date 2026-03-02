import { register } from "@shopify/web-pixels-extension";

type LineItem = {
  merchandise?: {
    id?: string;
    product?: { title?: string };
  };
  quantity?: number;
};

register(({ analytics, browser, settings }) => {
  const endpoint = typeof settings.endpoint === "string" ? settings.endpoint : "";
  const shopDomain = typeof settings.shopDomain === "string" ? settings.shopDomain : browser.location.hostname;

  if (!endpoint || !shopDomain) return;

  async function forward(eventName: "payment_info_submitted" | "checkout_completed", event: unknown) {
    const checkout = (event as { data?: { checkout?: Record<string, unknown> } })?.data?.checkout || {};
    const lineItems = (checkout.lineItems as LineItem[] | undefined) || [];

    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventName,
        payload: {
          checkoutToken: (checkout.token as string) || "",
          shopDomain,
          email: (checkout.email as string) || undefined,
          phone: (checkout.phone as string) || undefined,
          amountSubtotal: Number(checkout.subtotalPrice?.amount || 0) || undefined,
          countryCode: (checkout.billingAddress?.countryCode as string) || undefined,
          paymentMethod: (checkout.transactions?.[0]?.gateway as string) || (checkout.paymentMethod?.type as string) || undefined,
          paymentFailureLabel: eventName === "payment_info_submitted" ? "payment_info_submitted" : undefined,
          checkoutUrl: (checkout.webUrl as string) || undefined,
          cartUrl: (checkout.cart?.webUrl as string) || undefined,
          currencyCode: (checkout.currencyCode as string) || undefined,
          lineItems: lineItems
            .filter((item) => item?.merchandise?.id)
            .map((item) => ({
              variantId: String(item.merchandise?.id),
              quantity: Number(item.quantity || 1),
              title: item.merchandise?.product?.title
            })),
          paymentInfoSubmittedAt: new Date().toISOString(),
          checkoutCompletedAt: eventName === "checkout_completed" ? new Date().toISOString() : undefined,
          orderId: eventName === "checkout_completed" ? ((checkout.order?.id as string) || undefined) : undefined
        }
      })
    });
  }

  analytics.subscribe("payment_info_submitted", async (event) => {
    await forward("payment_info_submitted", event);
  });

  analytics.subscribe("checkout_completed", async (event) => {
    await forward("checkout_completed", event);
  });
});
