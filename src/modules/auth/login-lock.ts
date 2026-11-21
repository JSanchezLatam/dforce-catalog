/** Login lock rules: pure functions over the attempt log, no database. */
export type LoginOutcome =
  | "success"
  | "bad_password"
  | "unknown_user"
  | "inactive"
  | "locked"
  | "unlocked"
  // Right password, code still owed: neither a failure nor a reset (L28).
  | "password_ok"
  | "bad_code";

export type LockRule = {
  threshold: number;
  windowMs: number;
  /** How long each lock in a row lasts; the last entry repeats. */
  durationsMs: readonly number[];
  resetsOn: readonly LoginOutcome[];
};

const FIFTEEN_MINUTES = 15 * 60_000;
const FAILURES: readonly LoginOutcome[] = ["bad_password", "unknown_user", "inactive", "bad_code"];

/** 15 minutes, then 1 hour, then until an administrator unlocks (S6); a success or an unlock starts over. */
export const USER_LOCK: LockRule = {
  threshold: 5,
  windowMs: FIFTEEN_MINUTES,
  durationsMs: [FIFTEEN_MINUTES, 4 * FIFTEEN_MINUTES, Infinity],
  resetsOn: ["success", "unlocked"],
};
/** A success does not clear an IP: one valid account must not reset a guessing run from that address. */
export const IP_LOCK: LockRule = { threshold: 20, windowMs: FIFTEEN_MINUTES, durationsMs: [FIFTEEN_MINUTES], resetsOn: [] };

/**
 * The end of a lock only an administrator can lift: the latest instant a Date
 * holds. Callers compare against it with `isUntilUnlocked` and never wait on it
 * (a `setTimeout` past 2^31 ms fires at once).
 */
export const UNTIL_UNLOCKED = new Date(8.64e15);
export const isUntilUnlocked = (until: Date): boolean => until.getTime() === UNTIL_UNLOCKED.getTime();

/** An IP lock still active now began from failures at most two windows old. */
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
  let locks = 0;

  for (const { at, outcome } of [...attempts].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (rule.resetsOn.includes(outcome)) {
      failures = [];
      until = null;
      locks = 0;
    } else if (FAILURES.includes(outcome) && (until === null || at.getTime() >= until)) {
      failures.push(at.getTime());
      const first = failures[failures.length - rule.threshold];
      if (first !== undefined && at.getTime() - first <= rule.windowMs) {
        until = at.getTime() + rule.durationsMs[Math.min(locks, rule.durationsMs.length - 1)];
        locks += 1;
        failures = [];
      }
    }
  }

  if (until === null || until <= now.getTime()) return null;
  return until === Infinity ? UNTIL_UNLOCKED : new Date(until);
}
