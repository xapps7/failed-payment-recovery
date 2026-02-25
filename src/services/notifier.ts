import type { RecoverySession } from "../domain/types";

export interface Notifier {
  sendEmail(session: RecoverySession): Promise<void>;
  sendSms(session: RecoverySession): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  async sendEmail(session: RecoverySession): Promise<void> {
    console.log(`[email] checkout=${session.checkoutToken} shop=${session.shopDomain}`);
  }

  async sendSms(session: RecoverySession): Promise<void> {
    console.log(`[sms] checkout=${session.checkoutToken} shop=${session.shopDomain}`);
  }
}
