/**
 * Component tests for the roster screen (technicians-and-work-lines WU3).
 * Fixtures follow the wire: `deactivatedAt` is a string because a Server
 * Component serialises it, and the PATCH/POST bodies are what the routes read.
 */
import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";
import { TechnicianRoster, type TechnicianRow } from "./TechnicianRoster";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: ToastProvider });

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const LUIS: TechnicianRow = { id: "t-1", nombre: "Luis", userId: null, username: null, deactivatedAt: null };
const ANA: TechnicianRow = { id: "t-2", nombre: "Ana", userId: "u-1", username: "ana", deactivatedAt: null };
const OFF: TechnicianRow = { id: "t-3", nombre: "Zoe", userId: null, username: null, deactivatedAt: "2026-01-01T00:00:00.000Z" };
const LOGINS = [
  { id: "u-1", username: "ana" },
  { id: "u-2", username: "beto" },
];

function mockFetch(response: { status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body ?? {},
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bodyOf = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse(fetchMock.mock.calls[0][1].body);
const table = () => within(screen.getByTestId("technicians-table"));
const cards = () => within(screen.getByTestId("technicians-cards"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("TechnicianRoster — layout", () => {
  it("shows the table from md up and the card stack below it", () => {
    render(<TechnicianRoster technicians={[LUIS]} logins={[]} canLink={false} />);

    expect(screen.getByTestId("technicians-table")).toHaveClass("hidden", "md:block");
    expect(screen.getByTestId("technicians-cards")).toHaveClass("md:hidden");
  });

  it("lists name, linked login and state in both layouts, hiding deactivated rows until asked", async () => {
    const user = userEvent.setup();
    render(<TechnicianRoster technicians={[LUIS, ANA, OFF]} logins={LOGINS} canLink />);

    expect(table().getByText("Luis")).toBeInTheDocument();
    expect(within(table().getByRole("row", { name: /Ana/ })).getByText("ana")).toBeInTheDocument();
    expect(cards().getByText("Luis")).toBeInTheDocument();
    expect(table().queryByText("Zoe")).not.toBeInTheDocument();
    expect(cards().queryByText("Zoe")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Mostrar inactivos"));
    expect(within(table().getByRole("row", { name: /Zoe/ })).getByText("Desactivado")).toBeInTheDocument();
    expect(within(cards().getByText("Zoe").closest("li") as HTMLElement).getByText("Desactivado")).toBeInTheDocument();
  });

  it("gives the create button and every row kebab a 44x44 floor", () => {
    render(<TechnicianRoster technicians={[LUIS]} logins={[]} canLink={false} />);

    expect(screen.getByRole("button", { name: "Nuevo técnico" })).toHaveClass("min-h-11", "min-w-11");
    for (const kebab of screen.getAllByRole("button", { name: "Acciones de Luis" })) {
      expect(kebab).toHaveClass("min-h-11", "min-w-11");
    }
  });

  it("says so when there is nothing to show", () => {
    render(<TechnicianRoster technicians={[]} logins={[]} canLink={false} />);
    expect(screen.getByText("No hay técnicos para mostrar.")).toBeInTheDocument();
  });
});

describe("TechnicianRoster — create", () => {
  it("creates by name alone for a jefe: no link control, no userId in the body, toast above the refresh", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 201, body: { technician: LUIS } });
    render(<TechnicianRoster technicians={[]} logins={[]} canLink={false} />);

    await user.click(screen.getByRole("button", { name: "Nuevo técnico" }));
    expect(screen.queryByLabelText("Usuario vinculado")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Nombre"), "  Luis ");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/technicians", expect.objectContaining({ method: "POST" }));
    expect(bodyOf(fetchMock)).toEqual({ nombre: "Luis" });
    expect(await screen.findByText("Técnico creado")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refuses a blank name inline without calling the server", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 201 });
    render(<TechnicianRoster technicians={[]} logins={[]} canLink={false} />);

    await user.click(screen.getByRole("button", { name: "Nuevo técnico" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("El nombre es obligatorio.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Técnico creado")).not.toBeInTheDocument();
  });

  it("offers an administrador only the logins no other row holds, and sends the chosen userId", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 201, body: { technician: LUIS } });
    render(<TechnicianRoster technicians={[ANA]} logins={LOGINS} canLink />);

    await user.click(screen.getByRole("button", { name: "Nuevo técnico" }));
    await user.type(screen.getByLabelText("Nombre"), "Beto");
    await user.click(screen.getByLabelText("Usuario vinculado"));
    expect(screen.queryByRole("option", { name: "ana" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "beto" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(bodyOf(fetchMock)).toEqual({ nombre: "Beto", userId: "u-2" });
  });

  it("shows a 409 link refusal inline, with no toast", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 409, body: { error: "Ese usuario ya está vinculado a otro técnico." } });
    render(<TechnicianRoster technicians={[]} logins={LOGINS} canLink />);

    await user.click(screen.getByRole("button", { name: "Nuevo técnico" }));
    await user.type(screen.getByLabelText("Nombre"), "Beto");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ese usuario ya está vinculado a otro técnico.");
    expect(screen.queryByText("Técnico creado")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("TechnicianRoster — rename, link, deactivate", () => {
  async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string, item: string) {
    await user.click(within(table().getByRole("row", { name: new RegExp(name) })).getByRole("button", { name: `Acciones de ${name}` }));
    await user.click(await screen.findByRole("menuitem", { name: item }));
  }

  it("renames through PATCH with the name only for a jefe, and toasts Técnico actualizado", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { technician: LUIS } });
    render(<TechnicianRoster technicians={[LUIS]} logins={[]} canLink={false} />);

    await openMenu(user, "Luis", "Editar");
    expect(screen.getByLabelText("Nombre")).toHaveValue("Luis");
    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Luis R.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/technicians/t-1", expect.objectContaining({ method: "PATCH" }));
    expect(bodyOf(fetchMock)).toEqual({ nombre: "Luis R." });
    expect(await screen.findByText("Técnico actualizado")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("an administrador editing only the name does not resend the unchanged link", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { technician: ANA } });
    render(<TechnicianRoster technicians={[ANA]} logins={LOGINS} canLink />);

    await openMenu(user, "Ana", "Editar");
    await user.type(screen.getByLabelText("Nombre"), "!");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(bodyOf(fetchMock)).toEqual({ nombre: "Ana!" });
  });

  it("an administrador can link and unlink: userId goes out as the id, then as null", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { technician: LUIS } });
    const { unmount } = render(<TechnicianRoster technicians={[LUIS]} logins={LOGINS} canLink />);

    await openMenu(user, "Luis", "Editar");
    await user.click(screen.getByLabelText("Usuario vinculado"));
    await user.click(await screen.findByRole("option", { name: "beto" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(bodyOf(fetchMock)).toEqual({ nombre: "Luis", userId: "u-2" });
    await screen.findByText("Técnico actualizado");
    unmount();

    fetchMock.mockClear();
    render(<TechnicianRoster technicians={[ANA]} logins={LOGINS} canLink />);
    await openMenu(user, "Ana", "Editar");
    await user.click(screen.getByLabelText("Usuario vinculado"));
    await user.click(await screen.findByRole("option", { name: "Sin usuario" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(bodyOf(fetchMock)).toEqual({ nombre: "Ana", userId: null });
  });

  it("deactivates with active:false and toasts Técnico desactivado", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { technician: LUIS } });
    render(<TechnicianRoster technicians={[LUIS]} logins={[]} canLink={false} />);

    await openMenu(user, "Luis", "Desactivar");

    expect(bodyOf(fetchMock)).toEqual({ active: false });
    expect(await screen.findByText("Técnico desactivado")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reactivates with active:true and toasts Técnico reactivado", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { technician: OFF } });
    render(<TechnicianRoster technicians={[OFF]} logins={[]} canLink={false} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    await openMenu(user, "Zoe", "Reactivar");

    expect(bodyOf(fetchMock)).toEqual({ active: true });
    expect(await screen.findByText("Técnico reactivado")).toBeInTheDocument();
  });

  it("a refused deactivation shows an inline alert, no toast, no refresh", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 404, body: { error: "not_found" } });
    render(<TechnicianRoster technicians={[LUIS]} logins={[]} canLink={false} />);

    await openMenu(user, "Luis", "Desactivar");

    expect(await screen.findByRole("alert")).toHaveTextContent("Ese técnico ya no existe. Recargá la página.");
    expect(screen.queryByText("Técnico desactivado")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not offer Editar on a deactivated row", async () => {
    const user = userEvent.setup();
    render(<TechnicianRoster technicians={[OFF]} logins={[]} canLink={false} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    await user.click(within(table().getByRole("row", { name: /Zoe/ })).getByRole("button", { name: "Acciones de Zoe" }));

    expect(await screen.findByRole("menuitem", { name: "Reactivar" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Editar" })).not.toBeInTheDocument();
  });
});
