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
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";
import { OrderStatusControls } from "./OrderStatusControls";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

/** The real provider, not a fake: it portals into `document.body`, which is what `screen` queries. */
function renderControls() {
  return render(
    <ToastProvider>
      <OrderStatusControls orderId="o1" status="open" />
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
