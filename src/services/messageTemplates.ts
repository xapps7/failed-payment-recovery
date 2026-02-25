export interface MessageInput {
  shopName: string;
  retryUrl: string;
}

export function emailHtml(input: MessageInput): string {
  return [
    `<h2>Complete your purchase at ${input.shopName}</h2>`,
    `<p>Your payment did not go through. You can complete checkout securely using the link below.</p>`,
    `<p><a href="${input.retryUrl}">Complete your purchase</a></p>`
  ].join("\n");
}

export function smsText(input: MessageInput): string {
  return `Complete your purchase at ${input.shopName}: ${input.retryUrl}`;
}
