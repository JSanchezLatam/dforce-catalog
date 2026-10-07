import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const arc = vi.hoisted(() => vi.fn((props: unknown) => (props ? null : null)));
vi.mock("@/components/arc/bar-chart/bar-chart", () => ({ BarChart: arc }));

import { HoursBarChart } from "./HoursBarChart";

const bars = [
  { key: "t-1", label: "Luis Pérez", axisLabel: "Luis", value: 4.5 },
  { key: "t-2", label: "Zoe", axisLabel: "Zoe", value: 1 },
];

beforeEach(() => arc.mockClear());

describe("HoursBarChart", () => {
  it("hands Arc one bar per técnico for the selected month, in hours", () => {
    render(<HoursBarChart bars={bars} mesLabel="Octubre 2026" />);

    const props = arc.mock.calls[0][0] as { data: unknown; period: string; unit: string; categoryLabel: string };
    expect(props.data).toEqual(bars);
    expect(props.period).toBe("Octubre 2026");
    expect(props.unit).toBe("h");
    expect(props.categoryLabel).toBe("Técnico");
  });

  it("takes the labels and empty text from the caller, defaulting to the per-técnico copy", () => {
    render(<HoursBarChart bars={bars} mesLabel="Últimos 6 meses" label="Horas por mes" categoryLabel="Mes" averageLabel="Promedio por mes" />);
    const props = arc.mock.calls[0][0] as { label: string; categoryLabel: string; averageLabel: string };
    expect([props.label, props.categoryLabel, props.averageLabel]).toEqual(["Horas por mes", "Mes", "Promedio por mes"]);

    render(<HoursBarChart bars={[]} mesLabel="x" emptyText="Sin horas" />);
    expect(screen.getByText("Sin horas")).toBeInTheDocument();
  });

  it("owns the number formatting in es-PA and is a client module", () => {
    render(<HoursBarChart bars={bars} mesLabel="Octubre 2026" />);

    const { formatValue } = arc.mock.calls[0][0] as { formatValue: (v: number) => string };
    expect(formatValue(1234.5)).toBe("1,234.5");
    expect(readFileSync(path.join(__dirname, "HoursBarChart.tsx"), "utf8").startsWith('"use client"')).toBe(true);
  });

  it.each([[[]], [[{ key: "t-1", label: "Luis", axisLabel: "Luis", value: 0 }]]])("says the month has no data for %j", (empty) => {
    render(<HoursBarChart bars={empty} mesLabel="Octubre 2026" />);

    expect(screen.getByText("Sin datos para este mes")).toBeInTheDocument();
    expect(arc).not.toHaveBeenCalled();
  });
});
