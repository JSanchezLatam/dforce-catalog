import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KanbanBoard } from "./KanbanBoard";

// The board toasts after a move; these tests are about layout, so the provider is not mounted.
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast: vi.fn() }) }));
import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import type { KanbanCard, KanbanSnapshot } from "./shape";

const GENERATED_AT = "2026-10-26T15:00:00.000Z"; // 10:00 in Panama
// A wire-shaped card (kanban/shape.ts); the id doubles as the plate.
const card = (id: string, status: OrderStatus, over: Partial<KanbanCard> = {}): KanbanCard => ({
  id, status, statusLabel: ORDER_STATUS_LABEL[status], plate: id, make: "Toyota", model: "Hilux", holdReason: null, technicians: [],
  statusSince: "2026-10-26T14:48:00.000Z", urgent: false, categoria: null, missing: [], mine: false, ...over,
});
const ROWS: KanbanCard[] = [
  card("BK", "booked", { appointmentAt: "2026-10-26T14:00:00.000Z" }),
  card("OP", "open"),
  // Older than IP2, so only the board's own sort puts the urgent IP2 first.
  card("IP1", "in_progress", { technicians: ["Ana"], mine: true, statusSince: "2026-10-26T12:00:00.000Z" }),
  card("IP2", "in_progress", { urgent: true, statusSince: "2026-10-26T14:00:00.000Z" }),
  card("OH", "on_hold", { holdReason: "Repuesto", statusSince: "2026-10-23T15:00:00.000Z" }),
  card("DN", "done", { statusSince: "2026-10-26T14:30:00.000Z" }),
  card("CX", "cancelled"),
];
const snapshot = (over: Partial<KanbanSnapshot> = {}): KanbanSnapshot => ({ generatedAt: GENERATED_AT, onRoster: true, rows: ROWS, ...over });
const col = (name: string) => within(screen.getByRole("region", { name }));
const kpi = (name: string) => group("Indicadores").getByText(name).parentElement!.children[1].textContent;
const sub = (name: string) => group("Indicadores").getByText(name).parentElement!.children[2]?.textContent;
const group = (name: string) => within(screen.getByRole("group", { name }));
const plates = (name: string) => col(name).getAllByRole("listitem").map((li) => li.querySelector(".font-extrabold")?.textContent);

