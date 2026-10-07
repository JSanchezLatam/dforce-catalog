import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { BacklogCounters } from "@/modules/metrics/charts/BacklogCounters";
import { HoursBarChart } from "@/modules/metrics/charts/HoursBarChart";
import { TrendChart } from "@/modules/metrics/charts/TrendChart";
import { monthKeys, monthLabel, parseMes } from "@/modules/metrics/months";
import { MonthSelect } from "@/modules/metrics/MonthSelect";
import { backlogByStatus, closedByMonth, closedByTecnicoMonth, minutesByTecnicoMonth, receivedByMonth } from "@/modules/metrics/queries";
import { fillBacklog, fillMonths, shapeTechnicianMonth } from "@/modules/metrics/shape";
import { TechnicianMonthTable } from "@/modules/metrics/TechnicianMonthTable";
import { listTecnicos } from "@/modules/technicians/queries";
import { PageHeader } from "@/shared/ui/PageHeader";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import { SECTION_HEADING } from "@/shared/ui/styles";

/**
 * Thin RSC: authorize, query, shape, hand plain data to presentational pieces.
 * `?mes` is user input and `parseMes` is the only way it reaches a query. The
 * trend is the last 6 workshop months; the per-technician table is the selected
 * one, which the 12-month select can place up to 11 months back.
 */
export default async function MetricsPage({ searchParams }: { searchParams: Promise<{ mes?: string | string[] }> }) {
  const user = await requireSessionFromHeaders();
  if (!can(user, "metrics.read")) {
    return <PermissionDenied title="Métricas" />;
  }

  const now = new Date();
  const mes = parseMes((await searchParams).mes, now);
  const trendKeys = monthKeys(now, 6);
  const trendFrom = trendKeys[0];

  const [backlog, received, closed, closedByTecnico, minutesByTecnico, roster] = await Promise.all([
    backlogByStatus(),
    receivedByMonth({ from: trendFrom }),
    closedByMonth({ from: trendFrom }),
    closedByTecnicoMonth({ from: mes }),
    minutesByTecnicoMonth({ from: mes }),
    listTecnicos({ includeInactive: true }),
  ]);

  const receivedByKey = new Map(fillMonths(trendKeys, received).map((m) => [m.key, m.value]));
  const closedByKey = new Map(fillMonths(trendKeys, closed).map((m) => [m.key, m.value]));
  const technicians = shapeTechnicianMonth({
    roster: roster.map((t) => ({ id: t.id, nombre: t.nombre, active: t.deactivatedAt === null })),
    closed: closedByTecnico,
    minutes: minutesByTecnico,
    mes,
  });

  // Plain data only: the client wrappers own every formatter.
  const trendPoints = trendKeys.map((key) => ({
    key,
    label: monthLabel(key),
    axisLabel: monthLabel(key).slice(0, 3),
    received: receivedByKey.get(key) ?? 0,
    closed: closedByKey.get(key) ?? 0,
  }));
  const hoursBars = [...technicians]
    .sort((a, b) => b.hours - a.hours)
    .map((t) => ({ key: t.tecnicoId, label: t.nombre, axisLabel: t.nombre.split(" ")[0], value: t.hours }));

  return (
    <div className="flex flex-col gap-8 p-4 sm:p-8">
      <PageHeader title="Métricas" actions={<MonthSelect keys={monthKeys(now, 12).reverse()} selected={mes} />} />

      <section aria-labelledby="backlog-heading">
        <h2 id="backlog-heading" className={SECTION_HEADING}>
          Órdenes abiertas ahora
        </h2>
        <BacklogCounters counts={fillBacklog(backlog)} />
      </section>

      <section aria-labelledby="trend-heading">
        <h2 id="trend-heading" className={SECTION_HEADING}>
          Recibidas y cerradas
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card size="sm">
            <CardContent>
              <TrendChart points={trendPoints} />
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <Table aria-label="Recibidas y cerradas, últimos 6 meses">
                <TableHeader>
                  <TableRow>
                    <TableHead>Mes</TableHead>
                    <TableHead className="text-right">Recibidas</TableHead>
                    <TableHead className="text-right">Cerradas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...trendKeys].reverse().map((key) => (
                    <TableRow key={key}>
                      <TableCell>{monthLabel(key)}</TableCell>
                      <TableCell className="text-right tabular-nums">{receivedByKey.get(key)}</TableCell>
                      <TableCell className="text-right tabular-nums">{closedByKey.get(key)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="technicians-heading">
        <h2 id="technicians-heading" className={SECTION_HEADING}>
          Productividad por técnico — {monthLabel(mes)}
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card size="sm">
            <CardContent>
              <HoursBarChart bars={hoursBars} mesLabel={monthLabel(mes)} />
            </CardContent>
          </Card>
          <TechnicianMonthTable rows={technicians} mesLabel={monthLabel(mes)} canManageTechnicians={can(user, "technicians.manage")} />
        </div>
      </section>
    </div>
  );
}
