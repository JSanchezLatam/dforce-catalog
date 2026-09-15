/**
 * Component tests for the review step's price shape (catalog-templates-and-
 * workshop-info WU4, task 4.11 — R13). No file existed before this unit.
 *
 * Only the review-step price behavior is covered here — the rest of this
 * large form (search, pagination, layout tuner, eviction warning) is out of
 * this WU's scope and already exercised end-to-end by `full-flow.e2e.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CatalogBuilderForm } from "./CatalogBuilderForm";

const CANDIDATE = {
  id: "p1",
  name: "Woofer",
  categoryL1: "Motor",
  categoryL2: null,
  image: null,
  imageType: null,
  // A hostile/real "0.00" socio tier — resolveAllPrices must null it, not send 0.
  priceLists: { "Precio de venta": "45.00", "PRECIO TALLER": "38.00", "Precio Socio": "0.00" },
};

function mockFetch(generateResponse?: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/products")) {
      return Promise.resolve({ ok: true, json: async () => ({ products: [CANDIDATE] }) });
    }
    if (url.includes("/queue-depth")) {
      return Promise.resolve({ ok: true, json: async () => ({ depth: 0 }) });
    }
    if (url.includes("/generate")) {
      return Promise.resolve(
        generateResponse ?? {
          ok: true,
          status: 200,
          json: async () => ({ jobId: "job-1", queuePosition: 0, evictionWarning: false }),
        },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function reachReviewStep(generateResponse?: {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}) {
  const fetchMock = mockFetch(generateResponse);
  const user = userEvent.setup();
  render(<CatalogBuilderForm categoryL1Options={["Motor"]} categoryPairs={[]} catalogCount={0} />);

  await user.click(screen.getByRole("button", { name: /Seleccion.* categor.as/ }));
  await user.click(await screen.findByRole("checkbox", { name: "Motor" }));
  await screen.findByText("Woofer");
  // The select-step "Continue" button and the review-step "open confirm
  // dialog" button share this exact label but are mutually exclusive by
  // `step` — only one is ever mounted, so `getByRole` (which throws on a
  // multi-match) stays the guard if that conditional rendering ever changes.
  await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
  return { fetchMock, user };
}

/**
 * R13, superseded. The review step DOES offer a price-list choice again — but
 * as a checkbox group picking one or two of the three tiers, not the old
 * single-select that collapsed the payload to one list before generation. The
 * distinction that matters and that the previous spec lost: all three tiers
 * still TRAVEL to the worker; this only chooses which ones PRINT.
 */
