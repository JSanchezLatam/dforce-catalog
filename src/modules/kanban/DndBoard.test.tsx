import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { DndBoard } from "./DndBoard";
import { KanbanBoard } from "./KanbanBoard";
import type { KanbanCard, KanbanSnapshot } from "./shape";

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast }) }));

const card = (id: string, status: OrderStatus): KanbanCard => ({
  id, status, statusLabel: ORDER_STATUS_LABEL[status], plate: id, make: "Toyota", model: "Hilux", holdReason: null, technicians: [],
  statusSince: "2026-10-26T14:48:00.000Z", urgent: false, categoria: null, missing: [], mine: false,
});
const snapshot = (): KanbanSnapshot => ({ generatedAt: "2026-10-26T15:00:00.000Z", onRoster: false, rows: [card("DG", "diagnosing"), card("IP", "in_progress")] });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const orden = { id: "o1", status: "in_progress", esperaMotivo: null };

const fetchMock = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(json(init?.method === "PATCH" ? { orden } : snapshot())));
const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");

// jsdom lays nothing out: every column gets a 280x800 box, side by side, so `pointerWithin` has something to hit.
const ORDER = Object.values(ORDER_STATUS_LABEL);
const colAt = (label: string) => ({ x: ORDER.indexOf(label) * 300 + 100, y: 100 });
beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const i = ORDER.indexOf(this.getAttribute("aria-label") ?? "");
    const [left, width, height] = i >= 0 ? [i * 300, 280, 800] : [0, 10, 10];
    return { left, top: 0, width, height, right: left + width, bottom: height, x: left, y: 0, toJSON: () => ({}) };
  });
});
afterEach(() => (vi.restoreAllMocks(), vi.unstubAllGlobals()));

const section = (name: string) => screen.getByRole("region", { name, hidden: true });
const gripOf = (plate: string) => screen.getByText(plate).closest("li")!.querySelector<HTMLElement>("[title='Arrastrar']")!;
// Grab a card by its grip, travel past the 5 px threshold, then to `to`. Release only when `drop` is true.
async function drag(plate: string, to: string, drop = true) {
  fireEvent.mouseDown(gripOf(plate), { button: 0, clientX: 5, clientY: 5 });
  fireEvent.mouseMove(document, { clientX: 20, clientY: 20 });
  fireEvent.mouseMove(document, { clientX: colAt(to).x, clientY: colAt(to).y });
  await waitFor(() => expect(section(to).className).toMatch(/board-hue-ring|opacity-40/));
  if (drop) fireEvent.mouseUp(document, { clientX: colAt(to).x, clientY: colAt(to).y });
}

describe("DndBoard drag", () => {
  it("lights the legal columns and dims the others with the hint, for an in_progress card", async () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    await drag("IP", "En espera", false);
    for (const label of ["En espera", "Completada"]) {
      expect(section(label).className).toContain("board-hue-ring");
      expect(within(section(label)).queryByText("No se puede mover acá")).toBeNull();
    }
    for (const label of ["Agendada", "Recibida", "En diagnóstico", "Lista para revisión"]) {
      expect(within(section(label)).getByText("No se puede mover acá")).toBeInTheDocument();
      expect(section(label).className).not.toContain("board-hue-ring");
    }
    // The source column is neither lit nor dimmed.
    expect(section("En progreso").className).not.toMatch(/board-hue-ring|opacity-40/);
    expect(within(section("En progreso")).queryByText("No se puede mover acá")).toBeNull();
  });

  it("drops on a legal column through the same path as the menu: En espera asks the reason, nothing is sent yet", async () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    await drag("IP", "En espera");
    expect(await screen.findByText("¿Por qué queda en espera?")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a plain drop sends the same PATCH as the menu and places the card", async () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    await drag("DG", "En progreso");
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(JSON.parse(patches()[0][1]!.body as string)).toEqual({ status: "in_progress", expectedStatus: "diagnosing" });
    expect(within(section("En progreso")).getByText("DG")).toBeInTheDocument();
  });

  it("dropping on an illegal column does nothing: no request, no dialog, the card stays", async () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    await drag("IP", "En diagnóstico");
    await waitFor(() => expect(screen.queryByText("No se puede mover acá")).toBeNull()); // the drag ended
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(section("En progreso")).getByText("IP")).toBeInTheDocument();
  });

  it("a técnico (canMove false) has no grip", () => {
    render(<KanbanBoard initial={snapshot()} canMove={false} />);
    expect(document.querySelector("[title='Arrastrar']")).toBeNull();
  });

  it("the grip is hidden on a phone, so no drag can start there", () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    expect(gripOf("IP").className).toContain("max-md:hidden");
  });
});

describe("DndBoard before mount", () => {
  it("renders exactly its children on the server: no wrapper, no generated id", () => {
    const props = { cards: [], columns: [], onDrop: () => {}, overlay: () => null };
    expect(renderToString(<DndBoard {...props}><p>x</p></DndBoard>)).toBe(renderToString(<p>x</p>));
  });

  it("hydrates the server markup of the whole board without a mismatch, then arms the grips", async () => {
    const jsx = <KanbanBoard initial={snapshot()} canMove />;
    const host = document.body.appendChild(document.createElement("div"));
    host.innerHTML = renderToString(jsx);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    await act(async () => void hydrateRoot(host, jsx, { onRecoverableError: recoverable }));
    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(host.querySelectorAll("[title='Arrastrar']")).toHaveLength(2);
  });
});
