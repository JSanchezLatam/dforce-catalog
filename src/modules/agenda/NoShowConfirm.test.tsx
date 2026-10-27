/** `fetch` returns REAL `Response` objects with the route's wire shapes; toast and router are spies. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const addToast = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast }) }));

import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { makeItem } from "./items.fixture";
import { NoShowConfirm } from "./NoShowConfirm";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const STALE = { error: "stale_status", message: "La orden cambió mientras la mirabas. Actualizá la agenda." };

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

const vencida = makeItem({ overdue: true });
const trigger = () => screen.getByRole("button", { name: "No se presentó" });
const confirm = () => screen.getByRole("button", { name: /^(Cancelar la orden|Cancelando)/ });

async function open() {
  const user = userEvent.setup();
  render(<NoShowConfirm item={vencida} />);
  await user.click(trigger());
  return user;
}

describe("NoShowConfirm", () => {
  it("Confirmation precedes the request: opening states the cancellation and sends nothing; dismissing sends nothing", async () => {
    const calls = stubFetch();
    const user = await open();

    expect(screen.getByText(/se cancelará/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Volver" }));
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirming PATCHes exactly status cancelled with expectedStatus booked", async () => {
    const calls = stubFetch();
    const user = await open();
    await user.click(confirm());

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/service-orders/o1");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ status: "cancelled", expectedStatus: "booked" });
  });

  it("Success feedback: toast above refresh, refresh below the try/catch, dialog closes", async () => {
    stubFetch();
    refresh.mockImplementation(() => { throw new Error("refresh blew up"); });
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      const user = await open();
      await user.click(confirm());
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(escaped).toHaveLength(1));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith("success", "Orden cancelada");
    expect(addToast.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(CONNECTION_ERROR)).not.toBeInTheDocument();
  });

  it.each([
    ["409 stale_status", () => json(STALE, 409), STALE.message],
    ["400 invalid_transition has no Spanish text: the generic line", () => json({ error: "invalid_transition", from: "done", to: "cancelled" }, 400), "No se pudo completar la acción. Intentalo de nuevo."],
    ["403 forbidden", () => json({ error: "forbidden", message: "Solo un administrador o el jefe de taller puede cerrar, cancelar o devolver una orden." }, 403), "Solo un administrador o el jefe de taller puede cerrar, cancelar o devolver una orden."],
  ])("Concurrent change surfaces inline: %s, no toast, dialog open", async (_name, reply, message) => {
    stubFetch(reply);
    const user = await open();
    await user.click(confirm());

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a network failure shows the connection error, no toast", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    const user = await open();
    await user.click(confirm());

    expect(await screen.findByText(CONNECTION_ERROR)).toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("disables the confirm button while the request is in flight", async () => {
    let release: (r: Response) => void = () => {};
    stubFetch(() => new Promise<Response>((resolve) => { release = resolve; }));
    const user = await open();
    await user.click(confirm());

    expect(await screen.findByRole("button", { name: "Cancelando…" })).toBeDisabled();
    release(json({ orden: {} }));
  });

  it.each([
    ["a booked appointment that is not yet Vencida", makeItem({ overdue: false })],
    ["a non-booked appointment", makeItem({ muted: true, status: "open", overdue: false })],
  ])("Not offered where it does not apply: %s", (_name, i) => {
    render(<NoShowConfirm item={i} />);
    expect(screen.queryByRole("button", { name: "No se presentó" })).not.toBeInTheDocument();
  });
});
