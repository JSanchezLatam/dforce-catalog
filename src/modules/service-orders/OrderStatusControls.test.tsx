/**
 * `transitionTo` was `try`/`finally` around a `fetch` with no `catch` — the
 * fourth instance of this repo's silent-write defect, and the one with the
 * least cover: this component had no test file at all.
 *
 * `fetch` REJECTS on a network failure rather than returning a non-ok
 * response, so the buttons re-enabled with no toast and the operator clicked
 * into the same silence. It is worse here than on the three forms: nothing is
 * typed, so there is no dialog left open to hint that anything went wrong —
 * the page simply looks like the click did nothing.
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

describe("OrderStatusControls — a network failure has to say so", () => {
  it("tells the operator the status did not change when the request never lands", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    renderControls();
    await user.click(screen.getByRole("button", { name: "Marcar como En progreso" }));

    expect(await screen.findByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")).toBeInTheDocument();
    // And it never pretends the transition happened.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the generic message for a request that arrived and was refused", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    renderControls();
    await user.click(screen.getByRole("button", { name: "Marcar como En progreso" }));

    expect(await screen.findByText("No se pudo actualizar el estado de la orden.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes the page once the transition is accepted", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    renderControls();
    await user.click(screen.getByRole("button", { name: "Marcar como En progreso" }));

    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
