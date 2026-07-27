/**
 * Node-runtime-only half of instrumentation.ts's `register()` — split into
 * its own file per Next's own documented pattern (see
 * node_modules/next/dist/docs/01-app/02-guides/instrumentation.md's
 * "Importing runtime-specific code" example).
 *
 * Starts all four pg-boss workers eagerly at boot. `pdf-generate`'s render
 * pipeline (`pdf-generation/render.ts`) transitively imports
 * `react-dom/server` — that had to become a dynamic (in-function) import
 * there, not a static top-level one, or `next build` rejects it once this
 * file makes that module reachable from the app's build graph (confirmed
 * with both Turbopack and webpack) — see render.ts's header for the full
 * story.
 *
 * `reminders/job.ts`'s `registerReminderWorker` is added here too (design.md
 * §5's "Bootstrap" note) — unlike `scheduleWeeklySync`, reminders have no
 * recurring cron registered at boot; individual reminder jobs are enqueued
 * on demand by `service-orders/service.ts` via `scheduleReminder`.
 */
export async function registerNodeWorkers(): Promise<void> {
  const { registerInventorySyncWorker, scheduleWeeklySync } = await import("@/modules/inventory-sync/job");
  const { registerPdfGenerateWorker } = await import("@/modules/pdf-generation/worker");
  const { registerPdfUploadWorker } = await import("@/modules/catalog-storage/upload-status");
  const { registerReminderWorker } = await import("@/modules/reminders/job");

  await registerInventorySyncWorker();
  await scheduleWeeklySync();
  await registerPdfGenerateWorker();
  await registerPdfUploadWorker();
  await registerReminderWorker();
}
