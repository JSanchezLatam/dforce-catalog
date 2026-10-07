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
  it("names each open status and animates its count in es-PA, zeros included", () => {
    render(<BacklogCounters counts={{ open: 7, in_progress: 0, ready_for_review: 2 }} />);

    expect(screen.getByText("Abiertas").nextElementSibling).toHaveTextContent("7");
    expect(screen.getByText("En progreso").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByText("Lista para revisión").nextElementSibling).toHaveTextContent("2");
    expect(arc.mock.calls.map(([p]) => [p.value, p.locale])).toEqual([
      [7, "es-PA"],
      [0, "es-PA"],
      [2, "es-PA"],
    ]);
  });

  it("is a client module taking only plain counts", () => {
    expect(readFileSync(path.join(__dirname, "BacklogCounters.tsx"), "utf8").startsWith('"use client"')).toBe(true);
  });
});
