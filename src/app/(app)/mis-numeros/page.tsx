import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { HoursBarChart } from "@/modules/metrics/charts/HoursBarChart";
import { monthKeys, monthLabel, parseMes } from "@/modules/metrics/months";
import { MonthSelect } from "@/modules/metrics/MonthSelect";
import { closedByTecnicoMonth, minutesByTecnicoMonth } from "@/modules/metrics/queries";
import { minutesToHours } from "@/modules/metrics/shape";
import { findTecnicoByUserId } from "@/modules/technicians/queries";
import { PageHeader } from "@/shared/ui/PageHeader";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import { SECTION_HEADING } from "@/shared/ui/styles";

const HOURS = new Intl.NumberFormat("es-PA", { maximumFractionDigits: 1 });

/**
 * A técnico's own numbers. The roster id comes ONLY from the session: `searchParams`
 * is read for `mes` and nothing else, so a forged `?tecnicoId=` has nowhere to land.
 * The queries take one window starting at the older of the 6-month trend and the
 * selected month (the select reaches 11 months back).
 */
export default async function MisNumerosPage({ searchParams }: { searchParams: Promise<{ mes?: string | string[] }> }) {
  const user = await requireSessionFromHeaders();
  if (!can(user, "metrics.self")) {
    return <PermissionDenied title="Mis números" />;
  }

  const now = new Date();
  const mes = parseMes((await searchParams).mes, now);
  const trendKeys = monthKeys(now, 6);
  const selectKeys = monthKeys(now, 12);

  const me = await findTecnicoByUserId(user.id);
  if (!me) {
    return (
      <div className="flex flex-col gap-8 p-4 sm:p-8">
        <PageHeader title="Mis números" />
        <p className="text-sm text-muted-foreground">Todavía no estás en la lista de técnicos. Pedile al jefe de taller que te agregue.</p>
      </div>
    );
  }

  const from = [mes, trendKeys[0]].sort()[0];
  const [closed, minutes] = await Promise.all([
    closedByTecnicoMonth({ from, tecnicoId: me.id }),
    minutesByTecnicoMonth({ from, tecnicoId: me.id }),
  ]);
  const closedIn = (key: string) => closed.find((r) => r.mes === key)?.n ?? 0;
  const hoursIn = (key: string) => minutesToHours(minutes.find((r) => r.mes === key)?.n ?? 0);

  // Plain data only: the client wrapper owns every formatter.
  const hoursBars = trendKeys.map((key) => ({ key, label: monthLabel(key), axisLabel: monthLabel(key).slice(0, 3), value: hoursIn(key) }));

  return (
    <div className="flex flex-col gap-8 p-4 sm:p-8">
      <PageHeader title="Mis números" actions={<MonthSelect keys={[...selectKeys].reverse()} selected={mes} />} />

      <section aria-labelledby="month-heading">
        <h2 id="month-heading" className={SECTION_HEADING}>
          {monthLabel(mes)}
        </h2>
        <Card size="sm">
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-muted-foreground">Órdenes cerradas</dt>
                <dd className="text-xl font-semibold tabular-nums">{closedIn(mes)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Horas registradas</dt>
                <dd className="text-xl font-semibold tabular-nums">{HOURS.format(hoursIn(mes))} h</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        {closedIn(mes) === 0 && <p className="mt-2 text-sm text-muted-foreground">Una orden cuenta cuando pasa a Completada.</p>}
      </section>

      <section aria-labelledby="trend-heading">
        <h2 id="trend-heading" className={SECTION_HEADING}>
          Últimos 6 meses
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card size="sm">
            <CardContent>
              <HoursBarChart
                bars={hoursBars}
                mesLabel="Últimos 6 meses"
                label="Horas registradas por mes"
                categoryLabel="Mes"
                averageLabel="Promedio por mes"
                emptyText="Sin horas registradas en los últimos 6 meses"
              />
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <Table aria-label="Últimos 6 meses">
                <TableHeader>
                  <TableRow>
                    <TableHead>Mes</TableHead>
                    <TableHead className="text-right">Cerradas</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...trendKeys].reverse().map((key) => (
                    <TableRow key={key}>
                      <TableCell>{monthLabel(key)}</TableCell>
                      <TableCell className="text-right tabular-nums">{closedIn(key)}</TableCell>
                      <TableCell className="text-right tabular-nums">{HOURS.format(hoursIn(key))} h</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
