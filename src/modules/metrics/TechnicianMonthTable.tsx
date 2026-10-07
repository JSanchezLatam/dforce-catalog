import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TecnicoMonthRow } from "./shape";

const HOURS = new Intl.NumberFormat("es-PA", { maximumFractionDigits: 1 });

/**
 * Per-technician month: closed orders and hours logged. Three narrow columns stay
 * legible at 390px, so there is no card list; the table's own container scrolls
 * if a name is ever too long. The empty states say what to do, not "nothing here".
 */
export function TechnicianMonthTable({
  rows,
  mesLabel,
  canManageTechnicians,
}: {
  rows: TecnicoMonthRow[];
  mesLabel: string;
  canManageTechnicians: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay técnicos activos. Agregalos en{" "}
        {canManageTechnicians ? (
          <Link href="/technicians" className="underline underline-offset-4">
            Técnicos
          </Link>
        ) : (
          "Técnicos"
        )}
        .
      </p>
    );
  }

  const sorted = [...rows].sort((a, b) => b.closed - a.closed || b.hours - a.hours);
  const noneClosed = sorted.every((r) => r.closed === 0);

  return (
    <div className="flex flex-col gap-3">
      {noneClosed && (
        <p className="text-sm text-muted-foreground">
          Todavía no hay órdenes cerradas en {mesLabel}. Una orden cuenta cuando pasa a Completada.
        </p>
      )}
      <Card size="sm">
        <CardContent>
          <Table aria-label={`Productividad por técnico — ${mesLabel}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Técnico</TableHead>
                <TableHead className="text-right">Órdenes cerradas</TableHead>
                <TableHead className="text-right">Horas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow key={row.tecnicoId}>
                  <TableCell className="whitespace-normal font-medium">{row.nombre}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.closed}</TableCell>
                  <TableCell className="text-right tabular-nums">{HOURS.format(row.hours)} h</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Una orden con varios técnicos cuenta para cada uno.</p>
    </div>
  );
}