describe("CatalogBuilderForm — review step picks which price lists print (R13)", () => {
  const box = (label: string) => screen.getByRole("checkbox", { name: label });
  /**
   * Base UI's Checkbox is a `<span role="checkbox">`, not an `<input>`, so it
   * marks refusal with `aria-disabled` — which is what assistive tech reads
   * and what jest-dom's `toBeDisabled()` (native `disabled` only) does not
   * see. Asserting the attribute is asserting the real contract.
   */
  const isBlocked = (label: string) => box(label).getAttribute("aria-disabled") === "true";

  it("offers the three ERP lists, with Venta and Taller pre-chosen", async () => {
    await reachReviewStep();

    expect(box("Venta")).toBeChecked();
    expect(box("Taller")).toBeChecked();
    expect(box("Socio")).not.toBeChecked();
  });

  it("blocks a third choice instead of failing on submit", async () => {
    const { user } = await reachReviewStep();

    // Two are already ticked, so the third must be unreachable — an error
    // shown after the fact would be a worse answer than a control that
    // cannot express the invalid state.
    expect(isBlocked("Socio")).toBe(true);

    await user.click(box("Taller"));
    expect(isBlocked("Socio")).toBe(false);
  });

  it("blocks unticking the last one — a card with no price row is not a catalog", async () => {
    const { user } = await reachReviewStep();

    await user.click(box("Taller"));
    expect(isBlocked("Venta")).toBe(true);
  });

  /**
   * The test that used to sit here ("keeps the live preview's footer honest
   * about the choice") asserted the tier choice reaching the preview's
   * index-page footer. PR F1 removed the preview from this form, so that
   * surface no longer exists here and the test could only have been kept by
   * asserting something the user cannot see. What survives the move is the
   * payload assertion below: the choice is what PRINTS, and every tier's
   * value still travels.
   */
  it("POSTs the chosen tiers, and still sends every tier's VALUE", async () => {
    const { fetchMock, user } = await reachReviewStep();

    await user.click(box("Taller"));
    await user.click(box("Socio"));

    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
    await user.click(await screen.findByRole("button", { name: "Generar catálogo" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/catalog-builder/generate", expect.anything()),
    );
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/catalog-builder/generate")!;
    const [, init] = call as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.tiers).toEqual(["venta", "socio"]);
    // The choice is a RENDER instruction. Stripping the unprinted tiers from
    // the payload would mean re-reading the ERP to reprint the same catalog
    // with a different pair.
    expect(body.products[0].prices).toEqual({ venta: 45, taller: 38, socio: null });
  });
});

/**
 * workshop-feedback-round-1 PR F1. The "Vista previa" card that used to sit at
 * the bottom of this form is gone — it was passed no `productPages`, so it
 * could never show a product (cover, index and contact only), and it rendered
 * at full print size (816 x 1056 px per sheet) inside an ordinary card, which
 * is what overflowed the column and buried the controls under thousands of
 * pixels. What it COULD show is branding, which is `/template-config`'s job,
 * so it renders there now — scaled.
 */
describe("CatalogBuilderForm — the live preview moved out (PR F1)", () => {
  it("renders no preview section and no catalog sheet, in either step", async () => {
    const { user } = await reachReviewStep();

    expect(screen.queryByRole("region", { name: "Vista previa" })).not.toBeInTheDocument();
    // `data-sheet` is CatalogTemplate's own machine handle for a printed sheet
    // (cover / index-N / product-N / contact), so this catches the template
    // being rendered here at all — under any heading, or none.
    expect(document.querySelectorAll("[data-sheet]")).toHaveLength(0);

    // And not on the way back to the selection step either.
    await user.click(screen.getByRole("button", { name: "Volver a la selección" }));
    expect(document.querySelectorAll("[data-sheet]")).toHaveLength(0);
  });
});

describe("CatalogBuilderForm — reviewedProducts carries all three tiers (design D4)", () => {
  it("POSTs prices: resolveAllPrices(priceLists) per product, not a single collapsed price", async () => {
    const { fetchMock, user } = await reachReviewStep();

    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
    await user.click(await screen.findByRole("button", { name: "Generar catálogo" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/catalog-builder/generate", expect.anything()),
    );
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/catalog-builder/generate")!;
    const [, init] = call as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.products[0].prices).toEqual({ venta: 45, taller: 38, socio: null });
    expect(body.products[0].price).toBeUndefined();
    expect(body.products[0].priceLists).toBeUndefined();
  });
});

/**
 * The checkbox group cannot produce an invalid selection, so this 400 only
 * ever comes from a non-UI client or a drifted client/server rule. Either way
 * the message must reach the DOM: an error set into state and rendered nowhere
 * is a dead Generar button with no explanation.
 *
 * The CEILING this docstring used to carry is GONE, and the assertion changed
 * with it. It used to say: a green run proves the message is RENDERED, not
 * that a user can see it — the dialog stayed open with no error surface, so
 * the message landed in the review card BEHIND the overlay, and only jsdom's
 * lack of layering made it pass. The dialog has its own surface now.
 *
 * So the message is in TWO places, deliberately, and this test pins both: the
 * dialog, which is what the operator reads without closing anything, and the
 * review card, which is where they land when they close it to fix the field.
 * A bare `findByText` would now throw on the double match — which is itself
 * the proof that the old assertion could not tell the two apart.
 */
describe("CatalogBuilderForm — a tiers error from the route is shown", () => {
  it("puts it inside the dialog AND in the review card behind it", async () => {
    const { user } = await reachReviewStep({
      ok: false,
      status: 400,
      json: async () => ({ errors: { tiers: "Elegí 1 o 2 listas de precios" } }),
    });

    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
    await user.click(await screen.findByRole("button", { name: "Generar catálogo" }));

    const shown = await screen.findAllByText("Elegí 1 o 2 listas de precios");
    expect(shown).toHaveLength(2);
    expect(within(screen.getByRole("dialog")).getByText("Elegí 1 o 2 listas de precios")).toBeInTheDocument();

    // Two `role="alert"` regions with the same sentence would be announced
    // twice — except exactly one of them is inside the tree the open dialog
    // marks `aria-hidden`, so assistive tech reads the dialog's and not the
    // card's. Measured, and pinned here because it is the half of this fix a
    // sighted reader cannot check.
    expect(shown.filter((el) => el.closest('[aria-hidden="true"]') !== null)).toHaveLength(1);
  });

  // The route answers an unparseable body with `{ errors: { form: "Invalid
  // request body" } }` — English, and not a field anyone can go correct. It
  // was invisible only because nothing rendered `errors.form`; the new surface
  // would have published it verbatim.
  it("does not publish the route's English `form` sentinel to the operator", async () => {
    const { user } = await reachReviewStep({
      ok: false,
      status: 400,
      json: async () => ({ errors: { form: "Invalid request body" } }),
    });

    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
    await user.click(await screen.findByRole("button", { name: "Generar catálogo" }));

    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText(/No se pudo encolar el catálogo/)).toBeInTheDocument();
    expect(screen.queryByText("Invalid request body")).not.toBeInTheDocument();
  });
});

/**
 * The confirm dialog stays OPEN on every failure — the operator has to be able
 * to retry or cancel — so whatever went wrong has to be readable from inside
 * it. It had no error surface at all: the message went to the review card
 * BEHIND the overlay, and only jsdom's lack of layering made that look fine.
 *
 * These assert CONTAINMENT, which jsdom can prove, rather than visibility,
 * which it cannot. `within(dialog)` is the whole point: the same text passing
 * a bare `findByText` is exactly the false green the previous test warned
 * about in its own docstring.
 */
describe("CatalogBuilderForm — a failed confirm is readable from inside the dialog", () => {
  const dialog = () => screen.getByRole("dialog");

  async function confirmAgainst(response: Parameters<typeof reachReviewStep>[0]) {
    const { user } = await reachReviewStep(response);
    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
    await user.click(await screen.findByRole("button", { name: "Generar catálogo" }));
    return user;
  }

  it("shows a field error from the route inside the dialog, not only behind it", async () => {
    await confirmAgainst({
      ok: false,
      status: 400,
      json: async () => ({ errors: { tiers: "Elegí 1 o 2 listas de precios" } }),
    });

    expect(await within(dialog()).findByText("Elegí 1 o 2 listas de precios")).toBeInTheDocument();
  });

  it("shows the queue-full refusal inside the dialog", async () => {
    await confirmAgainst({
      ok: false,
      status: 409,
      json: async () => ({ error: "Cola llena — intentá de nuevo cuando termine un trabajo" }),
    });

    expect(await within(dialog()).findByText(/Cola llena/)).toBeInTheDocument();
  });

  it("shows the generic failure inside the dialog when the route returns no field errors", async () => {
    await confirmAgainst({ ok: false, status: 500, json: async () => ({}) });

    expect(await within(dialog()).findByText(/No se pudo encolar el catálogo/)).toBeInTheDocument();
  });

  /**
   * The `catch` covers the REQUEST and nothing after it. A 2xx whose body fails
   * to parse means the catalog IS queued, and reporting that as a connection
   * failure is worse here than anywhere else in the app: the dialog stays open
   * with Generar live, so the retry it invites enqueues a DUPLICATE that evicts
   * a real catalog under the retention limit.
   *
   * WHAT THIS PINS, measured in both directions rather than assumed: it binds
   * to `response.json().catch(() => ({}))`, NOT to the scope of the `catch`.
   * Drop that fallback and this goes red; collapse the two `try` blocks back
   * into one wide `catch` and all 13 tests here still PASS. With `.json()`
   * guarded at all three parse sites the narrow first `try` has no reachable
   * path that differs from the wide one, so it is defence in depth and the
   * `.json()` fallback is the actual fix. An earlier version of this docstring
   * claimed the narrowing was pinned. It is not, and saying so in the archive
   * would have been worse than not testing it.
   */
  it("does not blame the network for a queued catalog whose response body fails to parse", async () => {
    const { user } = await reachReviewStep({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });

    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
    await user.click(await screen.findByRole("button", { name: "Generar catálogo" }));

    // The success is KEPT: a 2xx queued it, and the body only carried the queue
    // position and the eviction warning — decoration this screen can do without.
    expect(await screen.findByText(/El catálogo empezó a generarse/)).toBeInTheDocument();
    expect(
      screen.queryByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo."),
    ).not.toBeInTheDocument();
  });

  // `handleConfirmGenerate` had no `catch` at all — the seventh instance of
  // this repo's silent-write defect, found while adding the surface above.
  // Generar re-enabled with nothing said, on a dialog that stays open.
  it("says the connection failed when the request never lands", async () => {
    const { user } = await reachReviewStep();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
    await user.click(await screen.findByRole("button", { name: "Generar catálogo" }));

    expect(
      await within(dialog()).findByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generar catálogo" })).toBeEnabled();
  });
});

/**
 * D10 point 3 — the builder's SECOND selection mode: `/inventory` hands over a
 * list of product ids and the form resolves them itself, with the category
 * tree left untouched.
 */
describe("CatalogBuilderForm — product-id mode (D10)", () => {
  const SEEDED = [
    { id: "PS1", name: "Filtro de aceite", categoryL1: "REPUESTOS", categoryL2: null, image: null, imageType: null, priceLists: null },
    { id: "PS3", name: "Correa", categoryL1: "MOTOR", categoryL2: null, image: null, imageType: null, priceLists: null },
  ];

  /** Captures the request BODY, which is what distinguishes the two modes. */
  function mockProductsFetch(products: unknown[]) {
    const bodies: unknown[] = [];
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/products")) {
        bodies.push(JSON.parse(init?.body ?? "null"));
        return Promise.resolve({ ok: true, json: async () => ({ products }) });
      }
      if (url.includes("/queue-depth")) return Promise.resolve({ ok: true, json: async () => ({ depth: 0 }) });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return bodies;
  }

  function renderSeeded(seedProductIds: string[], products: unknown[] = SEEDED) {
    const bodies = mockProductsFetch(products);
    render(
      <CatalogBuilderForm
        categoryL1Options={["REPUESTOS", "MOTOR"]}
        categoryPairs={[]}
        catalogCount={0}
        seedProductIds={seedProductIds}
      />,
    );
    return bodies;
  }

  it("asks the route for the handed-over ids, not for categories", async () => {
    const bodies = renderSeeded(["PS1", "PS2", "PS3"]);

    await screen.findByText("Filtro de aceite");
    expect(bodies).toEqual([{ productIds: ["PS1", "PS2", "PS3"] }]);
  });

  /**
   * catalog-generation spec, "Selection opens the builder pre-populated" — and
   * its stale-id scenario in the same breath: three ids went out, the ERP
   * still has two, and the builder proceeds with those two rather than
   * inventing a third or refusing the whole handoff.
   */
  it("pre-selects every product that still exists and fabricates nothing for the one that does not", async () => {
    renderSeeded(["PS1", "PS2", "PS3"]);

    expect(await screen.findByText("Filtro de aceite")).toBeInTheDocument();
    expect(screen.getByText("Correa")).toBeInTheDocument();
    expect(screen.queryByText("PS2")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Productos (2 de 2 seleccionados)" })).toBeInTheDocument();
  });

  it("leaves the category tree unticked — the ids are the selection", async () => {
    renderSeeded(["PS1", "PS3"]);
    await screen.findByText("Filtro de aceite");

    await userEvent.setup().click(screen.getByRole("button", { name: /Seleccion.* categor.as/ }));
    for (const l1 of ["REPUESTOS", "MOTOR"]) {
      expect(screen.getByRole("checkbox", { name: l1 })).not.toBeChecked();
    }
  });

  /**
   * `deriveCatalogTitle(uniqueL1s(categoryRefs))` has nothing to derive from
   * in this mode, so the L1s come off the returned ROWS instead. Without the
   * fallback every seeded catalog would print the bare "Catalog".
   *
   * Read off the confirm dialog since PR F1: the preview used to print the
   * title on its cover, and with the preview gone the dialog is the one place
   * the operator sees the title before committing to it.
   */
  it("derives the title from the L1s the returned rows carry", async () => {
    renderSeeded(["PS1", "PS3"]);
    const user = userEvent.setup();
    await screen.findByText("Filtro de aceite");

    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));

    expect(await screen.findByText("Catalog: REPUESTOS, MOTOR")).toBeInTheDocument();
  });

  /**
   * `validateCatalogSelection` refuses a selection with no included category,
   * so the derived L1s have to feed the count too — otherwise every seeded
   * catalog dead-ends on "Elegí al menos una categoría" with no category
   * control to go fix.
   */
  it("lets a seeded selection reach the review step", async () => {
    renderSeeded(["PS1", "PS3"]);
    await screen.findByText("Filtro de aceite");

    await userEvent.setup().click(screen.getByRole("button", { name: "Empezar a generar" }));

    expect(screen.getByRole("button", { name: "Volver a la selección" })).toBeInTheDocument();
    expect(screen.queryByText("Elegí al menos una categoría")).not.toBeInTheDocument();
  });
});

