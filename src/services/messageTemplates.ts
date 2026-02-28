export interface MessageInput {
  shopName: string;
  retryUrl: string;
  headline?: string;
  body?: string;
  smsBody?: string;
  tone?: "steady" | "urgent" | "concierge" | "rescue";
}

export function emailHtml(input: MessageInput): string {
  const accent =
    input.tone === "urgent"
      ? "Act now"
      : input.tone === "concierge"
        ? "We saved your order"
        : input.tone === "rescue"
          ? "Finish securely"
          : "Complete your purchase";
  return [
    `<h2>${input.headline || `${accent} at ${input.shopName}`}</h2>`,
    `<p>${input.body || "Your payment did not go through. You can complete checkout securely using the link below."}</p>`,
    `<p><a href="${input.retryUrl}">Complete your purchase</a></p>`
  ].join("\n");
}

export function smsText(input: MessageInput): string {
  if (input.smsBody) {
    return input.smsBody.replace("{{retryUrl}}", input.retryUrl);
  }
  return `Complete your purchase at ${input.shopName}: ${input.retryUrl}`;
}
