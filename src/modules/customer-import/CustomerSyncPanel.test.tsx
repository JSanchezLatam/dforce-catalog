/**
 * R21/D6 — this component had NO test file at all before this one. Covers
 * the request shape, both report paths (success/non-ok), and the network
 * failure `fetch` itself can raise, which the component previously had no
 * `catch` for (same defect already fixed once in `CustomerActivationButton`).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";
import { CustomerSyncPanel } from "./CustomerSyncPanel";

type FetchArgs = [string, RequestInit];

function mockFetch(impl: () => unknown) {
  const fetchMock = vi.fn<(...args: FetchArgs) => unknown>(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = (body: object) => ({ ok: true, status: 200, json: async () => body });

// Literal from `src/app/api/customer-import/route.ts`'s `InterfuerzaAbortError`
// branch. Pinning this — rather than a string this test file invents — is
// what would actually catch drift between what the route sends and what the
// operator reads; `route.test.ts` pins the same literal on the route side.
const ABORTED_IMPORT_MESSAGE =
  "No se pudo completar la importación. No se guardó ningún cambio; probá de nuevo más tarde.";
// The component's own fallback, used both when a non-ok response carries no
// `error` field and when `fetch` itself rejects (CustomerSyncPanel.tsx).
const GENERIC_IMPORT_ERROR = "No se pudo sincronizar a los clientes.";

function renderPanel(total = 0) {
  return render(
    <ToastProvider>
      <CustomerSyncPanel total={total} />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CustomerSyncPanel (R21)", () => {
  it("posts to /api/customer-import", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(() => ok({ created: 0, updated: 0, skipped: [] }));
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Sincronizar clientes" }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/customer-import");
    expect(init.method).toBe("POST");
  });

  it("reports created / updated / skipped to the operator on a successful run", async () => {
    const user = userEvent.setup();
    mockFetch(() => ok({ created: 2, updated: 1, skipped: [{ externalId: "9", name: "Sin Telefono", reason: "missing_phone" }] }));
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Sincronizar clientes" }));

    expect(await screen.findByRole("status")).toHaveTextContent("2 nuevos, 1 actualizados, 1 omitidos");
  });

  it("shows the server's exact failure message when the response is not ok and carries one", async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ ok: false, status: 502, json: async () => ({ error: ABORTED_IMPORT_MESSAGE }) }));
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Sincronizar clientes" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(ABORTED_IMPORT_MESSAGE);
    expect(status).not.toHaveTextContent("nuevos");
  });

  it("shows the generic fallback when the response is not ok and carries no server message", async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Sincronizar clientes" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(GENERIC_IMPORT_ERROR);
  });

  // The path that had no branch at all: `fetch` REJECTS on a network failure
  // rather than returning a non-ok response. Without a catch the button
  // re-enabled with nothing on screen and the operator clicked again into
  // the same silence.
  it("shows an error when fetch itself rejects", async () => {
    const user = userEvent.setup();
    mockFetch(() => {
      throw new Error("network down");
    });
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Sincronizar clientes" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(GENERIC_IMPORT_ERROR);
  });

  it("re-enables the button after a failure so the action can be retried", async () => {
    const user = userEvent.setup();
    mockFetch(() => {
      throw new Error("network down");
    });
    renderPanel();

    const button = screen.getByRole("button", { name: "Sincronizar clientes" });
    await user.click(button);

    await screen.findByRole("status");
    expect(button).toBeEnabled();
  });

  // Finding 5 / D5 — the skip report exists so "the owner can add the real
  // number". A count alone ("9 omitidos") names nobody; the operator needs
  // the actual name on screen to act on it.
  it("lists a skipped customer by name so the owner can act on it", async () => {
    const user = userEvent.setup();
    mockFetch(() =>
      ok({ created: 0, updated: 0, skipped: [{ externalId: "9", name: "Sin Telefono", reason: "missing_phone" }] }),
    );
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Sincronizar clientes" }));

    expect(await screen.findByText("Sin Telefono — sin teléfono")).toBeInTheDocument();
  });

  // Finding 1 — `mapCustomerRow` (mapper.ts) emits THREE reasons, not one.
  // The heading used to hard-code "Omitidos por falta de teléfono:" for every
  // row regardless of `reason`, so a `missing_name` or `missing_external_id`
  // skip rendered under a false claim. One fixture per `SkipReason` (job.ts)
  // so each reason's copy is actually asserted, not just `missing_phone`.
  it("names the reason for a customer skipped for a missing name", async () => {
    const user = userEvent.setup();
    mockFetch(() =>
      ok({ created: 0, updated: 0, skipped: [{ externalId: "9", name: null, reason: "missing_name" }] }),
    );
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Sincronizar clientes" }));

    expect(await screen.findByText("9 — sin nombre")).toBeInTheDocument();
  });

  // Regression: `planImport` dedupes insert/update rows within a run but
  // passes skips through untouched, so a page-boundary repeat can produce two
  // skipped rows sharing one `externalId`. The old key (`externalId ?? name-i`)
  // collided on those; both rows still render (React only warns on a
  // duplicate key, it doesn't drop the row), so this asserts both text
  // labels AND that React logged no duplicate-key warning for the render.
  it("renders both rows and logs no duplicate-key warning when two skips share an externalId", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(() =>
      ok({
        created: 0,
        updated: 0,
        skipped: [
          { externalId: "9", name: "Cliente Uno", reason: "missing_phone" },
          { externalId: "9", name: "Cliente Dos", reason: "missing_phone" },
        ],
      }),
    );
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Sincronizar clientes" }));

    expect(await screen.findByText("Cliente Uno — sin teléfono")).toBeInTheDocument();
    expect(screen.getByText("Cliente Dos — sin teléfono")).toBeInTheDocument();

    const duplicateKeyWarnings = consoleError.mock.calls.filter(
      (args) => typeof args[0] === "string" && /key/i.test(args[0]),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);

    consoleError.mockRestore();
  });

  it("names the reason for a customer skipped for a missing external id", async () => {
    const user = userEvent.setup();
    mockFetch(() =>
      ok({
        created: 0,
        updated: 0,
        skipped: [{ externalId: null, name: "Sin Externo", reason: "missing_external_id" }],
      }),
    );
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Sincronizar clientes" }));

    expect(await screen.findByText("Sin Externo — sin identificador externo")).toBeInTheDocument();
  });
});

/**
 * The skip report is the only surface saying the import did NOT bring
 * everything in. It rendered as plain muted text outside any live region, so
 * a screen reader heard the success toast ("Sincronización completa …") and
 * nothing at all about the rows that were left behind — the one part of the
 * result the operator has to act on.
 */
