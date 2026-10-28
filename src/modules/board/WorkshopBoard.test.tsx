import { act, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardRow, BoardSnapshot } from "./shape";
import { WorkshopBoard } from "./WorkshopBoard";

const GENERATED_AT = "2026-10-26T15:00:00.000Z";
const row = (over: Partial<BoardRow> & Pick<BoardRow, "status" | "statusLabel">): BoardRow => ({
  plate: "AB1234",
  make: "Toyota",
  model: "Hilux",
  holdReason: null,
  technicians: [],
  statusSince: "2026-10-26T14:48:00.000Z",
  urgent: false,
  ...over,
});
const SNAPSHOT: BoardSnapshot = {
  generatedAt: GENERATED_AT,
  rows: [
    row({ status: "open", statusLabel: "Recibida", plate: "OP0001", statusSince: "2026-10-26T14:48:00.000Z" }),
    row({ status: "in_progress", statusLabel: "En progreso", plate: "IP0001", technicians: ["Ana", "Beto"], statusSince: "2026-10-26T12:00:00.000Z" }),
    row({ status: "on_hold", statusLabel: "En espera", plate: "OH0001", holdReason: "Repuesto", statusSince: "2026-10-24T15:00:00.000Z" }),
    row({
      status: "booked",
      statusLabel: "Agendada",
      plate: "Sin vehículo",
      make: null,
      model: null,
      technicians: ["Carla"],
      appointmentAt: "2026-10-27T15:00:00.000Z",
      statusSince: "2026-10-26T14:59:00.000Z",
    }),
  ],
};
const col = (name: string) => within(screen.getByRole("region", { name }));

