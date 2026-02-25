# Architecture

## Stack
- App: React + Remix + TypeScript
- Data: Postgres + Prisma
- Jobs: BullMQ + Redis
- Providers: SendGrid/Postmark (email), Twilio (SMS)
- Observability: Sentry + structured logs

## High-level flow
1. Collect checkout progression events.
2. Reconcile with checkout/order completion.
3. Mark a session as `LIKELY_FAILED_PAYMENT` after window expiry.
4. Enqueue channel sends based on retry policy.
5. Handle click/return and detect completed order.
6. Attribute recovery and stop future sends.

## Services
- `event-ingest`: receives webhooks/pixel events.
- `recovery-engine`: determines recovery eligibility.
- `message-worker`: executes sends with idempotency keys.
- `attribution-engine`: maps completed orders to recovery sessions.
- `admin-api`: powers embedded dashboard and settings.

## Data model (logical)
- shop
- checkout_session
- payment_attempt_signal
- recovery_campaign
- recovery_attempt
- message_delivery
- recovery_attribution
- app_setting

## Reliability controls
- Idempotency keys at event and send layers.
- Dead-letter queue for failed jobs.
- Exponential retry with upper cap for providers.
- Circuit-breaker behavior on provider outage.
