/**
 * Assignment control on the order detail. Real wire (`POST .../assignments`
 * answers 201/200 `{ created }`, 400 `{ errors: { tecnicoId } }`, 409
 * `{ error, message }`). See `.claude/skills/component-testing/SKILL.md`.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";
import { AssignTecnicoControl } from "./AssignTecnicoControl";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

const AVAILABLE = [
  { id: "t1", nombre: "Ana Mecánica" },
  { id: "t2", nombre: "Beto Frenos" },
];

function renderControl(available = AVAILABLE) {
  return render(
    <ToastProvider>
      <AssignTecnicoControl orderId="o1" available={available} />
    </ToastProvider>,
  );
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function assign(user: ReturnType<typeof userEvent.setup>, nombre = "Beto Frenos") {
  await user.selectOptions(screen.getByLabelText("Asignar técnico"), nombre);
  await user.click(screen.getByRole("button", { name: "Asignar" }));
}

describe("AssignTecnicoControl", () => {
  it("offers exactly the technicians it is given", () => {
    renderControl();

    const options = Array.from(screen.getByLabelText("Asignar técnico").querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Elegí un técnico", "Ana Mecánica", "Beto Frenos"]);
  });

  it("keeps Asignar disabled until a technician is chosen", () => {
    renderControl();

    expect(screen.getByRole("button", { name: "Asignar" })).toBeDisabled();
  });

  it("POSTs the chosen technician, toasts 'Técnico asignado' and refreshes", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(201, { created: true });
    renderControl();

    await assign(user);

    expect(fetchMock).toHaveBeenCalledWith("/api/service-orders/o1/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tecnicoId: "t2" }),
    });
    expect(await screen.findByText("Técnico asignado")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the field error inline, with no toast and no refresh, on a 400", async () => {
    const user = userEvent.setup();
    stubFetch(400, { errors: { tecnicoId: "Elegí un técnico activo" } });
    renderControl();

    await assign(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Elegí un técnico activo");
    expect(screen.queryByText("Técnico asignado")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the server's Spanish message inline on a 409 (closed order)", async () => {
    const user = userEvent.setup();
    stubFetch(409, { error: "order_closed", message: "No se puede asignar un técnico a una orden completada o cancelada." });
    renderControl();

    await assign(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("No se puede asignar un técnico a una orden completada o cancelada.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says so inline when the request never lands, and re-enables the control", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderControl();

    await assign(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
    expect(screen.getByRole("button", { name: "Asignar" })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not report a connection failure when the refresh throws after an accepted assignment", async () => {
    const user = userEvent.setup();
    stubFetch(201, { created: true });
    refresh.mockImplementationOnce(() => {
      throw new Error("refresh blew up");
    });
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      renderControl();
      await assign(user);
      await vi.waitFor(() => expect(escaped).toHaveLength(1));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(screen.queryByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")).not.toBeInTheDocument();
    expect(screen.getByText("Técnico asignado")).toBeInTheDocument();
  });

  it("says everyone is already assigned instead of rendering an empty select", () => {
    renderControl([]);

    expect(screen.getByText("Todos los técnicos activos ya están asignados.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Asignar técnico")).not.toBeInTheDocument();
  });

  it("keeps the select and the button at the 44px floor", () => {
    renderControl();

    expect(screen.getByLabelText("Asignar técnico")).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Asignar" })).toHaveClass("min-h-11", "min-w-11");
  });
});
