import { describe, expect, it } from "vitest";

import type { Reminder } from "@/shared/db/schema";
import { listRemindersForOrder } from "./queries";

describe("listRemindersForOrder (Phase 6 — order-detail reminders list, R24/R25/R26)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    const rows = [
      { id: "r1", ordenId: "o1", type: "appointment", channel: "whatsapp", status: "scheduled" },
      { id: "r2", ordenId: "o1", type: "service_due", channel: "email", status: "sent" },
    ] as unknown as Reminder[];

    await expect(listRemindersForOrder("o1", async () => rows)).resolves.toEqual(rows);
  });

  it("returns an empty array when the injected queryFn finds nothing", async () => {
    await expect(listRemindersForOrder("missing", async () => [])).resolves.toEqual([]);
  });
});
