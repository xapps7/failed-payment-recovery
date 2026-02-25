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
  paymentInfoSubmittedAt?: string;
  checkoutCompletedAt?: string;
}

export interface RecoverySession {
  id: string;
  checkoutToken: string;
  shopDomain: string;
  state: RecoveryState;
  attemptCount: number;
  nextAttemptAt?: string;
  recoveredOrderId?: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  minutesAfterFailure: number[];
}
