/**
 * H2 — the reported screen. The owner saw the green "Completada" chip beside
 * "Sincronizar inventario" and read it as too short: 20px of `StatusBadge`
 * against the Button's `h-8`.
 *
 * This file is the only thing tying that fix to the site it was reported on;
 * `StatusBadge.test.tsx` covers the passthrough mechanism, not that this
 * caller uses it.
 *
 * **It does not prove the chip looks right.** `getBoundingClientRect` returns
 * zeros in jsdom, so no test in this repo asserts a rendered height — the 28px
 * and the 32px are Tailwind's, read off `min-h-7` and `h-8`, and only a human
 * looking at `/inventory` can say the pair now reads as one row.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";

import { ManualSyncButton } from "./ManualSyncButton";

/** Shape copied from `src/app/api/inventory-sync/manual/route.ts`'s GET. */
const idleWithLastRun = {
  running: false,
  lastRun: { status: "completed", productCount: 699, finishedAt: "2026-09-10T14:00:00.000Z" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderButton(body: object) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));
  return render(
    <ToastProvider>
      <ManualSyncButton />
    </ToastProvider>,
  );
}

describe("ManualSyncButton — the status chip beside the action", () => {
  it("raises the chip toward the Button's height without matching it", async () => {
    renderButton(idleWithLastRun);

    const chip = await screen.findByText("Completada");
    // 28px. `h-8` — 32px — would make a non-clickable chip the same size as
    // the control next to it, which is the thing this deliberately avoids.
    expect(chip).toHaveClass("min-h-7");
    expect(chip).not.toHaveClass("h-8");
  });

  it("keeps the chip and the Button on one centred row", async () => {
    renderButton(idleWithLastRun);

    const chip = await screen.findByText("Completada");
    const row = chip.parentElement!;

    expect(row).toHaveClass("flex");
    expect(row).toHaveClass("items-center");
    expect(within(row).getByRole("button", { name: "Sincronizar inventario" })).toBeInTheDocument();
  });

  it("sizes the in-progress chip the same, so the row does not jump on click", async () => {
    renderButton({ running: true, lastRun: null });

    await waitFor(() => expect(screen.getByText("Sincronizando…", { selector: "span" })).toHaveClass("min-h-7"));
  });

  /**
   * `mb-4` is a desktop offset (the row sits in a centred flex row beside the
   * stats text). Stacked in the phone card (`flex-col`) it is 16px of dead space
   * under the button. Class string only: jsdom has no layout.
   */
  it("drops its bottom margin below sm, where the stats card stacks", async () => {
    renderButton(idleWithLastRun);

    const row = (await screen.findByText("Completada")).parentElement!;
    expect(row).toHaveClass("mb-4", "max-sm:mb-0");
  });

  /**
   * Audit #8: the stats card is `overflow-hidden`, and at 390 the Button plus
   * the chip do not fit side by side, so the green chip was clipped at the
   * card's edge ("Co…"). The row wraps instead, and the chip itself carries
   * nothing that truncates. Class string only: jsdom has no layout.
   */
  it("wraps the chip under the Button instead of clipping it, and never truncates it", async () => {
    renderButton(idleWithLastRun);

    const chip = await screen.findByText("Completada");
    expect(chip.parentElement).toHaveClass("flex-wrap");
    expect(chip).not.toHaveClass("truncate");
    expect(chip).not.toHaveClass("overflow-hidden");
    expect(chip).not.toHaveClass("whitespace-nowrap");
  });
});
