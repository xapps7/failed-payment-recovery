export interface MessageInput {
  shopName: string;
  retryUrl: string;
  openTrackingUrl?: string;
  headline?: string;
  body?: string;
  smsBody?: string;
  tone?: "steady" | "urgent" | "concierge" | "rescue";
  incentive?: string | null;
  supportNote?: string;
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
  const lines = [
    `<h2>${input.headline || `${accent} at ${input.shopName}`}</h2>`,
    `<p>${input.body || "Your payment did not go through. You can complete checkout securely using the link below."}</p>`,
    input.incentive ? `<p><strong>Recovery offer:</strong> ${input.incentive}</p>` : "",
    input.supportNote ? `<p>${input.supportNote}</p>` : "",
    `<p><a href="${input.retryUrl}">Complete your purchase</a></p>`,
    input.openTrackingUrl ? `<img src="${input.openTrackingUrl}" alt="" width="1" height="1" style="display:none;" />` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

export function smsText(input: MessageInput): string {
  const base = input.smsBody
    ? input.smsBody.replace("{{retryUrl}}", input.retryUrl)
    : `Complete your purchase at ${input.shopName}: ${input.retryUrl}`;
  const extras = [input.incentive ? `Offer: ${input.incentive}.` : "", input.supportNote || ""]
    .filter(Boolean)
    .join(" ");
  if (extras) {
    return `${base} ${extras}`.trim();
  }
  return base;
}
