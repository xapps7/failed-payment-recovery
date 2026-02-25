# Work Log

## 2026-02-24
- Initialized project documentation and architecture baseline.
- Attempted official Shopify Remix scaffold via Shopify CLI.
- Scaffold currently blocked pending Shopify device authentication.
- Created TypeScript codebase scaffold with React UI shell and Vite config.
- Implemented recovery domain primitives: failure inference, retry policy, session state transitions.
- Implemented secure signed-link helper and message templates.
- Implemented recovery worker contract and baseline unit tests.
- Aligned dependency versions for Shopify Polaris compatibility (React 18).
- Installed dependencies and validated current app with successful `npm run test` and `npm run build`.
- Added backend runtime: event ingestion endpoints, recovery processing loop, unsubscribe and metrics endpoints.
- Added runtime tests and kept suite green.
- Noted sandbox limitation for local background-process smoke run; no failing unit/build checks.
- Added environment configuration support (`.env`, `.env.example`, strict env parsing).
- Wired Shopify auth bootstrap endpoints: `/auth/start` and `/auth/callback` scaffold.
- Revalidated suite: tests/build passing after auth config changes.
- Wired Shopify OAuth flow with HMAC verification, state issuance/validation, and token exchange endpoint.
- Added persistent local token storage (`data/shopTokens.json`) and shop listing endpoint.
- Added OAuth verifier tests; test/build remain green.
