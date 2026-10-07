import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const arc = vi.hoisted(() => vi.fn((props: unknown) => (props ? null : null)));
vi.mock("@/components/arc/line-chart/line-chart", () => ({ LineChart: arc }));

import { TrendChart } from "./TrendChart";

const points = [
  { key: "2026-09", label: "Septiembre 2026", axisLabel: "Sep", received: 20, closed: 0 },
  { key: "2026-10", label: "Octubre 2026", axisLabel: "Oct", received: 12, closed: 9 },
];

beforeEach(() => arc.mockClear());

describe("TrendChart", () => {
  it("hands Arc two named series and the months oldest first", () => {
    render(<TrendChart points={points} />);

    const props = arc.mock.calls[0][0] as {
      data: { key: string; label: string; axisLabel: string; values: Record<string, number> }[];
      series: { key: string; label: string }[];
    };
    expect(props.series.map((s) => [s.key, s.label])).toEqual([
      ["received", "Órdenes recibidas"],
      ["closed", "Órdenes cerradas"],
    ]);
    expect(props.data.map((d) => d.key)).toEqual(["2026-09", "2026-10"]);
    expect(props.data[1]).toEqual({ key: "2026-10", label: "Octubre 2026", axisLabel: "Oct", values: { received: 12, closed: 9 } });
  });

  it("colours the series from the theme's chart tokens so both themes read", () => {
    render(<TrendChart points={points} />);

    const { series } = arc.mock.calls[0][0] as { series: { color: string }[] };
    expect(series.map((s) => s.color)).toEqual(["var(--chart-1)", "var(--chart-3)"]);
  });

  it("owns the number formatting: es-PA, so the function never crosses the RSC boundary", () => {
    render(<TrendChart points={points} />);

    const { formatValue } = arc.mock.calls[0][0] as { formatValue: (v: number) => string };
    expect(formatValue(1234.5)).toBe("1,234.5");
    expect(readFileSync(path.join(__dirname, "TrendChart.tsx"), "utf8").startsWith('"use client"')).toBe(true);
  });

  it("says there is no data instead of drawing an empty chart", () => {
    render(<TrendChart points={points.map((p) => ({ ...p, received: 0, closed: 0 }))} />);

    expect(screen.getByText("Sin datos en los últimos 6 meses")).toBeInTheDocument();
    expect(arc).not.toHaveBeenCalled();
  });
});