describe("WorkshopBoard", () => {
  it("renders one column per status in the spec order and keeps the empty ones", () => {
    render(<WorkshopBoard initial={SNAPSHOT} />);

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Agendada",
      "Recibida",
      "En diagnóstico",
      "En progreso",
      "En espera",
      "Lista para revisión",
      "Completada",
    ]);
    expect(col("En diagnóstico").queryAllByRole("listitem")).toHaveLength(0);
    expect(col("Completada").queryAllByRole("listitem")).toHaveLength(0);
  });

  it("Booked order without a vehicle shows Sin vehículo, Agendada, the technician and the appointment time in Panama", () => {
    render(<WorkshopBoard initial={SNAPSHOT} />);

    const booked = col("Agendada");
    expect(booked.getByText("Sin vehículo")).toBeInTheDocument();
    expect(booked.getByText("Carla")).toBeInTheDocument();
    // Badge text, not colour alone: the column heading and the badge both say it.
    expect(booked.getAllByText("Agendada").length).toBeGreaterThanOrEqual(1);
    const text = booked.getByRole("listitem").textContent ?? "";
    expect(text).toContain("27/10 10:00"); // 15:00Z is 10:00 in America/Panama; digits only, so SSR and browser agree
    expect(text).not.toMatch(/15:00|3:00/); // a server-zone render would show the UTC hour
  });

  it("the 7-column grid scrolls inside its own container, so a 390 px phone never scrolls the page sideways", () => {
    render(<WorkshopBoard initial={SNAPSHOT} />);

    const grid = screen.getAllByRole("region")[0].parentElement!;
    expect(grid.parentElement).toHaveClass("overflow-x-auto");
    expect(grid).toHaveClass("grid-cols-7");
  });

  it("non-booked rows show no appointment time", () => {
    const withStray = { ...SNAPSHOT, rows: [row({ status: "open", statusLabel: "Recibida", appointmentAt: "2026-10-27T15:00:00.000Z" })] };
    render(<WorkshopBoard initial={withStray} />);

    expect(col("Recibida").getByRole("listitem").textContent).not.toMatch(/10:00/);
  });

  it("shows the hold reason only on an on_hold row", () => {
    const stray = { ...SNAPSHOT, rows: [...SNAPSHOT.rows, row({ status: "in_progress", statusLabel: "En progreso", plate: "IP0002", holdReason: "STRAY_REASON" })] };
    render(<WorkshopBoard initial={stray} />);

    expect(col("En espera").getByText("Repuesto")).toBeInTheDocument();
    expect(screen.queryByText("STRAY_REASON")).not.toBeInTheDocument();
  });

  it("shows technicians and ages computed from generatedAt, not the live clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00Z")); // years later: a live-clock age would read thousands of days
    try {
      render(<WorkshopBoard initial={SNAPSHOT} />);

      expect(col("En progreso").getByText("Ana, Beto")).toBeInTheDocument();
      expect(col("Recibida").getByText("12 min")).toBeInTheDocument();
      expect(col("En progreso").getByText("3 h")).toBeInTheDocument();
      expect(col("En espera").getByText("2 d")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("carries no control: no button, form, link or input", () => {
    const { container } = render(<WorkshopBoard initial={SNAPSHOT} />);
    expect(container.querySelector("button, form, a, input, select, textarea")).toBeNull();
  });

  it("an urgent row carries the Urgente badge (icon + text) and a calm row does not; no card ever says it lacks a category", () => {
    const urgent = { ...SNAPSHOT, rows: [row({ status: "in_progress", statusLabel: "En progreso", plate: "UR0001", urgent: true }), row({ status: "in_progress", statusLabel: "En progreso", plate: "CA0001" })] };
    const { container } = render(<WorkshopBoard initial={urgent} />);

    const [first, second] = col("En progreso").getAllByRole("listitem");
    expect(within(first).getByText("Urgente")).toBeInTheDocument();
    expect(within(second).queryByText("Urgente")).not.toBeInTheDocument();
    expect(first).toHaveClass("border-urgent/45"); // the red edge, beside the word
    expect(second).not.toHaveClass("border-urgent/45");
    expect(container.textContent).not.toMatch(/falta/i);
  });

  it("technicians are initials for the eye and one sr-only span with the full names", () => {
    render(<WorkshopBoard initial={SNAPSHOT} />);

    expect(col("En progreso").getByText("Ana, Beto")).toHaveClass("sr-only");
    expect(col("En progreso").getByText("A").closest("[aria-hidden]")).not.toBeNull();
    expect(col("Recibida").getByText("Sin técnico")).toBeInTheDocument();
  });

  it("the hold reason sits in the amber strip, and an overdue appointment says how long ago", () => {
    const overdue = row({ status: "booked", statusLabel: "Agendada", plate: "BK0001", appointmentAt: "2026-10-26T13:00:00.000Z" });
    render(<WorkshopBoard initial={{ ...SNAPSHOT, rows: [...SNAPSHOT.rows, overdue] }} />);

    expect(col("En espera").getByText("Repuesto").closest("div")).toHaveClass("border-board-warn-border");
    expect(col("Agendada").getByText("Cita vencida · hace 2 h")).toBeInTheDocument();
  });

  it("each column header counts its cards", () => {
    render(<WorkshopBoard initial={SNAPSHOT} />);

    expect(col("En progreso").getByText("1")).toBeInTheDocument();
    expect(col("Completada").getByText("0")).toBeInTheDocument();
  });

  describe("live polling", () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
      fetchMock.mockReset();
      vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("polls /api/board and shows the new rows", async () => {
      const next: BoardSnapshot = { generatedAt: "2026-10-26T15:00:30.000Z", rows: [row({ status: "open", statusLabel: "Recibida", plate: "ZZ0001" })] };
      fetchMock.mockImplementation(async () => new Response(JSON.stringify(next), { status: 200 }));
      render(<WorkshopBoard initial={SNAPSHOT} />);

      await act(() => vi.advanceTimersByTimeAsync(30_000));

      expect(fetchMock).toHaveBeenCalledWith("/api/board", { cache: "no-store" });
      expect(screen.getByText("ZZ0001")).toBeInTheDocument();
      expect(screen.queryByText("OP0001")).not.toBeInTheDocument();
    });
  });
});

describe("insecure-context rule for the full board", () => {
  it("WorkshopBoard.tsx uses no secure-context-only API and imports only TYPES from the server-only mappers", () => {
    const file = "WorkshopBoard.tsx"; // a variable: vite rewrites `new URL("literal", import.meta.url)` into an asset URL
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).not.toMatch(/randomUUID|crypto\.subtle|wakeLock|serviceWorker|clipboard/);
    for (const line of (source.match(/^import .*$/gm) ?? []).filter((l) => /shape|snapshot|queries|node:crypto|portal-sync/.test(l))) {
      expect(line).toMatch(/^import type /);
    }
  });
});
