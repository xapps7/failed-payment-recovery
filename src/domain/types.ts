export type RecoveryState =
  | "PENDING"
  | "LIKELY_FAILED_PAYMENT"
  | "RECOVERED"
  | "EXPIRED"
  | "UNSUBSCRIBED";

export interface CheckoutSignal {
  checkoutToken: string;
  shopDomain: string;
  email?: string;
  phone?: string;
  amountSubtotal?: number;
  countryCode?: string;
  customerSegment?: "all" | "new" | "returning" | "vip";
  paymentInfoSubmittedAt?: string;
  checkoutCompletedAt?: string;
}

export interface RecoverySession {
  id: string;
  checkoutToken: string;
  shopDomain: string;
  email?: string;
  phone?: string;
  amountSubtotal?: number;
  countryCode?: string;
  customerSegment?: "all" | "new" | "returning" | "vip";
  state: RecoveryState;
  attemptCount: number;
  failedAt?: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  recoveredOrderId?: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  minutesAfterFailure: number[];
}
