/**
 * The portal sync workers do nothing unless boot registers them: a queue with
 * no worker just accumulates jobs. Every job module is mocked at its boundary,
 * so this asserts the registration calls and nothing about pg-boss.
 */
import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const spy = (name: string) => vi.fn(async () => void calls.push(name));

vi.mock("@/modules/inventory-sync/job", () => ({ registerInventorySyncWorker: spy("inventory"), scheduleWeeklySync: spy("weekly") }));
vi.mock("@/modules/pdf-generation/worker", () => ({ registerPdfGenerateWorker: spy("pdf-generate") }));
vi.mock("@/modules/catalog-storage/upload-status", () => ({ registerPdfUploadWorker: spy("pdf-upload") }));
vi.mock("@/modules/reminders/job", () => ({ registerReminderWorker: spy("reminder") }));
vi.mock("@/modules/portal-sync/job", () => ({ registerPortalSyncWorker: spy("portal-sync") }));

describe("registerNodeWorkers", () => {
  it("registers the portal sync worker at boot", async () => {
    const { registerNodeWorkers } = await import("./instrumentation-node");
    await registerNodeWorkers();
    expect(calls).toContain("portal-sync");
  });
});
