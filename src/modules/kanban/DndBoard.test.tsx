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
const wide = (): KanbanSnapshot => ({ ...snapshot(), rows: [card("OP", "open"), card("BK", "booked"), ...snapshot().rows] });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const orden = { id: "o1", status: "in_progress", esperaMotivo: null };

const fetchMock = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(json(init?.method === "PATCH" ? { orden } : snapshot())));
const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");

// jsdom lays nothing out: every column gets a 280x800 box, side by side, so `pointerWithin` has something to hit.
const ORDER = Object.values(ORDER_STATUS_LABEL);
const colAt = (label: string) => ({ x: ORDER.indexOf(label) * 300 + 100, y: 100 });
beforeEach(() => {
  fetchMock.mockClear();
  addToast.mockClear();
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
  it("lights the legal columns and dims the others with the hint of THIS origin and target, for an in_progress card", async () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    await drag("IP", "En espera", false);
    for (const label of ["En espera", "Completada"]) {
      expect(section(label).className).toContain("board-hue-ring");
      expect(section(label).querySelector("[data-hint]")).toBeNull();
    }
    const hints: Record<string, string> = {
      "Agendada": "Desde En progreso no se puede pasar a Agendada",
      "Recibida": "Desde En progreso no se puede pasar a Recibida",
      "En diagnóstico": "Desde En progreso no se puede pasar a En diagnóstico",
      "Lista para revisión": "Pasa sola cuando todos marcan su parte lista",
    };
    for (const [label, text] of Object.entries(hints)) {
      expect(within(section(label)).getByText(text)).toBeInTheDocument();
      expect(section(label).className).not.toContain("board-hue-ring");
    }
    expect(screen.queryByText("No se puede mover acá")).toBeNull();
    // The source column is neither lit nor dimmed.
    expect(section("En progreso").className).not.toMatch(/board-hue-ring|opacity-40/);
    expect(section("En progreso").querySelector("[data-hint]")).toBeNull();
  });

  it("the same target reads differently by origin: En diagnóstico says Pasa sola from Recibida, Desde Agendada from Agendada", async () => {
    render(<KanbanBoard initial={wide()} canMove />);
    await drag("OP", "En diagnóstico", false);
    expect(within(section("En diagnóstico")).getByText("Pasa sola al asignar un técnico")).toBeInTheDocument();
    expect(within(section("En progreso")).getByText("Desde Recibida no se puede pasar a En progreso")).toBeInTheDocument();
  });

  it("a booked card over En diagnóstico is not told it passes by itself", async () => {
    render(<KanbanBoard initial={wide()} canMove />);
    await drag("BK", "En diagnóstico", false);
    expect(within(section("En diagnóstico")).getByText("Desde Agendada no se puede pasar a En diagnóstico")).toBeInTheDocument();
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

  it("dropping an open card on En diagnóstico sends nothing and toasts the reason with a period", async () => {
    render(<KanbanBoard initial={wide()} canMove />);
    await drag("OP", "En diagnóstico");
    await waitFor(() => expect(addToast).toHaveBeenCalledExactlyOnceWith("info", "Pasa sola al asignar un técnico."));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(section("Recibida")).getByText("OP")).toBeInTheDocument();
  });

  it("dropping a booked card on En diagnóstico toasts the origin-aware reason", async () => {
    render(<KanbanBoard initial={wide()} canMove />);
    await drag("BK", "En diagnóstico");
    await waitFor(() => expect(addToast).toHaveBeenCalledExactlyOnceWith("info", "Desde Agendada no se puede pasar a En diagnóstico."));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dropping on the card's own column is silent: no request, no toast", async () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    await drag("IP", "En espera", false);
    fireEvent.mouseMove(document, { clientX: colAt("En progreso").x, clientY: colAt("En progreso").y });
    fireEvent.mouseUp(document, { clientX: colAt("En progreso").x, clientY: colAt("En progreso").y });
    await waitFor(() => expect(screen.queryByText(/Desde En progreso/)).toBeNull()); // the drag ended
    expect(fetchMock).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  // dnd-kit keys its registry by id and an unmount deletes the entry whose key is the unmounting hook's
  // (@dnd-kit/core core.esm.js:3416-3429). A second useDraggable for the same id (the overlay's card) would replace the
  // original's entry and delete it on drop, leaving the next drag of that card without a node. jsdom cannot see the
  // symptom (rect/position), so this pins the registry itself.
  it("a drag leaves the dragged card registered: the overlay copy registers no draggable of its own", async () => {
    const del = vi.spyOn(Map.prototype, "delete");
    const set = vi.spyOn(Map.prototype, "set");
    render(<KanbanBoard initial={snapshot()} canMove />);
    const registered = () => set.mock.calls.filter(([k, v]) => k === "IP" && typeof v === "object" && v !== null && "activatorNode" in v).length;
    const before = registered();
    await drag("IP", "En diagnóstico"); // illegal drop: the drag ends, the overlay unmounts
    await waitFor(() => expect(screen.queryByText(/Desde En progreso/)).toBeNull());
    expect(registered()).toBe(before);
    expect(del.mock.calls.filter(([k]) => k === "IP")).toHaveLength(0);
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
