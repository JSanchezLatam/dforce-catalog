import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { KanbanBoard } from "./KanbanBoard";
import type { KanbanCard, KanbanSnapshot } from "./shape";

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast }) }));

const GENERATED_AT = "2026-10-26T15:00:00.000Z";
const card = (id: string, status: OrderStatus, over: Partial<KanbanCard> = {}): KanbanCard => ({
  id, status, statusLabel: ORDER_STATUS_LABEL[status], plate: id, make: "Toyota", model: "Hilux", holdReason: null, technicians: [],
  statusSince: "2026-10-26T14:48:00.000Z", urgent: false, categoria: null, missing: [], mine: false, ...over,
});
const ROWS = [card("BK", "booked"), card("BM", "booked", { missing: ["categoria"] }), card("DG", "diagnosing"), card("IP", "in_progress")];
const snapshot = (rows = ROWS): KanbanSnapshot => ({ generatedAt: GENERATED_AT, onRoster: false, rows });

// The exact bodies the routes return (src/app/api/service-orders/[id]/route.ts): `orden` is the whole row, dates as ISO strings.
const orden = (status: string) => ({
  id: "o1", clienteId: "c1", vehiculoId: "v1", status, esperaMotivo: status === "on_hold" ? "repuesto" : null,
  categoria: "mant_preventivo", description: null, appointmentAt: null, completedAt: null, hallazgos: null,
  recomendaciones: null, observaciones: null, kilometraje: null, nivelCombustible: null, bateriaPct: null,
  urgenteAt: null, urgenteBy: null, createdBy: "u1", createdAt: "2026-10-27T15:00:00.000Z", updatedAt: "2026-10-27T15:05:00.000Z",
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let served: KanbanSnapshot;
let patch: (init: RequestInit) => Promise<Response>;
// What the toast spy had recorded when each GET /api/kanban (the refresh) went out.
let toastsAtGet: number[];
const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
  if (init?.method === "PATCH") return patch(init);
  toastsAtGet.push(addToast.mock.calls.length);
  return Promise.resolve(json(served));
});
const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
const bodyOf = (n = 0) => JSON.parse(patches()[n][1]!.body as string);

beforeEach(() => {
  addToast.mockClear();
  fetchMock.mockClear();
  served = snapshot();
  toastsAtGet = [];
  patch = async () => json({ orden: orden("in_progress") });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => (vi.useRealTimers(), vi.unstubAllGlobals()));

// hidden: a modal dialog marks the board inert for the accessibility tree.
const plates = (name: string) => [...screen.getByRole("region", { name, hidden: true }).querySelectorAll("li .font-extrabold")].map((e) => e.textContent);
const openMenu = async (plate: string) =>
  userEvent.click(within(screen.getByText(plate).closest("li")!).getByRole("button", { name: "Acciones de la orden" }));
const moveTo = async (plate: string, target: string) => {
  await openMenu(plate);
  await userEvent.click(await screen.findByRole("menuitem", { name: "Mover a…" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: target }));
};

describe("KanbanBoard moves", () => {
  it("a plain move sends status and expectedStatus, places the card, and toasts BEFORE the refresh goes out", async () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    await moveTo("DG", "En progreso");
    expect(bodyOf()).toEqual({ status: "in_progress", expectedStatus: "diagnosing" });
    await waitFor(() => expect(toastsAtGet).toHaveLength(1));
    expect(addToast).toHaveBeenCalledExactlyOnceWith("success", "Orden movida a En progreso");
    expect(toastsAtGet).toEqual([1]); // the toast was already recorded when the refresh fetched
    expect(plates("En progreso")).toContain("DG");
    expect(plates("En diagnóstico")).toEqual([]);
  });

  it("En espera asks the reason first and the PATCH carries it", async () => {
    patch = async () => json({ orden: orden("on_hold") });
    render(<KanbanBoard initial={snapshot()} canMove />);
    await moveTo("IP", "En espera");
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^Repuesto/ }));
    await userEvent.click(screen.getByRole("button", { name: "Pasar a En espera" }));
    expect(bodyOf()).toEqual({ status: "on_hold", expectedStatus: "in_progress", esperaMotivo: "repuesto" });
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "Orden movida a En espera"));
    expect(plates("En espera")).toEqual(["IP"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a dismissed Completada dialog sends nothing and the card stays", async () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    await moveTo("IP", "Completada");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
    expect(plates("En progreso")).toEqual(["IP"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cancelar orden confirms, then moves the card out of the board through the same PATCH", async () => {
    patch = async () => json({ orden: orden("cancelled") });
    render(<KanbanBoard initial={snapshot()} canMove />);
    await openMenu("IP");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Cancelar orden" }));
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar orden" }));
    expect(bodyOf()).toEqual({ status: "cancelled", expectedStatus: "in_progress" });
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "Orden cancelada"));
    expect(screen.queryByText("IP")).toBeNull();
  });

  it("receiving an incomplete booked order opens the refusal and sends nothing", async () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    await moveTo("BM", "Recibida");
    expect(screen.getByRole("dialog", { name: "Todavía no se puede recibir" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(plates("Agendada")).toContain("BM");
  });

  it("places the card where the server put it: booked -> Recibida that lands in En diagnóstico", async () => {
    patch = async () => json({ orden: orden("diagnosing") });
    render(<KanbanBoard initial={snapshot()} canMove />);
    await moveTo("BK", "Recibida");
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "Orden movida a En diagnóstico"));
    expect(plates("En diagnóstico")).toContain("BK");
    expect(plates("Recibida")).toEqual([]);
  });

  it.each([
    ["409 stale_status", json({ error: "stale_status", message: "La orden cambió mientras la mirabas. Actualizá la agenda." }, 409), "La orden cambió mientras la mirabas. Actualizá el tablero."],
    ["400 with the server's own line", json({ errors: { form: "Completá el vehículo y la categoría antes de recibir la orden" } }, 400), "Completá el vehículo y la categoría antes de recibir la orden"],
  ])("%s rolls the card back and shows the error toast, never the success one", async (_n, res, message) => {
    patch = async () => res.clone();
    render(<KanbanBoard initial={snapshot()} canMove />);
    await moveTo("DG", "En progreso");
    await waitFor(() => expect(addToast).toHaveBeenCalledExactlyOnceWith("error", message));
    expect(plates("En diagnóstico")).toEqual(["DG"]);
    expect(plates("En progreso")).toEqual(["IP"]);
    expect(toastsAtGet).toEqual([]);
  });

  it("a viewer who cannot move gets no move items from the board", async () => {
    render(<KanbanBoard initial={snapshot()} canMove={false} />);
    await openMenu("DG");
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["Ver orden"]);
  });

  it("a poll landing while the PATCH is pending does not undo the move, and the pending card takes no second move", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); // time still flows for the menu and dialogs; the poll is driven by advanceTimersByTimeAsync
    let answer!: (r: Response) => void;
    patch = () => new Promise<Response>((resolve) => (answer = resolve));
    render(<KanbanBoard initial={snapshot()} canMove />);
    await moveTo("DG", "En progreso");
    await act(() => vi.advanceTimersByTimeAsync(30_000)); // the poll still reports DG as diagnosing
    expect(toastsAtGet).toEqual([0]);
    expect(plates("En progreso")).toContain("DG");
    await moveTo("DG", "En espera"); // would be dialog-or-PATCH if it were not ignored
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(patches()).toHaveLength(1);
    await act(async () => answer(json({ orden: orden("in_progress") })));
    expect(plates("En progreso")).toContain("DG");
  });
});
