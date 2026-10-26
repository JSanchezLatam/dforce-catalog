import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const arc = vi.hoisted(() => vi.fn());
vi.mock("@/components/arc/animated-counter/animated-counter", () => ({
  AnimatedCounter: (props: { value: number; locale?: string }) => {
    arc(props);
    return <span>{props.value}</span>;
  },
}));

import { BacklogCounters } from "./BacklogCounters";

beforeEach(() => arc.mockClear());

describe("BacklogCounters", () => {
  it("names each of the six non-terminal statuses and animates its count in es-PA, zeros included", () => {
    render(<BacklogCounters counts={{ booked: 1, open: 7, diagnosing: 3, in_progress: 0, on_hold: 0, ready_for_review: 2 }} />);

    expect(screen.getByText("Agendada").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText("Recibida").nextElementSibling).toHaveTextContent("7");
    expect(screen.getByText("En diagnóstico").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText("En progreso").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByText("En espera").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByText("Lista para revisión").nextElementSibling).toHaveTextContent("2");
    expect(arc.mock.calls.map(([p]) => [p.value, p.locale])).toEqual([
      [1, "es-PA"],
      [7, "es-PA"],
      [3, "es-PA"],
      [0, "es-PA"],
      [0, "es-PA"],
      [2, "es-PA"],
    ]);
  });

  it("is a client module taking only plain counts", () => {
    expect(readFileSync(path.join(__dirname, "BacklogCounters.tsx"), "utf8").startsWith('"use client"')).toBe(true);
  });
});