describe("KanbanBoard", () => {
  it("renders seven columns in the spec order, never Cancelada, with Completada coming from the snapshot", () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Agendada", "Recibida", "En diagnóstico", "En progreso", "En espera", "Lista para revisión", "Completada",
    ]);
    expect(screen.queryByText("CX")).toBeNull();
    expect(plates("Completada")).toEqual(["DN"]);
    expect(col("En diagnóstico").getByText("Sin órdenes")).toBeInTheDocument();
  });

  it("captions each KPI from the snapshot, and leaves a caption out when it has no data", () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    const labels = ["En el taller", "Urgentes", "En espera", "Completadas hoy", "Agendadas hoy", "Citas vencidas"];
    // The only booked card (09:00) is already behind generatedAt (10:00), so there is no "próxima".
    expect(labels.map(sub)).toEqual(["en 3 estados", "marcadas a mano", "repuesto", "última 09:30", undefined, "desde 09:00"]);
  });

  it("decorates the column scroller with an aria-hidden right-edge fade that cannot take a click", () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    const fade = screen.getByRole("region", { name: "Agendada" }).parentElement!.nextElementSibling!;
    expect(fade).toHaveAttribute("aria-hidden", "true");
    expect(fade).toHaveClass("pointer-events-none");
  });

  it("tints each phone tab with its status tile", () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    const tab = group("Estados").getByRole("button", { name: /^En progreso/ });
    expect(tab.querySelector(".board-hue-tile")).not.toBeNull();
    expect(group("Estados").getAllByRole("button").every((b) => b.querySelector(".board-hue-tile"))).toBe(true);
  });

  it("the Actualizar button is 44x44 and re-reads the snapshot now", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => snapshot() });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<KanbanBoard initial={snapshot()} canMove />);
      const btn = screen.getByRole("button", { name: "Actualizar" });
      expect(btn).toHaveClass("size-11");
      expect(fetchMock).not.toHaveBeenCalled();
      await userEvent.click(btn);
      expect(fetchMock).toHaveBeenCalledWith("/api/kanban", expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("tells a mover that dragging works and leaves the técnico on the read-only line", () => {
    const { rerender } = render(<KanbanBoard initial={snapshot()} canMove />);
    expect(screen.getByText("Arrastrá una tarjeta a otra columna para cambiar su estado.")).toHaveClass("max-md:hidden");
    // The phone has no drag (the grip is hidden below md), so it reads the neutral line instead.
    expect(screen.getByText("Estado de las órdenes del taller.")).toHaveClass("md:hidden");
    rerender(<KanbanBoard initial={snapshot()} canMove={false} />);
    expect(screen.queryByText(/Arrastrá/)).toBeNull();
    expect(screen.getByText("Estado de las órdenes del taller. Los cambios de estado los hace el jefe de taller.")).toBeInTheDocument();
  });

  it("puts the urgent card first in its column, ahead of an older one", () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    expect(plates("En progreso")).toEqual(["IP2", "IP1"]);
    expect(col("En progreso").getAllByText("Urgente")).toHaveLength(1);
  });

  it("shows the six KPIs from the whole set, in order, and a filter leaves them unchanged", async () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    const labels = ["En el taller", "Urgentes", "En espera", "Completadas hoy", "Agendadas hoy", "Citas vencidas"];
    expect(labels.map(kpi)).toEqual(["4", "1", "1", "1", "1", "1"]);
    await userEvent.click(group("Filtros").getByRole("button", { name: /^Urgentes/ }));
    expect(labels.map(kpi)).toEqual(["4", "1", "1", "1", "1", "1"]);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("filter chips carry counts and aria-pressed; Mis órdenes narrows and an empty column then reads Ninguna orden tuya en este estado", async () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    const chip = (n: string) => group("Filtros").getByRole("button", { name: new RegExp(`^${n}`) });
    expect(chip("Todas")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Todas")).toHaveTextContent("6");
    expect(chip("Mis órdenes")).toHaveTextContent("1");
    await userEvent.click(chip("Mis órdenes"));
    expect(chip("Mis órdenes")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Todas")).toHaveAttribute("aria-pressed", "false");
    expect(plates("En progreso")).toEqual(["IP1"]);
    expect(col("En espera").getByText("Ninguna orden tuya en este estado")).toBeInTheDocument();
  });

  it("hides Mis órdenes without a roster row and marks only the viewer's card Asignada a vos", () => {
    const { unmount } = render(<KanbanBoard initial={snapshot({ onRoster: false })} canMove />);
    expect(group("Filtros").queryByRole("button", { name: /^Mis órdenes/ })).toBeNull();
    unmount();
    render(<KanbanBoard initial={snapshot()} canMove />);
    expect(screen.getAllByText("Asignada a vos")).toHaveLength(1);
  });

  it("shows Solo lectura only when the viewer cannot move orders", () => {
    const { rerender } = render(<KanbanBoard initial={snapshot()} canMove={false} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Solo lectura");
    rerender(<KanbanBoard initial={snapshot()} canMove />);
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent("Solo lectura");
  });

  describe("scrolling", () => {
    const scrollTo = vi.fn();
    const scrollBy = vi.fn();
    beforeEach(() => {
      HTMLElement.prototype.scrollTo = scrollTo;
      HTMLElement.prototype.scrollBy = scrollBy;
      // jsdom has no layout: a column's offsetLeft is its index times 300.
      vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
        return this.parentElement ? [...this.parentElement.children].indexOf(this) * 300 : 0;
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it("the desktop arrows scroll the columns container, not the page", async () => {
      render(<KanbanBoard initial={snapshot()} canMove />);
      await userEvent.click(screen.getByRole("button", { name: "Columnas siguientes" }));
      await userEvent.click(screen.getByRole("button", { name: "Columnas anteriores" }));
      expect(scrollBy.mock.calls.map(([o]) => Math.sign(o.left))).toEqual([1, -1]);
    });

    it("phone tabs show the counts, jump to their column, and follow the scroll", async () => {
      render(<KanbanBoard initial={snapshot()} canMove />);
      const tab = (n: string) => group("Estados").getByRole("button", { name: new RegExp(`^${n}`) });
      expect(tab("En progreso")).toHaveTextContent("2");
      expect(tab("Agendada")).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(tab("En espera"));
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 4 * 300 }));
      expect(tab("En espera")).toHaveAttribute("aria-pressed", "true");
      const scroller = screen.getByRole("region", { name: "Agendada" }).parentElement!;
      fireEvent.scroll(scroller, { target: { scrollLeft: 600 } });
      expect(tab("En diagnóstico")).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("live updates", () => {
    beforeEach(() => vi.useFakeTimers({ now: new Date(GENERATED_AT) }));
    afterEach(() => (vi.useRealTimers(), vi.unstubAllGlobals()));

    it("says the snapshot is fresh, then how old it is, and after failed polls keeps the cards and shows Sin conexión", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      render(<KanbanBoard initial={snapshot()} canMove />);
      expect(screen.getByText("Actualizado hace menos de 30 s")).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(100_000));
      expect(screen.getByText("Actualizado hace 100 s")).toBeInTheDocument();
      // dnd-kit's own (empty) live region is a role=status too, so look through all of them for the banner.
      expect(screen.getAllByRole("status").map((e) => e.textContent)).toContain("Sin conexión · actualizado hace 1 min");
      expect(plates("En progreso")).toEqual(["IP2", "IP1"]);
    });
  });
});
