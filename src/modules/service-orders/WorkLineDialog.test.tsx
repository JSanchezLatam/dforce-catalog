/**
 * Add/edit dialog for a work line. Fixtures follow the wire: POST answers 201
 * `{ id }`, PATCH 200 `{ success }`, validation 400 `{ errors: { campo } }`, a
 * refused correction 403 `{ error: "wrong_password", message }`. See
 * `.claude/skills/component-testing/SKILL.md`.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";
import { WorkLineDialog } from "./WorkLineDialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const TWO = [
  { tecnicoId: "t1", nombre: "Ana Mecánica" },
  { tecnicoId: "t2", nombre: "Beto Frenos" },
];
const LINE = { id: "l1", tecnicoId: "t1", descripcion: "Cambio de pastillas", duracionMinutos: 90, fecha: "2026-03-04" };

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 2, 9, 15, 0) }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type Props = Partial<React.ComponentProps<typeof WorkLineDialog>>;
function renderAdd(props: Props = {}) {
  render(
    <ToastProvider>
      <WorkLineDialog orderId="o1" assignees={TWO} correcting={false} triggerLabel="Agregar línea" {...props} />
    </ToastProvider>,
  );
}

const open = (user: ReturnType<typeof userEvent.setup>, name = "Agregar línea") => user.click(screen.getByRole("button", { name }));
const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

async function fill(user: ReturnType<typeof userEvent.setup>, descripcion: string, minutos: string) {
  await user.type(screen.getByLabelText("Qué se hizo"), descripcion);
  await user.type(screen.getByLabelText("Minutos"), minutos);
}

describe("WorkLineDialog — the form's inputs", () => {
  it("takes minutes with a numeric keyboard and the day from a native date input, defaulting to today", async () => {
    const user = setup();
    renderAdd();
    await open(user);

    const minutes = screen.getByLabelText("Minutos");
    expect(minutes).toHaveAttribute("inputmode", "numeric");
    const day = screen.getByLabelText("Fecha");
    expect(day).toHaveAttribute("type", "date");
    // Local calendar day, not the UTC one: 15:00 on 9 March in the workshop.
    expect(day).toHaveValue("2026-03-09");
  });

  it("derives today from local getters, never from toISOString (the UTC day)", async () => {
    const user = setup();
    // A zone far enough from UTC makes the two days differ; pinning toISOString proves it is not read, whatever zone this runs in.
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2099-01-01T00:00:00.000Z");
    renderAdd();
    await open(user);

    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-03-09");
  });

  it("holds the controls at the 44px floor", async () => {
    const user = setup();
    renderAdd();
    await open(user);

    expect(screen.getByLabelText("Minutos")).toHaveClass("min-h-11");
    expect(screen.getByLabelText("Fecha")).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Guardar" })).toHaveClass("min-h-11", "min-w-11");
  });

  it("offers a technician select over the assignees when there are several, and none when there is one", async () => {
    const user = setup();
    renderAdd();
    await open(user);
    expect(Array.from(screen.getByLabelText("Técnico").querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "Elegí un técnico",
      "Ana Mecánica",
      "Beto Frenos",
    ]);
  });

  it("names the technician instead of asking when only one is allowed (a técnico's own line)", async () => {
    const user = setup();
    renderAdd({ assignees: [TWO[0]] });
    await open(user);

    expect(screen.queryByLabelText("Técnico")).not.toBeInTheDocument();
    expect(screen.getByText("Ana Mecánica")).toBeInTheDocument();
  });

  it("asks for no password on an open correction-free order", async () => {
    const user = setup();
    renderAdd();
    await open(user);

    expect(screen.queryByLabelText("Tu contraseña")).not.toBeInTheDocument();
  });
});

describe("WorkLineDialog — adding", () => {
  it("POSTs the line with the chosen technician and numbers as numbers, then toasts above the refresh", async () => {
    const user = setup();
    const fetchMock = stubFetch(201, { id: "l9" });
    renderAdd();
    await open(user);
    await user.selectOptions(screen.getByLabelText("Técnico"), "Beto Frenos");
    await fill(user, "Cambio de aceite", "45");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/service-orders/o1/work-lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tecnicoId: "t2", descripcion: "Cambio de aceite", duracionMinutos: 45, fecha: "2026-03-09" }),
    });
    expect(await screen.findByText("Línea agregada")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the 'Línea agregada' toast when the refresh throws", async () => {
    const user = setup();
    stubFetch(201, { id: "l9" });
    refresh.mockImplementationOnce(() => {
      throw new Error("refresh blew up");
    });
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      renderAdd({ assignees: [TWO[0]] });
      await open(user);
      await fill(user, "Revisión", "30");
      await user.click(screen.getByRole("button", { name: "Guardar" }));
      await vi.waitFor(() => expect(escaped).toHaveLength(1));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(screen.getByText("Línea agregada")).toBeInTheDocument();
  });

  it("sends the only allowed technician without asking", async () => {
    const user = setup();
    const fetchMock = stubFetch(201, { id: "l9" });
    renderAdd({ assignees: [TWO[0]] });
    await open(user);
    await fill(user, "Revisión", "30");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tecnicoId).toBe("t1");
  });

  it("keeps Guardar disabled until a technician is chosen", async () => {
    const user = setup();
    renderAdd();
    await open(user);
    await fill(user, "Revisión", "30");

    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("shows each server field error under its field, with no toast and no refresh", async () => {
    const user = setup();
    stubFetch(400, {
      errors: { descripcion: "Escribí qué se hizo", duracionMinutos: "Los minutos tienen que ser un entero entre 1 y 1440", fecha: "La fecha no es válida" },
    });
    renderAdd({ assignees: [TWO[0]] });
    await open(user);
    await fill(user, "x", "5");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Escribí qué se hizo")).toBeInTheDocument();
    expect(screen.getByText("Los minutos tienen que ser un entero entre 1 y 1440")).toBeInTheDocument();
    expect(screen.getByText("La fecha no es válida")).toBeInTheDocument();
    expect(screen.queryByText("Línea agregada")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows a refusal's Spanish message inline (409 parte_lista)", async () => {
    const user = setup();
    stubFetch(409, { error: "parte_lista", message: "Desmarcá tu parte lista antes de cambiar líneas de trabajo" });
    renderAdd({ assignees: [TWO[0]] });
    await open(user);
    await fill(user, "x", "5");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Desmarcá tu parte lista antes de cambiar líneas de trabajo");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says so inline when the request never lands, and keeps the dialog and what was typed", async () => {
    const user = setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderAdd({ assignees: [TWO[0]] });
    await open(user);
    await fill(user, "Revisión", "30");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
    expect(screen.getByLabelText("Qué se hizo")).toHaveValue("Revisión");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it("forgets the chosen technician after being closed", async () => {
    const user = setup();
    renderAdd();
    await open(user);
    await user.selectOptions(screen.getByLabelText("Técnico"), "Beto Frenos");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await open(user);

    expect(screen.getByLabelText("Técnico")).toHaveValue("");
  });

  it("starts empty again after being closed", async () => {
    const user = setup();
    renderAdd({ assignees: [TWO[0]] });
    await open(user);
    await fill(user, "Borrador", "10");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await open(user);

    expect(screen.getByLabelText("Qué se hizo")).toHaveValue("");
    expect(screen.getByLabelText("Minutos")).toHaveValue(null);
  });
});

describe("WorkLineDialog — editing", () => {
  function renderEdit(props: Props = {}) {
    renderAdd({ line: LINE, assignees: undefined, triggerLabel: "Editar", ...props });
  }

  it("starts from the line, shows no technician choice, and PATCHes only what changed", async () => {
    const user = setup();
    const fetchMock = stubFetch(200, { success: true });
    renderEdit();
    await open(user, "Editar");

    expect(screen.getByLabelText("Qué se hizo")).toHaveValue("Cambio de pastillas");
    expect(screen.getByLabelText("Minutos")).toHaveValue(90);
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-03-04");
    expect(screen.queryByLabelText("Técnico")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Minutos"));
    await user.type(screen.getByLabelText("Minutos"), "120");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/service-orders/o1/work-lines/l1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duracionMinutos: 120 }),
    });
    expect(await screen.findByText("Línea actualizada")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the server's 'no changes' refusal inline instead of closing", async () => {
    const user = setup();
    stubFetch(400, { errors: { form: "No hay cambios para guardar" } });
    renderEdit();
    await open(user, "Editar");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No hay cambios para guardar");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("WorkLineDialog — correcting a closed order", () => {
  it("asks for the password, keeps Guardar disabled without it, and sends it", async () => {
    const user = setup();
    const fetchMock = stubFetch(201, { id: "l9" });
    renderAdd({ correcting: true, assignees: [TWO[0]] });
    await open(user);
    await fill(user, "Corrección", "15");

    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    await user.type(screen.getByLabelText("Tu contraseña"), "secreta");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).password).toBe("secreta");
  });

  it("never sends a password on an open order", async () => {
    const user = setup();
    const fetchMock = stubFetch(201, { id: "l9" });
    renderAdd({ assignees: [TWO[0]] });
    await open(user);
    await fill(user, "x", "5");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("password");
  });

  it("shows a wrong password under the password field and clears it", async () => {
    const user = setup();
    stubFetch(403, { error: "wrong_password", message: "Contraseña incorrecta" });
    renderAdd({ correcting: true, assignees: [TWO[0]] });
    await open(user);
    await fill(user, "x", "5");
    await user.type(screen.getByLabelText("Tu contraseña"), "mala");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Contraseña incorrecta")).toBeInTheDocument();
    expect(screen.getByLabelText("Tu contraseña")).toHaveValue("");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows a throttled refusal under the password field too", async () => {
    const user = setup();
    stubFetch(429, { error: "throttled", message: "Demasiados intentos. Probá de nuevo en 15 minutos." });
    renderAdd({ correcting: true, assignees: [TWO[0]] });
    await open(user);
    await fill(user, "x", "5");
    await user.type(screen.getByLabelText("Tu contraseña"), "x");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Demasiados intentos. Probá de nuevo en 15 minutos.")).toBeInTheDocument();
  });
});
