import * as Sentry from "@sentry/nextjs";

import { can } from "@/modules/auth/policy";
import type { SessionUser } from "@/modules/auth/session";
import { getDueVencimientos } from "@/modules/vencimientos/service";

/**
 * Counts for the sidebar, keyed by href (`getNavGroups`'s second argument).
 * The Vencimientos count is `getDueVencimientos(now).count` — the same call
 * the page renders its rows from — and a viewer without `vencimientos.read`
 * never triggers the query.
 *
 * A badge is decoration on every page of the shell, so a failing due query
 * degrades to "no badge" instead of taking the whole `(app)` layout down. The
 * failure is reported to Sentry (the repo's reporter, as `withJobCapture`
 * does) and the report itself is guarded: it must not fail the layout either.
 */
export async function getNavBadges(
  user: SessionUser,
  now: Date = new Date(),
  getDue: (now: Date) => Promise<{ count: number }> = getDueVencimientos,
  report: (error: unknown, context: { tags: Record<string, string> }) => void = Sentry.captureException,
): Promise<Record<string, number>> {
  if (!can(user, "vencimientos.read")) return {};
  try {
    return { "/vencimientos": (await getDue(now)).count };
  } catch (error) {
    try {
      report(error, { tags: { area: "nav-badges" } });
    } catch {
      // Reporting failed (e.g. Sentry unreachable): still no badge, still a layout.
    }
    return {};
  }
}
