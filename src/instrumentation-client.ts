/**
 * Next 15+/16's documented client-side instrumentation file — the browser
 * counterpart to `instrumentation.ts`'s server init (design.md decision 15,
 * spec.md "Browser Error Capture on Insecure LAN Context"). Bundled and run
 * for every page load, including over plain HTTP at a LAN IP: Sentry's
 * `uuid4()` falls back to `Math.random` when `crypto.randomUUID` is
 * unavailable (exploration.md's "External facts"), and its transport is
 * `fetch` to an HTTPS ingest host — safe on this repo's insecure LAN
 * context (AGENTS.md's third testing limit).
 *
 * `NEXT_PUBLIC_SENTRY_DSN` is inlined into the client bundle at build time,
 * so changing it needs a rebuild. Errors only: no `tracesSampleRate`, no
 * replay integration, no profiling (decision 15 — out of scope).
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // `release` is deliberately omitted here — `next.config.ts`'s
    // `withSentryConfig` supplies it via `release.name` (git SHA),
    // inlined at build time (design.md decision 16 amendment).
    // See instrumentation.ts: v11 replaced `sendDefaultPii: false` with a
    // granular `dataCollection` object defaulting to `true`.
    dataCollection: { userInfo: false },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