/**
 * 7b.7 — the mode that existed before D10. Every assertion here describes
 * behavior that shipped long ago; they are pinned because the new mode shares
 * the same effect, the same `title`, and the same category count.
 */
describe("CatalogBuilderForm — the category-tree flow is unaffected", () => {
  function mockCategoryFetch() {
    const bodies: unknown[] = [];
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes("/products")) {
        bodies.push(JSON.parse(init?.body ?? "null"));
        return Promise.resolve({ ok: true, json: async () => ({ products: [CANDIDATE] }) });
      }
      if (url.includes("/queue-depth")) return Promise.resolve({ ok: true, json: async () => ({ depth: 0 }) });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return bodies;
  }

  async function pickMotor() {
    const bodies = mockCategoryFetch();
    const user = userEvent.setup();
    render(
      <CatalogBuilderForm
        categoryL1Options={["Motor"]}
        categoryPairs={[]}
        catalogCount={0}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Seleccion.* categor.as/ }));
    await user.click(await screen.findByRole("checkbox", { name: "Motor" }));
    await screen.findByText("Woofer");
    return { bodies, user };
  }

  it("still posts a categories body, and never a productIds one", async () => {
    const { bodies } = await pickMotor();

    expect(bodies).toEqual([{ categories: [{ categoryL1: "Motor" }] }]);
  });

  it("still titles the catalog from the TICKED categories, not from the returned rows", async () => {
    const { user } = await pickMotor();

    // `CANDIDATE.categoryL1` is "Motor" as well, so the title could come from
    // either source and this alone would not tell them apart. What pins the
    // direction is the sibling test above, where the ticked category and the
    // returned rows' category differ. (This comment used to point at "the
    // empty-selection one below"; that test no longer asserts a title at all
    // since PR F1 moved the cover out of this form.)
    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));

    expect(await screen.findByText("Catalog: Motor")).toBeInTheDocument();
  });

  /**
   * This used to wait for the preview's bare "Catalog" cover as its proof that
   * the form had finished its first paint. PR F1 took that surface away, so it
   * waits on the category control instead — a real element of the empty state,
   * and the one the operator clicks next.
   */
  it("still requests nothing at all until a category is ticked", async () => {
    const bodies = mockCategoryFetch();
    render(
      <CatalogBuilderForm
        categoryL1Options={["Motor"]}
        categoryPairs={[]}
        catalogCount={0}
      />,
    );

    await screen.findByRole("button", { name: /Seleccion.* categor.as/ });
    expect(bodies).toEqual([]);
  });
});
