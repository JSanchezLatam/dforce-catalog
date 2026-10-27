import { AgendaHeader } from "@/modules/agenda/AgendaHeader";
import { CombinedView } from "@/modules/agenda/CombinedView";
import { DayView } from "@/modules/agenda/DayView";
import { panamaDay, parseAgendaParams, rangeFor } from "@/modules/agenda/dates";
import { toAgendaItem, toWorkshopItem } from "@/modules/agenda/items";
import { MonthView } from "@/modules/agenda/MonthView";
import { agendaInWorkshop, agendaOverdue, agendaRange } from "@/modules/agenda/queries";
import { ItemActions } from "@/modules/agenda/ItemActions";
import { VencidasPanel } from "@/modules/agenda/VencidasPanel";
import { WeekView } from "@/modules/agenda/WeekView";
import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { orderScope } from "@/modules/service-orders/scope";
import { PageHeader } from "@/shared/ui/PageHeader";
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
  const [{ rows, truncated }, overdue, workshop] = await Promise.all([
    agendaRange(scope, rangeFor(view, date)),
    agendaOverdue(scope, now),
    view === "combined" ? agendaInWorkshop(scope) : null,
  ]);
  const items = rows.map((row) => toAgendaItem(row, now));
  const today = panamaDay(now);

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="Agenda" />
      <AgendaHeader view={view} date={date} today={today} truncated={truncated} />
      {view === "month" ? (
        <MonthView date={date} today={today} items={items} />
      ) : view === "week" ? (
        <WeekView date={date} today={today} items={items} />
      ) : view === "combined" && workshop ? (
        <CombinedView items={items} workshop={workshop.rows.map(toWorkshopItem)} workshopTruncated={workshop.truncated} />
      ) : (
        <DayView items={items} date={date} />
      )}
      <VencidasPanel items={overdue.rows.map((row) => toAgendaItem(row, now))} total={overdue.total} truncated={overdue.truncated} actions={(item) => <ItemActions item={item} />} />
    </div>
  );
}
