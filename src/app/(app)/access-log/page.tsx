import { CheckCircle, History, Lock, LockOpen, XCircle, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listUsers } from "@/modules/account/queries";
import {
  ACCESS_LOG_RESULTS,
  describeAttempt,
  parseAccessLogFilters,
  type AccessLogFilters as Filters,
  type AccessLogResult,
} from "@/modules/auth/access-log";
import { countAccessLog, listAccessLog, type AccessLogRow } from "@/modules/auth/access-log-queries";
import { AccessLogFilters } from "@/modules/auth/AccessLogFilters";
import { originOf } from "@/modules/auth/client-ip";
import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { computePageWindow } from "@/modules/inventory-view/queries";
import { formatDateTime } from "@/shared/datetime";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Pagination } from "@/shared/ui/Pagination";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import { RecordCard, RecordCardList } from "@/shared/ui/RecordCard";

const PAGE_SIZE = 25;
const COLUMNS = ["Fecha y hora", "Usuario", "Resultado", "Detalle", "Origen"];
const UNKNOWN_USER = "Usuario desconocido";

const RESULT_ICON: Record<AccessLogResult, { icon: LucideIcon; className: string }> = {
  success: { icon: CheckCircle, className: "text-success" },
  failed: { icon: XCircle, className: "text-destructive" },
  locked: { icon: Lock, className: "text-destructive" },
  unlocked: { icon: LockOpen, className: "text-muted-foreground" },
};

function ResultBadge({ result }: { result: AccessLogResult }) {
  const { icon: Icon, className } = RESULT_ICON[result];
  return (
    <Badge variant="outline">
      <Icon aria-hidden="true" className={className} />
      {ACCESS_LOG_RESULTS[result]}
    </Badge>
  );
}

/** Every filter survives paging; `{page}` stays raw for `Pagination` to replace. */
function pageHrefPattern(filters: Filters): string {
  const search = new URLSearchParams();
  if (filters.user) search.set("user", filters.user);
  if (filters.result) search.set("result", filters.result);
  search.set("days", String(filters.days));
  return `/access-log?${search.toString()}&page={page}`;
}

/** S10: administrators' log of login attempts, under Configuración. */
export default async function AccessLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSessionFromHeaders();
  if (!can(user, "users.manage")) {
    return <PermissionDenied title="Registro de accesos" />;
  }

  const params = await searchParams;
  const filters = parseAccessLogFilters(params);
  const pageWindow = computePageWindow(params.page, PAGE_SIZE);
  const [rows, total, logins] = await Promise.all([
    listAccessLog(filters, pageWindow),
    countAccessLog(filters),
    listUsers({ includeInactive: true }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const view = rows.map((row: AccessLogRow) => ({
    ...row,
    ...describeAttempt(row.outcome),
    when: formatDateTime(row.at),
    origin: originOf(row.ip),
  }));

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-8">
      <PageHeader title="Registro de accesos" description="Intentos de inicio de sesión de los últimos 90 días." />

      <Card size="sm">
        <CardContent>
          <AccessLogFilters selected={filters} usernames={logins.map((u) => u.username).sort()} />
        </CardContent>
      </Card>

      {view.length === 0 ? (
        <Card size="sm">
          <CardContent>
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <History className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No hay intentos de inicio de sesión con estos filtros.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card size="sm" className="hidden md:block" data-testid="access-log-table">
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    {COLUMNS.map((label) => (
                      <TableHead key={label}>{label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.when}</TableCell>
                      <TableCell className={row.username ? "font-medium" : "text-muted-foreground"}>
                        {row.username ?? UNKNOWN_USER}
                      </TableCell>
                      <TableCell>
                        <ResultBadge result={row.result} />
                      </TableCell>
                      <TableCell>{row.detail}</TableCell>
                      <TableCell className="text-muted-foreground">{row.origin}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <RecordCardList testId="access-log-cards">
            {view.map((row) => (
              <RecordCard key={row.id}>
                <div className="flex items-start justify-between gap-2">
                  <span className={row.username ? "font-medium" : "text-muted-foreground"}>
                    {row.username ?? UNKNOWN_USER}
                  </span>
                  <ResultBadge result={row.result} />
                </div>
                {row.detail && <span className="text-sm">{row.detail}</span>}
                <span className="text-sm text-muted-foreground">
                  {row.when} · {row.origin}
                </span>
              </RecordCard>
            ))}
          </RecordCardList>

          <Pagination currentPage={pageWindow.page} pageCount={pageCount} hrefPattern={pageHrefPattern(filters)} />
        </>
      )}
    </div>
  );
}
