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
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeWorkers } = await import("./instrumentation-node");
    await registerNodeWorkers();
  }
}
