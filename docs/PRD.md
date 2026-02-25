# Failed Payment Recovery - Product Requirements

## Objective
Recover revenue from failed one-time checkout payment attempts on Shopify by detecting likely payment failures and orchestrating branded retry communications via email and SMS.

## Core outcomes
- Detect likely failed payment attempts quickly.
- Send branded recovery messages with secure resume link.
- Retry on an opinionated schedule.
- Attribute recovered orders and recovered revenue.
- Provide a simple admin console with clear ROI metrics.

## Scope v1
- Shopify embedded app (admin).
- Detection engine using checkout event + completion reconciliation.
- Recovery workflow (email + SMS).
- Retry scheduler with idempotent sends.
- Basic settings and branding.
- Recovery metrics dashboard.

## Non-goals v1
- AI recommendations.
- Complex BI dashboards.
- Multi-language campaign management.

## Success metrics
- Recovery rate = recovered_orders / detected_failed_attempts.
- Recovered revenue per 30-day window.
- Send success rate by channel.
- Median time to recovery.

## Key constraints
- One-time payment decline reason visibility is partial.
- Detection uses inference based on checkout progression and non-completion windows.
- Must avoid duplicate sends and over-messaging.

## Compliance
- Consent-aware SMS.
- Unsubscribe handling.
- Data minimization and retention policy.
