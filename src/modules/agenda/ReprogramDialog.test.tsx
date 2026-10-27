/** `fetch` returns REAL `Response` objects with the route's wire shapes; toast and router are spies. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const addToast = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast }) }));

import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { makeItem } from "./items.fixture";
import { ReprogramDialog } from "./ReprogramDialog";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(reply: () => Response | Promise<Response> = () => json({ orden: { id: "o1" } })) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return reply(); }));
  return calls;
}

const ORIGINAL_TZ = process.env.TZ;
beforeEach(() => { process.env.TZ = "Pacific/Auckland"; });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
  addToast.mockReset();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const item = makeItem({ dayKey: "2026-10-26", time: "14:05", overdue: true });
const day = () => screen.getByLabelText("Día") as HTMLInputElement;
const time = () => screen.getByLabelText("Hora") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: /^(Guardar|Guardando)/ });

async function open(i = item) {
  const user = userEvent.setup();
  render(<ReprogramDialog item={i} />);
  await user.click(screen.getByRole("button", { name: "Reprogramar" }));
  return user;
}

async function setMoment(user: ReturnType<typeof userEvent.setup>, d: string, t: string) {
  await user.clear(day());
  await user.type(day(), d);
  await user.clear(time());
  await user.type(time(), t);
}

describe("ReprogramDialog", () => {
  it("Prefilled: the fields read the item's Panama day and time", async () => {
    stubFetch();
    await open();
    expect(day().value).toBe("2026-10-26");
    expect(time().value).toBe("14:05");
  });

  it("Request body: exactly the -05:00 instant under a non-Panama TZ", async () => {
    const calls = stubFetch();
    const user = await open();
    await setMoment(user, "2026-10-30", "15:30");
    await user.click(submit());

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/service-orders/o1");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ appointmentAt: "2026-10-30T15:30:00-05:00" });
  });

  it.each([["day", "Elegí el día"], ["time", "Elegí la hora"]])("an empty %s shows its Spanish message and sends nothing", async (field, message) => {
    const calls = stubFetch();
    const user = await open();
    await user.clear(field === "day" ? day() : time());
    await user.click(submit());

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("Success feedback: closes and toasts once, the toast above refresh and refresh below the try/catch", async () => {
    stubFetch();
    refresh.mockImplementation(() => { throw new Error("refresh blew up"); });
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      const user = await open();
      await user.click(submit());
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(escaped).toHaveLength(1));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith("success", "Cita reprogramada");
    expect(addToast.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(CONNECTION_ERROR)).not.toBeInTheDocument();
  });

  it.each([
    ["403 errors.form", () => json({ errors: { form: "No podés editar esta orden en su estado actual." } }, 403), "No podés editar esta orden en su estado actual."],
    ["409 errors.form", () => json({ errors: { form: "No se puede editar una orden completada o cancelada." } }, 409), "No se puede editar una orden completada o cancelada."],
    ["400 errors.appointmentAt", () => json({ errors: { appointmentAt: "Fecha inválida" } }, 400), "Fecha inválida"],
    ["409 stale message", () => json({ error: "stale_status", message: "La orden cambió mientras la mirabas. Actualizá la agenda." }, 409), "La orden cambió mientras la mirabas. Actualizá la agenda."],
  ])("Order no longer booked: %s shows inline, no toast, dialog open", async (_name, reply, message) => {
    stubFetch(reply);
    const user = await open();
    await user.click(submit());

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a network failure shows the connection error, no toast", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    const user = await open();
    await user.click(submit());

    expect(await screen.findByText(CONNECTION_ERROR)).toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("disables submit while the request is in flight", async () => {
    let release: (r: Response) => void = () => {};
    stubFetch(() => new Promise<Response>((resolve) => { release = resolve; }));
    const user = await open();
    await user.click(submit());

    expect(await screen.findByRole("button", { name: "Guardando…" })).toBeDisabled();
    release(json({ orden: {} }));
  });

  it("Reprogramar not offered to a muted chip; offered to a Vencida one", () => {
    const { rerender } = render(<ReprogramDialog item={makeItem({ muted: true, status: "open" })} />);
    expect(screen.queryByRole("button", { name: "Reprogramar" })).not.toBeInTheDocument();
    rerender(<ReprogramDialog item={item} />);
    expect(screen.getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
  });
});
