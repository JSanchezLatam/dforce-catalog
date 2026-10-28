import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const addToast = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast }) }));

import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";

import { AgendaDetail } from "./AgendaDetail";
import { makeItem } from "./items.fixture";

const jorge = (over: Parameters<typeof makeItem>[0] = {}) =>
  makeItem({
    id: "o1",
    dayKey: "2026-10-27",
    time: "11:00",
    customerName: "Jorge Vega",
    customerPhone: "6612-4480",
    vehicleLabel: "AC 5521 · Toyota Corolla",
    vehicleDetail: "AC 5521 · Toyota Corolla 2019",
    categoria: "revisado",
    categoriaLabel: "REVISADO",
    description: "Revisado + alineación",
    technicians: [{ id: "t1", nombre: "Julio Rangel", initials: "JR" }],
    ...over,
  });

/** Real `Response` objects with the routes' wire shapes; every call is recorded. */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function stubFetch(reply: () => Response | Promise<Response> = () => json({ orden: { id: "o1" } })) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return reply(); }));
  return calls;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
  addToast.mockReset();
});

const chips = () => within(screen.getByRole("list", { name: "Categoría" })).getAllByRole("listitem");

describe("AgendaDetail", () => {
  it("Detail content: a booked appointment that is not Vencida", () => {
    render(<AgendaDetail item={jorge()} onClose={vi.fn()} />);
    expect(screen.getByText("Cita agendada")).toBeInTheDocument();
    expect(screen.getByText("Jorge Vega")).toBeInTheDocument();
    expect(screen.getByText("Martes 27 de octubre")).toBeInTheDocument();
    expect(screen.getByText("11:00")).toBeInTheDocument();
    expect(screen.getByText("AC 5521 · Toyota Corolla 2019")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "6612-4480" })).toHaveAttribute("href", "tel:6612-4480");
    expect(screen.getByText("Revisado + alineación")).toBeInTheDocument();
    const group = within(screen.getByRole("group", { name: "Categoría" })).getAllByRole("button");
    expect(group.map((c) => c.textContent)).toEqual(Object.values(CATEGORIA_LABEL));
    expect(group.filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.textContent)).toEqual(["REVISADO"]);
    expect(screen.getByText("Julio Rangel")).toBeInTheDocument();
    expect(screen.getByText("JR")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No se presentó" })).not.toBeInTheDocument();
  });

  it("the phone link carries the digits as they are stored", () => {
    render(<AgendaDetail item={jorge({ customerPhone: "61234567" })} onClose={vi.fn()} />);
    expect(screen.getByRole("link", { name: "61234567" })).toHaveAttribute("href", "tel:61234567");
  });

  it("Abrir orden: a 44px link to the order, as a button and as the pencil with the same accessible name", () => {
    render(<AgendaDetail item={jorge({ href: "/service-orders/o1" })} onClose={vi.fn()} />);
    const links = screen.getAllByRole("link", { name: "Abrir orden" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/service-orders/o1");
      expect(link).toHaveClass("min-h-11", "min-w-11");
    }
    expect(links.some((l) => l.textContent === "Abrir orden")).toBe(true);
    expect(links.some((l) => l.querySelector("svg"))).toBe(true);
  });

  it("Vencida Detail offers both actions, and its status reads Vencida", () => {
    render(<AgendaDetail item={jorge({ overdue: true })} onClose={vi.fn()} />);
    expect(screen.getByText("Vencida")).toBeInTheDocument();
    expect(screen.queryByText("Cita agendada")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No se presentó" })).toBeInTheDocument();
  });

  it("Muted Detail is read-only: an open appointment offers Abrir orden only, and shows its chips and technicians", () => {
    render(<AgendaDetail item={jorge({ status: "open", statusLabel: "Recibida", muted: true })} roster={[{ id: "t9", nombre: "Otro" }]} onClose={vi.fn()} />);
    expect(screen.getByText("Recibida")).toBeInTheDocument();
    expect(chips()).toHaveLength(5);
    expect(chips().filter((c) => c.getAttribute("aria-current") === "true").map((c) => c.textContent)).toEqual(["REVISADO"]);
    expect(screen.getByText("Julio Rangel")).toBeInTheDocument();
    // The only buttons are the close control: no action, no chip, no assign control.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cerrar"]);
    expect(screen.getAllByRole("link", { name: "Abrir orden" })).toHaveLength(2);
  });

  it("a no-show reads 'No se presentó' and offers Abrir orden only", () => {
    render(<AgendaDetail item={jorge({ status: "cancelled", statusLabel: "No se presentó", muted: true, noShow: true })} onClose={vi.fn()} />);
    expect(screen.getByText("No se presentó")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cerrar"]);
  });

  it("empty fields: 'Sin descripción', 'Sin vehículo', 'Sin técnico' and no chip marked", () => {
    render(<AgendaDetail item={jorge({ description: null, vehicleDetail: "Sin vehículo", categoria: null, categoriaLabel: "Sin categoría", technicians: [] })} onClose={vi.fn()} />);
    expect(screen.getByText("Sin descripción")).toBeInTheDocument();
    expect(screen.getByText("Sin vehículo")).toBeInTheDocument();
    expect(screen.getByText("Sin técnico")).toBeInTheDocument();
    const group = within(screen.getByRole("group", { name: "Categoría" })).getAllByRole("button");
    expect(group).toHaveLength(5);
    expect(group.filter((c) => c.getAttribute("aria-pressed") === "true")).toHaveLength(0);
  });

  it("an empty description is also 'Sin descripción' when it is only spaces", () => {
    render(<AgendaDetail item={jorge({ description: "   " })} onClose={vi.fn()} />);
    expect(screen.getByText("Sin descripción")).toBeInTheDocument();
  });

  it("Close control: a 44x44 'Cerrar' that reports the close", async () => {
    const onClose = vi.fn();
    render(<AgendaDetail item={jorge()} onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Cerrar" });
    expect(close).toHaveClass("min-h-11", "min-w-11");
    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Reprogramar opens the existing dialog", async () => {
    render(<AgendaDetail item={jorge()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Reprogramar" }));
    expect(screen.getByRole("dialog", { name: "Reprogramar cita" })).toBeInTheDocument();
  });

  it("No se presentó opens the existing confirmation", async () => {
    render(<AgendaDetail item={jorge({ overdue: true })} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "No se presentó" }));
    expect(screen.getByRole("dialog", { name: "¿El cliente no se presentó?" })).toBeInTheDocument();
  });

  describe("closing after a successful action", () => {
    it("Reprogramar: the Detail closes after a successful save, and not before or after a refusal", async () => {
      stubFetch();
      const onClose = vi.fn();
      render(<AgendaDetail item={jorge()} onClose={onClose} />);
      await userEvent.click(screen.getByRole("button", { name: "Reprogramar" }));
      expect(onClose).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it("Reprogramar refused (409): the Detail stays and the message shows", async () => {
      stubFetch(() => json({ error: "stale_status", message: "La orden cambió mientras la mirabas. Actualizá la agenda." }, 409));
      const onClose = vi.fn();
      render(<AgendaDetail item={jorge()} onClose={onClose} />);
      await userEvent.click(screen.getByRole("button", { name: "Reprogramar" }));
      await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
      expect(await screen.findByText(/La orden cambió/)).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("No se presentó: the Detail closes after a successful cancel, and stays after a refusal", async () => {
      stubFetch();
      const onClose = vi.fn();
      const { unmount } = render(<AgendaDetail item={jorge({ overdue: true })} onClose={onClose} />);
      await userEvent.click(screen.getByRole("button", { name: "No se presentó" }));
      await userEvent.click(screen.getByRole("button", { name: "Cancelar la orden" }));
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      unmount();
      stubFetch(() => json({ error: "stale_status", message: "La orden cambió mientras la mirabas. Actualizá la agenda." }, 409));
      const refused = vi.fn();
      render(<AgendaDetail item={jorge({ overdue: true })} onClose={refused} />);
      await userEvent.click(screen.getByRole("button", { name: "No se presentó" }));
      await userEvent.click(screen.getByRole("button", { name: "Cancelar la orden" }));
      expect(await screen.findByText(/La orden cambió/)).toBeInTheDocument();
      expect(refused).not.toHaveBeenCalled();
    });
  });

  describe("editing the type", () => {
    const chip = (label: string) => screen.getByRole("button", { name: label });

    it("Edit the type: a booked appointment's chips are buttons, the marked one pressed", () => {
      render(<AgendaDetail item={jorge()} onClose={vi.fn()} />);
      const pressed = within(screen.getByRole("group", { name: "Categoría" })).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true");
      expect(pressed.map((b) => b.textContent)).toEqual(["REVISADO"]);
      expect(within(screen.getByRole("group", { name: "Categoría" })).getAllByRole("button")).toHaveLength(5);
    });

    it("chips are 44px targets", () => {
      render(<AgendaDetail item={jorge()} onClose={vi.fn()} />);
      for (const b of within(screen.getByRole("group", { name: "Categoría" })).getAllByRole("button")) expect(b).toHaveClass("min-h-11");
    });

    it("Request body: exactly { categoria, expectedStatus: 'booked' } to the order's PATCH", async () => {
      const calls = stubFetch();
      render(<AgendaDetail item={jorge()} onClose={vi.fn()} />);
      await userEvent.click(chip("Reparación"));
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].url).toBe("/api/service-orders/o1");
      expect(calls[0].init.method).toBe("PATCH");
      expect(JSON.parse(calls[0].init.body as string)).toEqual({ categoria: "reparacion", expectedStatus: "booked" });
    });

    it("Success feedback: the toast sits above the refresh, and a refresh that throws does not retract it or read as a failure", async () => {
      stubFetch();
      refresh.mockImplementation(() => { throw new Error("refresh blew up"); });
      const escaped: unknown[] = [];
      const capture = (reason: unknown) => escaped.push(reason);
      process.on("unhandledRejection", capture);
      try {
        render(<AgendaDetail item={jorge()} onClose={vi.fn()} />);
        await userEvent.click(chip("Reparación"));
        await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(escaped).toHaveLength(1));
      } finally {
        process.off("unhandledRejection", capture);
      }
      expect(addToast).toHaveBeenCalledTimes(1);
      expect(addToast).toHaveBeenCalledWith("success", "Categoría actualizada");
      expect(addToast.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("Stale type edit: the route's 409 message shows inline, with no toast and no refresh", async () => {
      stubFetch(() => json({ error: "stale_status", message: "La orden cambió mientras la mirabas. Actualizá la agenda." }, 409));
      render(<AgendaDetail item={jorge()} onClose={vi.fn()} />);
      await userEvent.click(chip("Reparación"));
      expect(await screen.findByRole("alert")).toHaveTextContent("La orden cambió mientras la mirabas. Actualizá la agenda.");
      expect(addToast).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("the control is disabled while the request is in flight, and free again after", async () => {
      let release!: () => void;
      stubFetch(() => new Promise<Response>((resolve) => { release = () => resolve(json({ orden: { id: "o1" } })); }));
      render(<AgendaDetail item={jorge()} onClose={vi.fn()} />);
      await userEvent.click(chip("Reparación"));
      for (const b of within(screen.getByRole("group", { name: "Categoría" })).getAllByRole("button")) expect(b).toBeDisabled();
      release();
      await vi.waitFor(() => expect(chip("Reparación")).toBeEnabled());
    });

    it("choosing the type the order already has sends nothing (the route cannot unset or no-op)", async () => {
      const calls = stubFetch();
      render(<AgendaDetail item={jorge()} onClose={vi.fn()} />);
      await userEvent.click(chip("REVISADO"));
      expect(calls).toHaveLength(0);
      expect(addToast).not.toHaveBeenCalled();
    });

    it("a Vencida booked appointment is still editable", () => {
      render(<AgendaDetail item={jorge({ overdue: true })} onClose={vi.fn()} />);
      expect(within(screen.getByRole("group", { name: "Categoría" })).getAllByRole("button")).toHaveLength(5);
    });

    it("Muted Detail is read-only: no chip is a button for an open appointment", () => {
      render(<AgendaDetail item={jorge({ status: "open", statusLabel: "Recibida", muted: true })} onClose={vi.fn()} />);
      expect(screen.queryByRole("group", { name: "Categoría" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reparación" })).not.toBeInTheDocument();
    });
  });

  describe("assigning a technician", () => {
    const roster = [
      { id: "t1", nombre: "Julio Rangel" },
      { id: "t2", nombre: "Marta Pérez" },
      { id: "t3", nombre: "Luis Soto" },
    ];
    const openPicker = async () => {
      await userEvent.click(screen.getByRole("button", { name: "+ Asignar técnico" }));
      return screen.getByRole("combobox");
    };

    it("Assign control follows the permission: absent without a roster, a 44px button with one", () => {
      const { unmount } = render(<AgendaDetail item={jorge()} onClose={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "+ Asignar técnico" })).not.toBeInTheDocument();
      unmount();
      render(<AgendaDetail item={jorge()} roster={roster} onClose={vi.fn()} />);
      expect(screen.getByRole("button", { name: "+ Asignar técnico" })).toHaveClass("min-h-11", "min-w-11");
    });

    it("never for a non-booked appointment, even with a roster", () => {
      render(<AgendaDetail item={jorge({ status: "open", statusLabel: "Recibida", muted: true })} roster={roster} onClose={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "+ Asignar técnico" })).not.toBeInTheDocument();
    });

    it("the picker lists the roster minus the technicians already on the order", async () => {
      render(<AgendaDetail item={jorge()} roster={roster} onClose={vi.fn()} />);
      const select = await openPicker();
      expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Elegí un técnico", "Marta Pérez", "Luis Soto"]);
    });

    it("Assign a technician: POST assignments with the tecnicoId, toast 'Técnico asignado'", async () => {
      const calls = stubFetch(() => json({ asignacion: { id: "a1" } }, 201));
      render(<AgendaDetail item={jorge()} roster={roster} onClose={vi.fn()} />);
      await userEvent.selectOptions(await openPicker(), "t2");
      await userEvent.click(screen.getByRole("button", { name: "Asignar" }));
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(calls[0].url).toBe("/api/service-orders/o1/assignments");
      expect(calls[0].init.method).toBe("POST");
      expect(JSON.parse(calls[0].init.body as string)).toEqual({ tecnicoId: "t2" });
      expect(addToast).toHaveBeenCalledWith("success", "Técnico asignado");
    });

    it("Assign refusal stays inline: order_closed 409 shows its message and no toast", async () => {
      stubFetch(() => json({ error: "order_closed", message: "No se puede asignar un técnico a una orden completada o cancelada." }, 409));
      render(<AgendaDetail item={jorge()} roster={roster} onClose={vi.fn()} />);
      await userEvent.selectOptions(await openPicker(), "t2");
      await userEvent.click(screen.getByRole("button", { name: "Asignar" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("No se puede asignar un técnico a una orden completada o cancelada.");
      expect(addToast).not.toHaveBeenCalled();
    });
  });
});
