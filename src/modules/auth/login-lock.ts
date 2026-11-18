/** Login lock rules: pure functions over the attempt log, no database. */
export type LoginOutcome = "success" | "bad_password" | "unknown_user" | "inactive" | "locked" | "unlocked";

export type LockRule = {
  threshold: number;
  windowMs: number;
  resetsOn: readonly LoginOutcome[];
};

const FIFTEEN_MINUTES = 15 * 60_000;
const FAILURES: readonly LoginOutcome[] = ["bad_password", "unknown_user", "inactive"];

export const USER_LOCK: LockRule = { threshold: 5, windowMs: FIFTEEN_MINUTES, resetsOn: ["success", "unlocked"] };
/** A success does not clear an IP: one valid account must not reset a guessing run from that address. */
export const IP_LOCK: LockRule = { threshold: 20, windowMs: FIFTEEN_MINUTES, resetsOn: [] };

/** A lock still active now began from failures at most two windows old. */
export const LOOKBACK_MS = 2 * FIFTEEN_MINUTES;

/** Exactly as typed: usernames are case-sensitive, so `Ana` and `ana` keep separate counters. */
export const loginKey = (username: string): string => username.slice(0, 150);

/** When the current lock ends, or `null` when these attempts leave the login open. */
export function lockedUntil(
  attempts: readonly { at: Date; outcome: LoginOutcome }[],
  now: Date,
  rule: LockRule,
): Date | null {
  let failures: number[] = [];
  let until: number | null = null;

  for (const { at, outcome } of [...attempts].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (rule.resetsOn.includes(outcome)) {
      failures = [];
      until = null;
    } else if (FAILURES.includes(outcome) && (until === null || at.getTime() >= until)) {
      failures.push(at.getTime());
      const first = failures[failures.length - rule.threshold];
      if (first !== undefined && at.getTime() - first <= rule.windowMs) {
        until = at.getTime() + rule.windowMs;
        failures = [];
      }
    }
  }

  return until !== null && until > now.getTime() ? new Date(until) : null;
}
