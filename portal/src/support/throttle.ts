import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "../db/client";
import { supportLoginThrottle } from "../db/schema";

export const MAX_FAILURES = 5;
export const WINDOW_MINUTES = 15;
export const LOCK_MINUTES = 15;

/**
 * Keyed by the first x-forwarded-for hop, as rate-limit.ts. TRUST ASSUMPTION: on Vercel the
 * platform sets this header itself and drops a client-supplied value, so it cannot be spoofed
 * to dodge the lock. Off Vercel it can; a missing header shares one "unknown" bucket.
 */
export const clientIp = (request: Request): string =>
  request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";

export interface ThrottleStore {
  isLocked(ip: string): Promise<boolean>;
  recordFailure(ip: string): Promise<void>;
  clear(ip: string): Promise<void>;
}

// Every time comparison uses the database clock, so instances with skewed clocks agree.
export const dbThrottleStore: ThrottleStore = {
  async isLocked(ip) {
    const rows = await db
      .select({ ip: supportLoginThrottle.ip })
      .from(supportLoginThrottle)
      .where(and(eq(supportLoginThrottle.ip, ip), gt(supportLoginThrottle.lockedUntil, sql`now()`)));
    return rows.length > 0;
  },

  // One atomic upsert: a stale window restarts at 1, otherwise +1; the 5th failure locks.
  // Every right-hand side reads the pre-update row, hence the repeated CASE.
  async recordFailure(ip) {
    const t = sql.raw("support_login_throttle");
    const stale = sql`${t}.window_started_at < now() - make_interval(mins => ${WINDOW_MINUTES})`;
    const next = sql`CASE WHEN ${stale} THEN 1 ELSE ${t}.failures + 1 END`;
    await db.execute(sql`
      INSERT INTO support_login_throttle (ip, failures, window_started_at, locked_until)
      VALUES (${ip}, 1, now(), NULL)
      ON CONFLICT (ip) DO UPDATE SET
        failures = ${next},
        window_started_at = CASE WHEN ${stale} THEN now() ELSE ${t}.window_started_at END,
        locked_until = CASE WHEN ${next} >= ${MAX_FAILURES} THEN now() + make_interval(mins => ${LOCK_MINUTES}) ELSE ${t}.locked_until END`);
  },

  async clear(ip) {
    await db.delete(supportLoginThrottle).where(eq(supportLoginThrottle.ip, ip));
  },
};
