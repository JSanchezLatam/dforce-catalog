import { eq, sql } from "drizzle-orm";

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
  /** Counts this attempt as a failure and says whether it may be compared. */
  registerAttempt(ip: string): Promise<boolean>;
  /** A correct password forgets the IP. */
  clear(ip: string): Promise<void>;
}

// Time comparisons use the database clock, so instances with skewed clocks agree.
export const dbThrottleStore: ThrottleStore = {
  // ONE statement, atomic per row: concurrent attempts serialize on the row lock and each gets its
  // own count. An attempt is counted as a failure up front (a success deletes the row), so the
  // 5th is still compared and sets the lock; the 6th and later only keep counting and are refused
  // (locked_until is set once, never extended). A stale window restarts the count at 1.
  // Every right-hand side reads the pre-update row, hence the repeated CASE.
  async registerAttempt(ip) {
    const t = sql.raw("support_login_throttle");
    const locked = sql`COALESCE(${t}.locked_until > now(), false)`;
    // A live lock outlasts the window: the count only restarts once the lock is over too.
    const stale = sql`(${t}.window_started_at < now() - make_interval(mins => ${WINDOW_MINUTES}) AND NOT ${locked})`;
    const next = sql`CASE WHEN ${stale} THEN 1 ELSE ${t}.failures + 1 END`;
    const result = await db.execute<{ failures: number }>(sql`
      INSERT INTO support_login_throttle (ip, failures, window_started_at, locked_until)
      VALUES (${ip}, 1, now(), NULL)
      ON CONFLICT (ip) DO UPDATE SET
        failures = ${next},
        window_started_at = CASE WHEN ${stale} THEN now() ELSE ${t}.window_started_at END,
        locked_until = CASE WHEN ${next} >= ${MAX_FAILURES} AND NOT ${locked}
          THEN now() + make_interval(mins => ${LOCK_MINUTES}) ELSE ${t}.locked_until END
      RETURNING failures`);
    return Number(result.rows[0].failures) <= MAX_FAILURES;
  },

  async clear(ip) {
    await db.delete(supportLoginThrottle).where(eq(supportLoginThrottle.ip, ip));
  },
};
