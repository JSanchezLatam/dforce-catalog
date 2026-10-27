/**
 * Component tests for `AgendaBookingForm` (jsdom). `fetch` is stubbed with REAL `Response` objects
 * carrying the wire shapes of `GET /api/customers` and `POST /api/service-orders` (dates are ISO
 * strings, not Dates). The toast hook is replaced by a spy so the call order against
 * `router.refresh()` is observable; the real CustomerPicker runs.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const addToast = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast }) }));

import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { AgendaBookingForm } from "./AgendaBookingForm";

const CUSTOMER = { id: "c-ana", name: "Ana Pérez", phone: "50761111111", email: null, deactivatedAt: null, plates: ["ABC111"], createdAt: "2026-01-01T00:00:00.000Z" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Routes by URL: the picker's GET and the booking POST. Returns the POST calls. */
function stubFetch(post: () => Response | Promise<Response> = () => json({ orden: { id: "o1" } }, 201)) {
  const posts: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url, init });
        return post();
      }
      return json({ customers: [CUSTOMER], total: 1 });
    }),
  );
  return posts;
}

const ORIGINAL_TZ = process.env.TZ;
beforeEach(() => {
  // A zone that is neither Panama nor UTC: any local-time `Date` math would shift the instant.
  process.env.TZ = "Pacific/Auckland";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
  addToast.mockReset();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

async function open(day = "2026-11-02") {
  const user = userEvent.setup();
  render(<AgendaBookingForm day={day} />);
  await user.click(screen.getByRole("button", { name: "Agendar cita" }));
  return user;
}

async function pickCustomer(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: /buscar cliente/i }), "Ana");
  await user.click(await screen.findByRole("button", { name: /Seleccionar Ana/i }));
}

const dayField = () => screen.getByLabelText("Día") as HTMLInputElement;
const timeField = () => screen.getByLabelText("Hora") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: /^(Guardar cita|Guardando)/ });

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await pickCustomer(user);
  await user.type(timeField(), "09:00");
  await user.type(screen.getByLabelText("Descripción"), "Cambio de aceite");
  await user.click(submit());
}

describe("AgendaBookingForm", () => {
  it("Request body: exactly clienteId, booked, the -05:00 instant and description, no vehicle, category or technician", async () => {
    const posts = stubFetch();
    const user = await open();
    await fillAndSubmit(user);

    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe("/api/service-orders");
    expect(JSON.parse(posts[0].init.body as string)).toEqual({
      clienteId: "c-ana",
      status: "booked",
      appointmentAt: "2026-11-02T09:00:00-05:00",
      description: "Cambio de aceite",
    });
  });

  it("Prefilled day: the day field reads the day it was opened from", async () => {
    stubFetch();
    await open("2026-11-05");
    expect(dayField().value).toBe("2026-11-05");
  });

  it.each([
    ["customer", async () => {}, "Elegí un cliente"],
    ["day", async (u: ReturnType<typeof userEvent.setup>) => { await pickCustomer(u); await u.type(timeField(), "09:00"); await u.clear(dayField()); }, "Elegí el día"],
    ["time", async (u: ReturnType<typeof userEvent.setup>) => { await pickCustomer(u); }, "Elegí la hora"],
  ])("Required fields: a missing %s shows its Spanish message and sends nothing", async (_name, setup, message) => {
    const posts = stubFetch();
    const user = await open();
    await setup(user);
    await user.click(submit());

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it("Success feedback: closes, toasts once, and the toast is added above refresh even when refresh throws", async () => {
    stubFetch();
    refresh.mockImplementation(() => {
      throw new Error("refresh blew up");
    });
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      const user = await open();
      await fillAndSubmit(user);
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(escaped).toHaveLength(1));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith("success", "Cita agendada");
    expect(addToast.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(CONNECTION_ERROR)).not.toBeInTheDocument();
  });

  it.each([
    ["409 cliente_deactivated", () => json({ error: "cliente_deactivated" }, 409), "Ese cliente está desactivado. Elegí otro."],
    ["400 errors", () => json({ errors: { appointmentAt: "Fecha inválida" } }, 400), "Fecha inválida"],
    ["400 unknown_cliente", () => json({ error: "unknown_cliente", clienteId: "x" }, 400), "Seleccioná un cliente válido"],
  ])("Server rejection stays inline: %s keeps the dialog open with no toast", async (_name, reply, message) => {
    stubFetch(reply);
    const user = await open();
    await fillAndSubmit(user);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Network failure: says so inline and re-enables the submit", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const user = await open();
    await fillAndSubmit(user);

    expect(await screen.findByText(CONNECTION_ERROR)).toBeInTheDocument();
    expect(submit()).toBeEnabled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("In flight: the submit is disabled until the response lands", async () => {
    let release!: (r: Response) => void;
    const posts = stubFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    const user = await open();
    await fillAndSubmit(user);

    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(submit()).toBeDisabled();
    release(json({ orden: { id: "o1" } }, 201));
    await vi.waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
  });
});
