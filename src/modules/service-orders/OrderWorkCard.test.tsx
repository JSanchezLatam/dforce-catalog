/**
 * The work-lines card body: who is on the order, what each did, per-technician
 * totals, "Mi parte lista" and the per-line controls. Fixtures follow the wire
 * shapes `order-team.ts` returns and the routes answer (parte-lista answers
 * `{ status }`). See `.claude/skills/component-testing/SKILL.md`.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";
import type { OrderAssignee, OrderWorkLine } from "./order-team";
import { OrderWorkCard } from "./OrderWorkCard";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

const T: OrderAssignee = { tecnicoId: "t1", nombre: "Ana Mecánica", active: true, parteLista: false };
const U: OrderAssignee = { tecnicoId: "t2", nombre: "Beto Frenos", active: true, parteLista: true };

const line = (id: string, t: OrderAssignee, minutos: number, descripcion = `Trabajo ${id}`): OrderWorkLine => ({
  id,
  tecnicoId: t.tecnicoId,
  tecnicoNombre: t.nombre,
  descripcion,
  duracionMinutos: minutos,
  fecha: "2026-03-04",
});
// T: 60 + 30 = 90, U: 45
const LINES = [line("l1", T, 60), line("l2", T, 30), line("l3", U, 45)];

type Props = Partial<React.ComponentProps<typeof OrderWorkCard>>;
function renderCard(props: Props = {}) {
  return render(
    <ToastProvider>
      <OrderWorkCard
        orderId="o1"
        status="in_progress"
        assignees={[T, U]}
        lines={LINES}
        mode="write"
        viewerTecnicoId={null}
        canManageAll
        {...props}
      />
    </ToastProvider>,
  );
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}


/**
 * `router.refresh()` throwing after an accepted write must not retract the only
 * confirmation of it: the toast sits ABOVE the refresh. The throw escapes as an
 * unhandled rejection, captured here so "the toast is there" is a positive fact.
 */
async function withThrowingRefresh(act: () => Promise<void>) {
  refresh.mockImplementationOnce(() => {
    throw new Error("refresh blew up");
  });
  const escaped: unknown[] = [];
  const capture = (reason: unknown) => escaped.push(reason);
  process.on("unhandledRejection", capture);
  try {
    await act();
    await vi.waitFor(() => expect(escaped).toHaveLength(1));
  } finally {
    process.off("unhandledRejection", capture);
  }
}

const summary = (nombre: string) => screen.getByText(nombre, { selector: "[data-slot='assignee-name']" }).closest("li") as HTMLElement;

describe("OrderWorkCard — what is shown", () => {
  it("lists every line with its technician, description, duration and day", () => {
    renderCard();

    const items = screen.getAllByRole("listitem", { name: /^Línea/ });
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Ana Mecánica")).toBeInTheDocument();
    expect(within(items[0]).getByText("Trabajo l1")).toBeInTheDocument();
    expect(within(items[0]).getByText("60 min · 04/03/2026")).toBeInTheDocument();
  });

  it("totals the minutes per technician: 90 for the one with two lines, 45 for the other", () => {
    renderCard();

    expect(within(summary("Ana Mecánica")).getByText("90 min")).toBeInTheDocument();
    expect(within(summary("Beto Frenos")).getByText("45 min")).toBeInTheDocument();
  });

  it("totals an assignee with no lines as 0 min", () => {
    renderCard({ lines: [] });

    expect(within(summary("Ana Mecánica")).getByText("0 min")).toBeInTheDocument();
  });

  it("shows each assignee as marked or pending", () => {
    renderCard();

    expect(within(summary("Ana Mecánica")).getByText("Pendiente")).toBeInTheDocument();
    expect(within(summary("Beto Frenos")).getByText("Parte lista")).toBeInTheDocument();
  });

  it("says there are no lines yet, and that nobody is assigned", () => {
    renderCard({ lines: [], assignees: [] });

    expect(screen.getByText("Todavía no hay líneas de trabajo.")).toBeInTheDocument();
    expect(screen.getByText("Asigná un técnico para poder cargar líneas.")).toBeInTheDocument();
  });
});

