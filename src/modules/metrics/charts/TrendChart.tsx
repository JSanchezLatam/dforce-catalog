"use client";

import { LineChart, type LineChartSeries } from "@/components/arc/line-chart/line-chart";
import scope from "./arc-scope.module.css";

export type TrendPoint = { key: string; label: string; axisLabel: string; received: number; closed: number };

const NUMBER = new Intl.NumberFormat("es-PA", { maximumFractionDigits: 1 });
// Theme tokens, not hex: the same series reads in light and dark.
const SERIES: LineChartSeries[] = [
  { key: "received", label: "Órdenes recibidas", color: "var(--chart-1)" },
  { key: "closed", label: "Órdenes cerradas", color: "var(--chart-3)", area: false },
];

/** Client wrapper: owns `formatValue`, so the page passes plain data and no function crosses the RSC boundary. `points` run oldest to newest. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.every((p) => p.received === 0 && p.closed === 0)) {
    return <p className="text-sm text-muted-foreground">Sin datos en los últimos 6 meses</p>;
  }
  return (
    <div className={scope.scope}>
      <LineChart
        label="Órdenes recibidas y cerradas por mes"
        categoryLabel="Mes"
        series={SERIES}
        data={points.map((p) => ({ key: p.key, label: p.label, axisLabel: p.axisLabel, values: { received: p.received, closed: p.closed } }))}
        formatValue={(value) => NUMBER.format(value)}
        formatTick={(value) => NUMBER.format(value)}
        height={200}
        curve="linear"
      />
    </div>
  );
}
