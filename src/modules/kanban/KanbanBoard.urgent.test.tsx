import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { KanbanBoard } from "./KanbanBoard";
import type { KanbanCard, KanbanSnapshot } from "./shape";

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast }) }));

const card = (id: string, status: OrderStatus, over: Partial<KanbanCard> = {}): KanbanCard => ({
  id, status, statusLabel: ORDER_STATUS_LABEL[status], plate: id, make: "Toyota", model: "Hilux", holdReason: null, technicians: [],
  statusSince: "2026-10-26T14:48:00.000Z", urgent: false, categoria: null, missing: [], mine: false, ...over,
});
// OLD is older, so it sorts first until NEW becomes urgent.
const ROWS = [card("OLD", "in_progress", { statusSince: "2026-10-26T10:00:00.000Z" }), card("NEW", "in_progress"), card("UR", "open", { urgent: true }), card("DN", "done")];
const snapshot = (): KanbanSnapshot => ({ generatedAt: "2026-10-26T15:00:00.000Z", onRoster: false, rows: ROWS });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let urgentRes: () => Promise<Response>;
let toastsAtGet: number[];
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  if (url.endsWith("/urgent")) return (urgent.push([url, init?.method]), urgentRes());
  toastsAtGet.push(addToast.mock.calls.length);
  return Promise.resolve(json(snapshot()));
});
let urgent: (string | undefined)[][];
const urgentCalls = () => urgent;

beforeEach(() => {
  addToast.mockClear();
  fetchMock.mockClear();
  toastsAtGet = [];
  urgent = [];
  urgentRes = async () => json({ urgent: true });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => (vi.restoreAllMocks(), vi.unstubAllGlobals()));

const plates = (name: string) => [...screen.getByRole("region", { name }).querySelectorAll("li .font-extrabold")].map((e) => e.textContent);
const openMenu = (plate: string) => userEvent.click(within(screen.getByText(plate).closest("li")!).getByRole("button", { name: "Acciones de la orden" }));
const choose = async (plate: string, item: string) => (await openMenu(plate), userEvent.click(await screen.findByRole("menuitem", { name: item })));

describe("KanbanBoard urgent toggle", () => {
  it("marking POSTs, sorts the card first, shows the badge and toasts BEFORE the refresh goes out", async () => {
    render(<KanbanBoard initial={snapshot()} canMove />);
    expect(plates("En progreso")).toEqual(["OLD", "NEW"]);
    await choose("NEW", "Marcar como urgente");
    expect(urgentCalls()).toEqual([["/api/service-orders/NEW/urgent", "POST"]]);
    await waitFor(() => expect(toastsAtGet).toHaveLength(1));
    expect(addToast).toHaveBeenCalledExactlyOnceWith("success", "Orden marcada como urgente");
    expect(toastsAtGet).toEqual([1]);
    expect(plates("En progreso")).toEqual(["NEW", "OLD"]);
    expect(within(screen.getByText("NEW").closest("li")!).getByText("Urgente")).toBeInTheDocument();
  });

  it("the card is sorted first and badged while the request is still in flight", async () => {
    let release!: (r: Response) => void;
    urgentRes = () => new Promise((resolve) => (release = resolve));
    render(<KanbanBoard initial={snapshot()} canMove />);
    await choose("NEW", "Marcar como urgente");
    expect(plates("En progreso")).toEqual(["NEW", "OLD"]);
    expect(addToast).not.toHaveBeenCalled();
    release(json({ urgent: true }));
    await waitFor(() => expect(addToast).toHaveBeenCalledOnce());
  });

  it("clearing DELETEs and toasts the desmarcada copy", async () => {
    urgentRes = async () => json({ urgent: false });
    render(<KanbanBoard initial={snapshot()} canMove />);
    await choose("UR", "Quitar urgente");
    expect(urgentCalls()).toEqual([["/api/service-orders/UR/urgent", "DELETE"]]);
    await waitFor(() => expect(addToast).toHaveBeenCalledExactlyOnceWith("success", "Orden desmarcada como urgente"));
    expect(within(screen.getByText("UR").closest("li")!).queryByText("Urgente")).toBeNull();
  });

  it("a 409 order_closed rolls the card back and toasts the server's own line, with no refresh", async () => {
    const message = "La orden está cerrada y ya no se puede cambiar si es urgente.";
    urgentRes = async () => json({ error: "order_closed", message }, 409);
    render(<KanbanBoard initial={snapshot()} canMove />);
    await choose("NEW", "Marcar como urgente");
    await waitFor(() => expect(addToast).toHaveBeenCalledExactlyOnceWith("error", message));
    expect(plates("En progreso")).toEqual(["OLD", "NEW"]);
    expect(toastsAtGet).toEqual([]);
  });

  it("a técnico and a done card get no toggle", async () => {
    const { unmount } = render(<KanbanBoard initial={snapshot()} canMove={false} />);
    await openMenu("NEW");
    expect(screen.queryByRole("menuitem", { name: /urgente/ })).toBeNull();
    unmount();
    render(<KanbanBoard initial={snapshot()} canMove />);
    await openMenu("DN");
    expect(await screen.findByRole("menuitem", { name: "Ver orden" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /urgente/ })).toBeNull();
  });

  it("on a phone the same row lives in the bottom sheet and closes it", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((q) => ({ matches: q === "(max-width: 767px)" }) as MediaQueryList);
    render(<KanbanBoard initial={snapshot()} canMove />);
    await openMenu("NEW");
    await userEvent.click(await screen.findByRole("button", { name: "Marcar como urgente" }));
    await waitFor(() => expect(addToast).toHaveBeenCalledExactlyOnceWith("success", "Orden marcada como urgente"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
