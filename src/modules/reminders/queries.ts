/**
 * reminders/queries.ts — DB read model for the order-detail page's
 * "scheduled/sent reminders" list (R24, R25, R26). DI seam mirrors
 * customers/queries.ts / service-orders/queries.ts's injected-`queryFn`
 * convention: unit-testable with a fake, no live Postgres connection.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { reminder, type Reminder } from "@/shared/db/schema";

/** R24/R25/R26 — every reminder tied to this order, earliest-scheduled first. */
export async function listRemindersForOrder(
  ordenId: string,
  queryFn: () => Promise<Reminder[]> = () =>
    db.select().from(reminder).where(eq(reminder.ordenId, ordenId)).orderBy(asc(reminder.scheduledFor)),
): Promise<Reminder[]> {
  return queryFn();
}
