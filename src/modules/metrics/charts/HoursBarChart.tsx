"use client";

import { BarChart, type BarChartDatum } from "@/components/arc/bar-chart/bar-chart";
import scope from "./arc-scope.module.css";

const NUMBER = new Intl.NumberFormat("es-PA", { maximumFractionDigits: 1 });

/**
 * Client wrapper: owns `formatValue`, so no function crosses the RSC boundary.
 * The vendored bar chart no longer rounds its average (edited in
 * `src/components/arc/bar-chart`), so `formatValue` shows one decimal; the
 * exact hours per técnico still live in the table beside the chart.
 */
export function HoursBarChart({ bars, mesLabel }: { bars: BarChartDatum[]; mesLabel: string }) {
  if (bars.every((b) => b.value === 0)) {
    return <p className="text-sm text-muted-foreground">Sin datos para este mes</p>;
  }
  return (
    <div className={scope.scope}>
      <BarChart
        label="Horas registradas por técnico"
        period={mesLabel}
        unit="h"
        averageLabel="Promedio por técnico"
        valueLabel="Horas"
        categoryLabel="Técnico"
        data={bars}
        showAverage={false}
        formatValue={(value) => NUMBER.format(value)}
      />
    </div>
  );
}