describe("CustomerSyncPanel — the skip report is announced", () => {
  it("puts the skipped rows in a live region so a screen reader learns the import partially failed", async () => {
    const user = userEvent.setup();
    mockFetch(() =>
      ok({ created: 1, updated: 0, skipped: [{ externalId: "9", name: "Sin Telefono", reason: "missing_phone" }] }),
    );
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Sincronizar clientes" }));

    // `role="alert"`, not the toast's `role="status"`: the toast reports the
    // run finished, this reports part of it did not.
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin Telefono — sin teléfono");
  });

  it("renders no live region at all when every row imported", async () => {
    const user = userEvent.setup();
    mockFetch(() => ok({ created: 3, updated: 0, skipped: [] }));
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Sincronizar clientes" }));

    await screen.findByRole("status");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

/**
 * The owner's complaint: the customer list showed no total anywhere, so
 * "how many customers are synced" had no answer on the screen that syncs
 * them. The number is the panel's headline, beside the trigger that changes
 * it — same shape as `inventory-view/InventoryStatsHeader`.
 */
describe("CustomerSyncPanel — the synced-customer total", () => {
  it("shows the total it was handed, under a label naming what it counts", () => {
    renderPanel(368);

    expect(screen.getByText("368")).toBeInTheDocument();
    // The bare number alone is not an answer: 368 of what.
    expect(screen.getByText("Total de clientes")).toBeInTheDocument();
  });

  it("shows a total of zero rather than nothing, so an unsynced database still reads as an answer", () => {
    renderPanel(0);

    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
