/**
 * Next.js instrumentation hook (stable since Next 15 — no experimental flag
 * needed, confirmed via node_modules/next/dist/docs/01-app/02-guides/
 * instrumentation.md: "create instrumentation.ts in the root directory... or
 * inside src"). `register()` runs ONCE when a new server instance starts,
 * before it accepts requests — design.md's "Technical Approach": "One
 * long-lived process runs the web server, the pg-boss workers, and the
 * weekly cron" all live in this ONE process, and this file is what actually
 * starts the worker/cron half of that sentence.
 *
 * Gap this closes: PR2-PR8 each defined a `register*Worker()`/
 * `scheduleWeeklySync()` function but nothing ever called them — every
 * enqueued job (`inventory-sync`, `pdf-generate`, `pdf-upload`) would sit in
 * `pgboss.job` forever, unprocessed, in every environment that ran this app
 * (dev, Docker, or this session's E2E test) until this file existed.
 *
 * The actual worker registration lives in `./instrumentation-node.ts`, split
 * out per Next's own documented "Importing runtime-specific code" pattern —
 * all three workers (`inventory-sync`, `pdf-generate`, `pdf-upload`) start
 * here, eagerly, at boot. Getting `pdf-generate` reachable from here needed
 * one fix in `pdf-generation/render.ts`: its `react-dom/server` import had to
 * become a dynamic (in-function) import, not a static top-level one — a
 * static import there broke `next build` (confirmed with both Turbopack and
 * webpack) the moment this file made that module reachable from the app's
 * build graph for the first time. See render.ts's header for the full story.
 *
 * error-monitoring (design.md decision 13, spec.md "Server-Side Error
 * Capture Ordering"): Sentry init is the FIRST statement of the `nodejs`
 * branch, before the worker bootstrap, so a bootstrap failure is itself
 * captured. Reads `process.env` directly rather than `env.ts`, because
 * `env.ts` throws on a missing `DATABASE_URL` before init could ever run.
 * An explicit DSN guard — no init call at all when unset — rather than
 * relying on the SDK's own no-DSN no-op (decision 14).
 */
import * as Sentry from "@sentry/nextjs";
import { version } from "../package.json";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dsn = process.env.SENTRY_DSN || undefined;
    if (dsn) {
      Sentry.init({
        dsn,
        environment: "workshop",
        release: version,
        // v11 replaced the old `sendDefaultPii: false` boolean with a
        // granular `dataCollection` object whose `userInfo` (IP address,
        // etc.) defaults to `true` (confirmed:
        // node_modules/@sentry/core/build/types/types/datacollection.d.ts).
        // `userInfo: false` is the direct equivalent of the old default.
        dataCollection: { userInfo: false },
      });
    }

    const { registerNodeWorkers } = await import("./instrumentation-node");
    try {
      await registerNodeWorkers();
    } catch (error) {
      Sentry.captureException(error);
      throw error;
    }
  }
}

export const onRequestError = Sentry.captureRequestError;
