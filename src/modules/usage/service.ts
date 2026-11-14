import { sql } from "drizzle-orm";

import { SCREEN_LABELS } from "@/modules/feedback/screen-labels";
import { db } from "@/shared/db/client";
import { usageDaily } from "@/shared/db/schema";
import type { RoleGroup } from "./groups";

/** A screen PATTERN the app knows (`/service-orders/[id]`), never a concrete URL. Own keys only: `in` would accept "constructor". */
export function isUsageScreen(screen: unknown): screen is string {
  return typeof screen === "string" && Object.hasOwn(SCREEN_LABELS, screen);
}

/** One atomic statement: the day is the database's Panama date, and a conflict increments rather than overwrites. */
export function upsertViewStatement(screen: string, group: RoleGroup) {
  return db
    .insert(usageDaily)
    .values({ day: sql`(now() AT TIME ZONE 'America/Panama')::date`, screen, roleGroup: group, views: 1 })
    .onConflictDoUpdate({
      target: [usageDaily.day, usageDaily.screen, usageDaily.roleGroup],
      set: { views: sql`${usageDaily.views} + 1` },
    });
}

export type RecordViewDeps = {
  upsert?: (screen: string, group: RoleGroup) => Promise<void>;
};

/** The caller has already checked `isUsageScreen` and derived `group` from the session. */
export async function recordView(screen: string, group: RoleGroup, deps?: RecordViewDeps): Promise<void> {
  const upsert =
    deps?.upsert ??
    (async (s: string, g: RoleGroup) => {
      await upsertViewStatement(s, g);
    });
  await upsert(screen, group);
}
