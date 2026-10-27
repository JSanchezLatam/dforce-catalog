import { AgendaShell } from "@/modules/agenda/AgendaShell";
import { panamaDay, panamaMinute, parseAgendaParams, rangeFor } from "@/modules/agenda/dates";
import { toAgendaItem, toWeekSummary, toWorkshopItem } from "@/modules/agenda/items";
import { agendaInWorkshop, agendaOverdue, agendaRange, agendaWeekCounts } from "@/modules/agenda/queries";
import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { listTecnicos } from "@/modules/technicians/queries";
import { orderScope } from "@/modules/service-orders/scope";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";

type SearchParams = Promise<{ view?: string | string[]; date?: string | string[] }>;

export default async function AgendaPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSessionFromHeaders();
  if (!can(user, "agenda.manage")) {
    return <PermissionDenied title="Agenda" />;
  }

  // One clock for the whole render: the Vencida flag and "today" must agree.
  const now = new Date();
  const { view, date } = parseAgendaParams(await searchParams, now);
  const scope = orderScope(user);
  const [{ rows, truncated }, overdue, workshop, tecnicos, weekCounts] = await Promise.all([
    agendaRange(scope, rangeFor(view, date)),
    agendaOverdue(scope, now),
    view === "combined" ? agendaInWorkshop(scope) : null,
    can(user, "service-orders.assign") ? listTecnicos() : null,
    agendaWeekCounts(scope, rangeFor("week", date), now),
  ]);
  const items = rows.map((row) => toAgendaItem(row, now));
  const today = panamaDay(now);

  return (
    <div className="p-4 sm:p-8">
      <AgendaShell
        view={view}
        date={date}
        today={today}
        nowMinute={panamaMinute(now)}
        items={items}
        workshop={workshop ? workshop.rows.map((r) => toWorkshopItem(r, now)) : null}
        workshopTruncated={workshop?.truncated ?? false}
        roster={tecnicos ? tecnicos.map(({ id, nombre }) => ({ id, nombre })) : null}
        truncated={truncated}
        weekSummary={toWeekSummary(weekCounts)}
        overdueTotal={overdue.total}
        overdue={overdue.rows.map((row) => toAgendaItem(row, now))}
        overdueTruncated={overdue.truncated}
      />
    </div>
  );
}