describe("OrderWorkCard — Mi parte lista", () => {
  it("offers the mark to the viewer's own pending assignment and to nobody else", () => {
    renderCard({ viewerTecnicoId: "t1", canManageAll: false });

    expect(screen.getAllByRole("button", { name: "Mi parte lista" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Desmarcar mi parte" })).not.toBeInTheDocument();
  });

  it("shows the other technician's mark to the viewer, with no control over it", () => {
    renderCard({ viewerTecnicoId: "t1", canManageAll: false });

    // U is marked: a state in U's row, never a button for T.
    expect(within(summary("Beto Frenos")).getByText("Parte lista")).toBeInTheDocument();
    expect(within(summary("Beto Frenos")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers the un-mark, not the mark, to a viewer whose part is already marked", () => {
    renderCard({ viewerTecnicoId: "t2", canManageAll: false });

    expect(screen.getByRole("button", { name: "Desmarcar mi parte" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mi parte lista" })).not.toBeInTheDocument();
  });

  it("still offers the un-mark once the order is ready_for_review, but no mark", () => {
    renderCard({ viewerTecnicoId: "t2", canManageAll: false, status: "ready_for_review" });
    expect(screen.getByRole("button", { name: "Desmarcar mi parte" })).toBeInTheDocument();
  });

  it.each(["open", "done", "cancelled"] as const)("offers neither on a %s order", (status) => {
    renderCard({ viewerTecnicoId: "t1", canManageAll: false, status });

    expect(screen.queryByRole("button", { name: "Mi parte lista" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desmarcar mi parte" })).not.toBeInTheDocument();
  });

  it("offers neither to a viewer with no roster row on the order", () => {
    renderCard({ viewerTecnicoId: null });

    expect(screen.queryByRole("button", { name: "Mi parte lista" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desmarcar mi parte" })).not.toBeInTheDocument();
  });

  it("POSTs the mark, toasts 'Parte marcada como lista' and refreshes", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(200, { status: "in_progress" });
    renderCard({ viewerTecnicoId: "t1", canManageAll: false });

    await user.click(screen.getByRole("button", { name: "Mi parte lista" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/service-orders/o1/parte-lista", { method: "POST" });
    expect(await screen.findByText("Parte marcada como lista")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the 'Parte marcada como lista' toast when the refresh throws", async () => {
    const user = userEvent.setup();
    stubFetch(200, { status: "in_progress" });
    renderCard({ viewerTecnicoId: "t1", canManageAll: false });

    await withThrowingRefresh(() => user.click(screen.getByRole("button", { name: "Mi parte lista" })));

    expect(screen.getByText("Parte marcada como lista")).toBeInTheDocument();
    expect(screen.queryByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")).not.toBeInTheDocument();
  });

  it("DELETEs the mark, toasts 'Parte desmarcada' and refreshes", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(200, { status: "in_progress" });
    renderCard({ viewerTecnicoId: "t2", canManageAll: false });

    await user.click(screen.getByRole("button", { name: "Desmarcar mi parte" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/service-orders/o1/parte-lista", { method: "DELETE" });
    expect(await screen.findByText("Parte desmarcada")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the server's refusal as a toast, with no success toast and no refresh", async () => {
    const user = userEvent.setup();
    stubFetch(409, { error: "parte_lista", message: "Tu parte ya está marcada como lista" });
    renderCard({ viewerTecnicoId: "t1", canManageAll: false });

    await user.click(screen.getByRole("button", { name: "Mi parte lista" }));

    expect(await screen.findByText("Tu parte ya está marcada como lista")).toBeInTheDocument();
    expect(screen.queryByText("Parte marcada como lista")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says so when the request never lands, and the button comes back", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderCard({ viewerTecnicoId: "t1", canManageAll: false });

    await user.click(screen.getByRole("button", { name: "Mi parte lista" }));

    expect(await screen.findByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mi parte lista" })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("holds both controls at the 44px floor", () => {
    renderCard({ viewerTecnicoId: "t1", canManageAll: false });
    expect(screen.getByRole("button", { name: "Mi parte lista" })).toHaveClass("min-h-11", "min-w-11");
  });
});

describe("OrderWorkCard — who may write", () => {
  it("lets staff add, edit and delete any line while the order is writable", () => {
    renderCard();

    expect(screen.getByRole("button", { name: "Agregar línea" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Editar línea/ })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Eliminar línea/ })).toHaveLength(3);
  });

  it("lets a técnico add, edit and delete only their own lines", () => {
    renderCard({ viewerTecnicoId: "t1", canManageAll: false });

    expect(screen.getByRole("button", { name: "Agregar línea" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Editar línea/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Editar línea de Beto Frenos: Trabajo l3" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Eliminar línea/ })).toHaveLength(2);
  });

  it("takes every write control away from a técnico who marked their part", () => {
    renderCard({ viewerTecnicoId: "t2", canManageAll: false });

    expect(screen.queryByRole("button", { name: "Agregar línea" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar línea/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Eliminar línea/ })).not.toBeInTheDocument();
  });

  it("offers a técnico with no assignment on the order nothing to write", () => {
    renderCard({ viewerTecnicoId: null, canManageAll: false });

    expect(screen.queryByRole("button", { name: "Agregar línea" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar línea/ })).not.toBeInTheDocument();
  });

  it("offers no write control at all when the mode is refused, but still lists the lines", () => {
    renderCard({ mode: "refused" });

    expect(screen.queryByRole("button", { name: "Agregar línea" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar línea/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Eliminar línea/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem", { name: /^Línea/ })).toHaveLength(3);
  });

  it("offers staff no add control when nobody is assigned", () => {
    renderCard({ assignees: [], lines: [] });

    expect(screen.queryByRole("button", { name: "Agregar línea" })).not.toBeInTheDocument();
  });

  it("asks an administrador correcting a closed order for the password when adding", async () => {
    const user = userEvent.setup();
    renderCard({ mode: "correction", status: "done" });

    await user.click(screen.getByRole("button", { name: "Agregar línea" }));

    expect(screen.getByLabelText("Tu contraseña")).toBeInTheDocument();
  });

  it("asks for no password when adding on an order that is still open to writing", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Agregar línea" }));

    expect(screen.queryByLabelText("Tu contraseña")).not.toBeInTheDocument();
  });
});

describe("OrderWorkCard — deleting a line", () => {
  const openDelete = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("button", { name: "Eliminar línea de Ana Mecánica: Trabajo l1" }));

  it("confirms, DELETEs with no password on an open order, toasts and refreshes", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(200, { success: true });
    renderCard();

    await openDelete(user);
    expect(screen.queryByLabelText("Tu contraseña")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/service-orders/o1/work-lines/l1", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(await screen.findByText("Línea eliminada")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the 'Línea eliminada' toast when the refresh throws", async () => {
    const user = userEvent.setup();
    stubFetch(200, { success: true });
    renderCard();

    await openDelete(user);
    await withThrowingRefresh(() => user.click(screen.getByRole("button", { name: "Eliminar" })));

    expect(screen.getByText("Línea eliminada")).toBeInTheDocument();
  });

  it("asks a correcting administrador for the password and sends it", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(200, { success: true });
    renderCard({ mode: "correction", status: "done" });

    await openDelete(user);
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeDisabled();
    await user.type(screen.getByLabelText("Tu contraseña"), "secreta");
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ password: "secreta" });
  });

  it("shows a wrong password under the field and deletes nothing visible", async () => {
    const user = userEvent.setup();
    stubFetch(403, { error: "wrong_password", message: "Contraseña incorrecta" });
    renderCard({ mode: "correction", status: "done" });

    await openDelete(user);
    await user.type(screen.getByLabelText("Tu contraseña"), "mala");
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByText("Contraseña incorrecta")).toBeInTheDocument();
    expect(screen.queryByText("Línea eliminada")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows any other refusal inline in the dialog", async () => {
    const user = userEvent.setup();
    stubFetch(409, { error: "parte_lista", message: "Desmarcá tu parte lista antes de cambiar líneas de trabajo" });
    renderCard();

    await openDelete(user);
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Desmarcá tu parte lista antes de cambiar líneas de trabajo");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says so inline when the request never lands", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderCard();

    await openDelete(user);
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
  });
});
