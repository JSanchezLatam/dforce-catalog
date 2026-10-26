/**
 * `transitionTo` was `try`/`finally` around a `fetch` with no `catch` — the
 * fourth instance of this repo's silent-write defect, and the one with the
 * least cover: this component had no test file at all.
 *
 * `fetch` REJECTS on a network failure rather than returning a non-ok
 * response, so the buttons re-enabled with no toast and the operator clicked
 * into the same silence. It is worse here than on the other five surfaces
 * that share this copy: nothing is typed, so there is no dialog left open to
 * hint that anything went wrong — the page simply looks like the click did
 * nothing.
 *
 * See `.claude/skills/component-testing/SKILL.md` for why this is `.test.tsx`.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";
import { OrderStatusControls } from "./OrderStatusControls";
import type { OrderStatus } from "./transitions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

/** The real provider, not a fake: it portals into `document.body`, which is what `screen` queries. */
function renderControls(status: OrderStatus = "diagnosing") {
  return render(
    <ToastProvider>
      <OrderStatusControls orderId="o1" status={status} canAssign />
    </ToastProvider>,
  );
}

/**
 * Both failure paths assert the button comes BACK. Deleting the `finally` in
 * `transitionTo` strands `isSubmitting` at true on both, so every status button
 * reads "Actualizando…" forever and the operator is locked out of that order
 * until they reload — and without these two assertions all three tests here
 * stayed green. That is `user-lifecycle` WU3's CRITICAL by name, the one
 * `UserForm.tsx`'s own comment memorializes, and every sibling
 * network-failure test pins it.
 */
describe("OrderStatusControls — a network failure has to say so", () => {
  it("tells the operator the status did not change when the request never lands", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    renderControls();
    await user.click(screen.getByRole("button", { name: "Marcar como En progreso" }));

    expect(await screen.findByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")).toBeInTheDocument();
    // And it never pretends the transition happened.
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Marcar como En progreso" })).toBeEnabled();
  });

  it("keeps the generic message for a request that arrived and was refused", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    renderControls();
    await user.click(screen.getByRole("button", { name: "Marcar como En progreso" }));

    expect(await screen.findByText("No se pudo actualizar el estado de la orden.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Marcar como En progreso" })).toBeEnabled();
  });

  /**
   * `router.refresh()` sits BELOW the try/catch so a refresh that throws is not
   * reported as a connection failure over a transition the server already
   * accepted. Nothing pinned that until now — moving it back inside the `try`
   * left every test here green.
   *
   * This surface can prove it and the three dialog forms cannot: their error
   * renders inside a dialog their own post-success line has already closed, so
   * the wrong message goes nowhere either way. The toast is a portal on
   * `document.body`, so it survives and can be asserted absent.
   */
  it("does not blame the network when the refresh itself throws after an accepted transition", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const boom = new Error("refresh blew up");
    refresh.mockImplementationOnce(() => {
      throw boom;
    });

    // The throw ESCAPES `transitionTo` — that is the property under test — so
    // it surfaces as an unhandled rejection. Captured here rather than left
    // for the runner: this repo already learned (`customers/service.test.ts`)
    // that a stray unhandled rejection is silent under this config and a red
    // suite under a stricter one. Capturing it also turns "no toast appeared"
    // into a positive assertion — the error went somewhere, and that somewhere
    // was not the operator's screen.
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      renderControls();
      await user.click(screen.getByRole("button", { name: "Marcar como En progreso" }));

      await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(escaped).toContain(boom));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(screen.queryByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")).not.toBeInTheDocument();
  });

  it("refreshes the page once the transition is accepted", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    renderControls();
    await user.click(screen.getByRole("button", { name: "Marcar como En progreso" }));

    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});

/**
 * These sat at `size="sm"` — `h-7`, 28px — beside `Editar orden` and
 * `Imprimir`, which both carry the floor, so the detail header rendered three
 * different button heights. AGENTS.md's standing exception is a filter strip
 * whose controls read as one control against `h-8` inputs; a detail page on a
 * workshop tablet is not that.
 *
 * The class, not the pixels: jsdom has no Tailwind and cannot measure a
 * rendered height. The browser check is what settles the real 44.
 */
it("keeps every status control at the 44x44 floor", () => {
  renderControls(); // the harness, which supplies the ToastProvider the component needs

  const buttons = screen.getAllByRole("button", { name: /Marcar como/ });
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    expect(button.className).toContain("min-h-11");
    expect(button.className).toContain("min-w-11");
  }
});

// A phone fits one "Marcar como …" button per line, not two: the row must wrap.
// Class, not pixels, for the same jsdom reason as above.
it("lets the status controls wrap onto a second line", () => {
  renderControls();

  const [button] = screen.getAllByRole("button", { name: /Marcar como/ });
  expect(button.parentElement!.className).toContain("flex-wrap");
});

/**
 * The route answers 403 to a técnico asking for done/cancelled/send-back, so the
 * buttons are not offered: a control that can only fail is a trap.
 */
