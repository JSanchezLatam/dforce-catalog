import { can } from "@/modules/auth/policy";
import type { SessionUser } from "@/modules/auth/session";
import { getDueVencimientos } from "@/modules/vencimientos/service";

/**
 * Counts for the sidebar, keyed by href (`getNavGroups`'s second argument).
 * The Vencimientos count is `getDueVencimientos(now).count` — the same call
 * the page renders its rows from — and a viewer without `vencimientos.read`
 * never triggers the query.
 */
export async function getNavBadges(
  user: SessionUser,
  now: Date = new Date(),
  getDue: (now: Date) => Promise<{ count: number }> = getDueVencimientos,
): Promise<Record<string, number>> {
  if (!can(user, "vencimientos.read")) return {};
  return { "/vencimientos": (await getDue(now)).count };
}