describe("OrderStatusControls — only what the role may do", () => {
  const labels = () => screen.queryAllByRole("button").map((b) => b.textContent);

  function renderFor(status: OrderStatus, canAssign: boolean) {
    return render(
      <ToastProvider>
        <OrderStatusControls orderId="o1" status={status} canAssign={canAssign} />
      </ToastProvider>,
    );
  }

  it("offers a técnico nothing on a diagnosing order: every manual transition is staff-only", () => {
    renderFor("diagnosing", false);
    expect(labels()).toEqual([]);
  });

  it("offers a técnico nothing on an in_progress order", () => {
    renderFor("in_progress", false);
    expect(labels()).toEqual([]);
  });

  it("offers a técnico nothing on a ready_for_review order", () => {
    renderFor("ready_for_review", false);
    expect(labels()).toEqual([]);
  });

  it("offers staff one hold button per reason, then close and cancel, on an in_progress order", () => {
    renderFor("in_progress", true);
    expect(labels()).toEqual([
      "Marcar como En espera (repuesto)",
      "Marcar como En espera (aprobación del cliente)",
      "Marcar como Completada",
      "Marcar como Cancelada",
    ]);
  });

  it("offers staff resume and cancel on an on_hold order", () => {
    renderFor("on_hold", true);
    expect(labels()).toEqual(["Reanudar", "Marcar como Cancelada"]);
  });

  it("offers staff receive and cancel on a booked order", () => {
    renderFor("booked", true);
    expect(labels()).toEqual(["Recibir", "Marcar como Cancelada"]);
  });

  it("offers a técnico nothing on a booked or an on_hold order", () => {
    renderFor("booked", false);
    expect(labels()).toEqual([]);
    cleanup();
    renderFor("on_hold", false);
    expect(labels()).toEqual([]);
  });

  it("offers staff the send-back, the close and the cancel on a ready_for_review order", () => {
    renderFor("ready_for_review", true);
    expect(labels()).toEqual(["Marcar como En progreso", "Marcar como Completada", "Marcar como Cancelada"]);
  });
});

/**
 * D7 and the "Status Actions Confirm With a Toast" requirement: two hold
 * buttons carry the reason, every success toasts with the spec's copy, and a
 * refusal stays inline with no success toast.
 */
describe("OrderStatusControls — hold, resume, receive", () => {
  function okFetch() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function sentBody(fetchMock: ReturnType<typeof okFetch>) {
    return JSON.parse(fetchMock.mock.calls[0][1].body);
  }

  it.each([
    ["Marcar como En espera (repuesto)", "repuesto"],
    ["Marcar como En espera (aprobación del cliente)", "aprobacion_cliente"],
  ])("sends the reason of the button pressed: %s", async (name, esperaMotivo) => {
    const user = userEvent.setup();
    const fetchMock = okFetch();

    renderControls("in_progress");
    await user.click(screen.getByRole("button", { name }));

    expect(sentBody(fetchMock)).toEqual({ status: "on_hold", esperaMotivo });
    expect(await screen.findByText("Orden puesta en espera")).toBeInTheDocument();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("resumes with no reason on the wire and says so", async () => {
    const user = userEvent.setup();
    const fetchMock = okFetch();

    renderControls("on_hold");
    await user.click(screen.getByRole("button", { name: "Reanudar" }));

    expect(sentBody(fetchMock)).toEqual({ status: "in_progress" });
    expect(await screen.findByText("Orden reanudada")).toBeInTheDocument();
  });

  it("receives a booked order and says so", async () => {
    const user = userEvent.setup();
    const fetchMock = okFetch();

    renderControls("booked");
    await user.click(screen.getByRole("button", { name: "Recibir" }));

    expect(sentBody(fetchMock)).toEqual({ status: "open" });
    expect(await screen.findByText("Orden recibida")).toBeInTheDocument();
  });

  it("confirms diagnosing -> in progress with its own copy", async () => {
    const user = userEvent.setup();
    okFetch();

    renderControls("diagnosing");
    await user.click(screen.getByRole("button", { name: "Marcar como En progreso" }));

    expect(await screen.findByText("Orden pasada a En progreso")).toBeInTheDocument();
  });

  it("confirms a cancellation", async () => {
    const user = userEvent.setup();
    okFetch();

    renderControls("in_progress");
    await user.click(screen.getByRole("button", { name: "Marcar como Cancelada" }));

    expect(await screen.findByText("Orden cancelada")).toBeInTheDocument();
  });

  it("shows the server's Spanish refusal inline and no success toast", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ errors: { form: "Completá el vehículo y la categoría antes de recibir la orden" } }),
      }),
    );

    renderControls("booked");
    await user.click(screen.getByRole("button", { name: "Recibir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Completá el vehículo y la categoría antes de recibir la orden");
    expect(screen.queryByText("Orden recibida")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows a refused hold's reason message inline", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ errors: { esperaMotivo: "Indicá el motivo de la espera: repuesto o aprobación del cliente" } }),
      }),
    );

    renderControls("in_progress");
    await user.click(screen.getByRole("button", { name: "Marcar como En espera (repuesto)" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Indicá el motivo de la espera: repuesto o aprobación del cliente");
    expect(screen.queryByText("Orden puesta en espera")).not.toBeInTheDocument();
  });

  it("clears the inline error when the next attempt starts", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true, status: 200 }),
    );

    renderControls("booked");
    await user.click(screen.getByRole("button", { name: "Recibir" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Recibir" }));
    await screen.findByText("Orden recibida");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // The throw ESCAPES `run` (that is the property), so it surfaces as an unhandled rejection.
  it("keeps the success toast when the refresh throws after an accepted hold", async () => {
    const user = userEvent.setup();
    okFetch();
    const boom = new Error("refresh blew up");
    refresh.mockImplementationOnce(() => {
      throw boom;
    });
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      renderControls("in_progress");
      await user.click(screen.getByRole("button", { name: "Marcar como En espera (repuesto)" }));
      await vi.waitFor(() => expect(escaped).toContain(boom));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(screen.getByText("Orden puesta en espera")).toBeInTheDocument();
  });

  it("keeps the hold, resume and receive buttons at the 44x44 floor", () => {
    for (const status of ["in_progress", "on_hold", "booked"] as const) {
      const { unmount } = renderControls(status);
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(button.className).toContain("min-h-11");
        expect(button.className).toContain("min-w-11");
      }
      unmount();
    }
  });
});
