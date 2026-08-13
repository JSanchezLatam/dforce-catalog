import { describe, expect, it } from "vitest";

import type { ProductPrintRef } from "@/shared/template/CatalogTemplate";
import { getTemplate } from "@/shared/template/registry";
import { chunkProducts, renderCatalogHtml } from "./render";

function product(id: string): ProductPrintRef {
  return { id, name: `Product ${id}`, categoryL1: "Motor", categoryL2: null };
}

describe("chunkProducts — R6.1/R5.4", () => {
  it("returns no pages for an empty product list", () => {
    expect(chunkProducts([], 10)).toEqual([]);
  });

  it("splits evenly when the count is an exact multiple of productsPerPage", () => {
    const products = ["1", "2", "3", "4"].map(product);
    const pages = chunkProducts(products, 2);
    expect(pages).toHaveLength(2);
    expect(pages[0].map((p) => p.id)).toEqual(["1", "2"]);
    expect(pages[1].map((p) => p.id)).toEqual(["3", "4"]);
  });

  it("puts the remainder on a final shorter page", () => {
    const products = ["1", "2", "3"].map(product);
    const pages = chunkProducts(products, 2);
    expect(pages).toHaveLength(2);
    expect(pages[1]).toHaveLength(1);
  });

  it("treats productsPerPage=1 as one product per page", () => {
    const products = ["1", "2"].map(product);
    expect(chunkProducts(products, 1)).toEqual([[products[0]], [products[1]]]);
  });

  it("falls back to a single page when productsPerPage is invalid (ponytail guard, not reachable via validated input)", () => {
    const products = ["1"].map(product);
    expect(chunkProducts(products, 0)).toEqual([products]);
  });
});

/**
 * Archive gap #1 of `2026-08-12-catalog-templates-and-workshop-info` —
 * `productsPerPage` is a MAXIMUM, not an exact count. WU4's three-row price
 * table made cards tall enough that a 10-product chunk spilled across two
 * physical pages; the fixed-count split was promising a page layout the paper
 * could not deliver. The browser is the only thing that knows how tall a card
 * really is, so `worker.ts` measures the cards in the Chromium it already
 * launched and hands the heights in here.
 *
 * Heights come in per CARD but bind per ROW: `CatalogTemplate`'s product grid
 * is `repeat(2, 1fr)`, so two cards share one row and the TALLER of the two
 * decides how much vertical space that row takes. Per-card input is what lets
 * an odd `productsPerPage` still fill its last, half-width slot.
 *
 * With no measurement at all every card counts as 0-tall and only the count
 * binds — exactly the pre-measurement behaviour the tests above still pin.
 */
describe("chunkProducts — height-aware packing (archive gap #1)", () => {
  const products = (count: number) => Array.from({ length: count }, (_, i) => product(String(i + 1)));
  const ids = (pages: ProductPrintRef[][]) => pages.map((page) => page.map((p) => p.id));
  /** Every card the same height — the row height is then that height too. */
  const flat = (count: number, height: number) => Array.from({ length: count }, () => height);

  it("keeps every row that fits within the usable page height on one page", () => {
    // 6 cards = 3 rows x 100px = 300px into a 300px page: exactly full, no break.
    expect(ids(chunkProducts(products(6), 20, flat(6, 100), 300))).toEqual([["1", "2", "3", "4", "5", "6"]]);
  });

  it("breaks the page when the next row overflows it by a single pixel", () => {
    expect(ids(chunkProducts(products(6), 20, flat(6, 100), 299))).toEqual([
      ["1", "2", "3", "4"],
      ["5", "6"],
    ]);
  });

  it("returns no pages for an empty product list even with a measured page height", () => {
    expect(chunkProducts([], 6, [], 900)).toEqual([]);
  });

  it("gives a row the height of its TALLER card, not of its first one", () => {
    // Row 1 is 300px because of card 2, so row 2 no longer fits in 350px. If
    // the first card decided the row height this would be a single page.
    expect(ids(chunkProducts(products(4), 20, [100, 300, 100, 100], 350))).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  /**
   * The edge that would otherwise hang the worker: a card no page can ever
   * hold. It goes on its own page and Chromium handles the unavoidable
   * overflow — the loop must never retry it against a fresh empty page.
   */
  it("places a card taller than a whole page alone rather than looping forever", () => {
    expect(ids(chunkProducts(products(4), 20, [5000, 100, 100, 100], 300))).toEqual([
      ["1"],
      ["2", "3", "4"],
    ]);
  });

  it("places an oversized card that is not the first one on a page of its own too", () => {
    expect(ids(chunkProducts(products(6), 20, [100, 100, 5000, 100, 100, 100], 300))).toEqual([
      ["1", "2"],
      ["3"],
      ["4", "5", "6"],
    ]);
  });

  it("lets the count bind first when the cards are short", () => {
    expect(ids(chunkProducts(products(6), 4, flat(6, 10), 10_000))).toEqual([
      ["1", "2", "3", "4"],
      ["5", "6"],
    ]);
  });

  it("lets the height bind first when the count would allow more", () => {
    expect(ids(chunkProducts(products(6), 20, flat(6, 200), 400))).toEqual([
      ["1", "2", "3", "4"],
      ["5", "6"],
    ]);
  });

  it("splits a trailing half row by height like any other row", () => {
    // 5 products = 2 full rows + 1 half row; the half row still owns a slot.
    expect(ids(chunkProducts(products(5), 20, flat(5, 200), 400))).toEqual([
      ["1", "2", "3", "4"],
      ["5"],
    ]);
  });

  it("falls back to counting alone when the measurement is missing", () => {
    expect(ids(chunkProducts(products(4), 2, [], 300))).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("still honours productsPerPage=1 even though the grid has two columns", () => {
    expect(ids(chunkProducts(products(3), 1, flat(3, 100), 10_000))).toEqual([["1"], ["2"], ["3"]]);
  });

  /**
   * `MIN`..`MAX_PRODUCTS_PER_PAGE` is 1..20, so every odd value in between is
   * legal input from the form. Packing whole two-card rows would quietly round
   * an explicit 3 down to 2 per page — a 50% page-count increase on a number
   * the user typed, with the height constraint never even engaging.
   */
  it("fills the last odd slot of an odd productsPerPage", () => {
    expect(ids(chunkProducts(products(6), 3, flat(6, 100), 10_000))).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("keeps measuring correctly when an odd page has left the rows out of phase", () => {
    // perPage=3 puts card 4 at the start of page 2, so its row is (4,5) — not
    // the (3,4) pairing the single-grid measurement pass saw.
    expect(ids(chunkProducts(products(6), 3, [100, 100, 100, 100, 100, 100], 250))).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });
});

describe("renderCatalogHtml — R6.1 (shares CatalogTemplate with the builder's live preview, Risk-5)", () => {
  it("produces a full HTML document containing the title, index, and every product page", async () => {
    const html = await renderCatalogHtml({
      title: "Catalog: Motor",
      branding: { templateId: "dforce-classic", logoUrl: "https://x/logo.png", coverText: "Welcome" },
      sections: [{ categoryL1: "Motor", categoryL2: null, productCount: 2 }],
      productPages: [["1", "2"].map(product)],
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Catalog: Motor");
    expect(html).toContain("Product 1");
    expect(html).toContain("Product 2");
    expect(html).toContain("Motor");
  });

  it("renders cover+index only (no product-page markup) when productPages is omitted", async () => {
    const html = await renderCatalogHtml({ title: "Empty catalog", branding: null, sections: [] });
    expect(html).toContain("Empty catalog");
    expect(html).not.toContain("Product page");
  });

  // design.md's New Risk #1 — this body `<style>` tag previously read
  // `branding.font` directly and fell back to plain "sans-serif" once that
  // field moved into the registry (D1/D2); it must resolve the SAME font the
  // cover uses, via getTemplate(branding.templateId), not silently drift.
  it("resolves the body font from the registry, not a literal branding.font", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: { templateId: "dforce-classic", logoUrl: null, coverText: null },
      sections: [],
    });
    // Exactly the registry's font string — it already ends in its own
    // fallback, so a second appended "sans-serif" would be a duplicate.
    expect(html).toContain("font-family: Arial, sans-serif;");
  });

  it("falls back to sans-serif when there is no branding at all", async () => {
    const html = await renderCatalogHtml({ title: "C", branding: null, sections: [] });
    expect(html).toContain("font-family: sans-serif;");
  });

  /**
   * The two card kinds used to differ by a fixed image height (180 vs 160px)
   * and the presence of a border. Both were properties of the pre-mockup card,
   * and asserting them was really asserting "which of the two components ran".
   *
   * The mockup card gives every product the same footprint, so the ONLY thing
   * that still legitimately differs is how the photo fills it: a cut-out
   * product is shown whole (`contain`), a photographed one is cropped to fill
   * (`cover`). That is the behaviour worth protecting — a cut-out cropped to
   * fill loses the product, and a photo shown whole letterboxes into grey.
   */
  const imageFit = (html: string) => html.match(/object-fit:(contain|cover)/)?.[1];
  const productPage = (imageType: ProductPrintRef["imageType"]) => [
    [{ id: "1", name: "P1", categoryL1: "Motor", categoryL2: null, image: "https://x/img.png", imageType }],
  ];

  it("shows a transparent (cut-out) product whole, never cropped", async () => {
    const html = await renderCatalogHtml({
      title: "Test",
      branding: null,
      sections: [],
      defaultImageHandling: "adaptive",
      productPages: productPage("transparent"),
    });
    expect(imageFit(html)).toBe("contain");
  });

  it("crops an opaque (photographed) product to fill its column", async () => {
    const html = await renderCatalogHtml({
      title: "Test",
      branding: null,
      sections: [],
      defaultImageHandling: "adaptive",
      productPages: productPage("opaque"),
    });
    expect(imageFit(html)).toBe("cover");
  });

  it("defaults null imageType to opaque", async () => {
    const html = await renderCatalogHtml({
      title: "Test",
      branding: null,
      sections: [],
      defaultImageHandling: "adaptive",
      productPages: productPage(null),
    });
    expect(imageFit(html)).toBe("cover");
  });

  it("strict mode uses the opaque card regardless of imageType", async () => {
    const html = await renderCatalogHtml({
      title: "Test",
      branding: null,
      sections: [],
      defaultImageHandling: "strict",
      productPages: productPage("transparent"),
    });
    expect(imageFit(html)).toBe("cover");
  });

  it("default (null) handling is strict for backward compat", async () => {
    const html = await renderCatalogHtml({
      title: "Test",
      branding: null,
      sections: [],
      productPages: productPage("transparent"),
    });
    expect(imageFit(html)).toBe("cover");
  });
});

/**
 * catalog-templates-and-workshop-info WU4 — a catalog no longer carries one
 * admin-chosen price tier; every product prints all three (Venta/Taller/
 * Socio). A tier with no usable price — absent, or an ERP value `<= 0.00` —
 * renders an em-dash, never "$0.00" (design D4).
 */
/**
 * `chunkProducts` splits by count and measured height and knows nothing about
 * category boundaries, so every category transition lands mid-page. The red
 * band naming only the page's FIRST category made the page deny that the
 * second was on it — while the index pointed the reader at that exact page to
 * find it. Two printed pages contradicting each other is the defect.
 */
describe("renderCatalogHtml — a product page carrying more than one category", () => {
  const bandOf = (html: string) => {
    const page = html.slice(html.indexOf('aria-label="Product page 1"'));
    return page.match(/<h2[^>]*>([^<]*)<\/h2>/)?.[1] ?? "";
  };

  it("names every category on the page, not just the first", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [
        { categoryL1: "AUDIO", categoryL2: null, productCount: 1 },
        { categoryL1: "LUCES", categoryL2: null, productCount: 1 },
      ],
      productPages: [
        [
          { id: "1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null },
          { id: "2", name: "Barra", categoryL1: "LUCES", categoryL2: null },
        ],
      ],
    });

    expect(bandOf(html)).toContain("AUDIO");
    expect(bandOf(html)).toContain("LUCES");
  });

  it("falls back to a Spanish heading when no product carries a category", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: [[{ id: "1", name: "Woofer", categoryL1: null, categoryL2: null }]],
    });

    expect(bandOf(html)).toBe("PRODUCTOS");
  });
});

describe("renderCatalogHtml — product prices", () => {
  const priced = (prices: ProductPrintRef["prices"]): ProductPrintRef[][] => [
    [{ id: "1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null, prices }],
  ];

  /**
   * Reads the printed tier -> amount pairs back out of the markup.
   *
   * These assertions used to match the literal string "Venta: $120.00", which
   * only held while a tier was one text node. The mockup card prints the label
   * and the amount as separate cells of a price table, so the old form asserted
   * a layout rather than the rule. What must never change is which amount ends
   * up beside which label — so that is what gets read back.
   */
  const tiers = (html: string): Record<string, string> =>
    Object.fromEntries(
      Array.from(html.matchAll(/>(Venta|Taller|Socio)<\/span><span[^>]*>([^<]*)</g), (m) => [m[1], m[2]]),
    );

  it("prints all three resolved tiers on the card", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: priced({ venta: 120, taller: 100, socio: 90 }),
    });

    expect(tiers(html)).toEqual({ Venta: "$120.00", Taller: "$100.00", Socio: "$90.00" });
  });

  it("renders an em-dash for the one tier missing, without touching the others", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: priced({ venta: 120, taller: null, socio: 90 }),
    });

    expect(tiers(html)).toEqual({ Venta: "$120.00", Taller: "—", Socio: "$90.00" });
  });

  // 32 of 694 real products have no retail price. Printing "$0.00" beside one
  // in a document handed to a customer is worse than printing nothing.
  it("renders three em-dashes when every tier has no usable price", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: priced({ venta: null, taller: null, socio: null }),
    });

    expect(tiers(html)).toEqual({ Venta: "—", Taller: "—", Socio: "—" });
    expect(html).not.toContain("$");
  });

  it("renders em-dashes when prices is absent entirely", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: [[{ id: "1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null }]],
    });

    expect(tiers(html)).toEqual({ Venta: "—", Taller: "—", Socio: "—" });
    expect(html).not.toContain("$");
  });

  // A hostile/real ERP "0.00" tier must never render as free.
  it("renders a zero-value tier as an em-dash, never $0.00", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      productPages: priced({ venta: 0, taller: 100, socio: 0 }),
    });

    expect(tiers(html)).toEqual({ Venta: "—", Taller: "$100.00", Socio: "—" });
    expect(html).not.toContain("$0.00");
  });
});

/**
 * catalog-templates-and-workshop-info WU5 (design D6, spec: "Workshop
 * Contact Block on Cover") — closes the CRITICAL sdd-verify finding: the
 * contact columns and the cover image WU1/WU5 store had no render path.
 * Tested through `renderCatalogHtml` (not a separate `CatalogTemplate.test.tsx`),
 * same precedent as WU3's task 3.1 — `CatalogTemplate` is a plain function
 * component already exercised here via `renderToStaticMarkup`.
 */
describe("renderCatalogHtml — workshop contact page (design D6)", () => {
  const fullContact = {
    name: "Dforce Car Audio",
    phone: "+507 6123-4567",
    whatsapp: "+507 6987-6543",
    email: "ventas@dforcecaraudio.com",
    address: "Vía España, Local 12",
    hours: "Lunes a sábado · 8:00 a 18:00",
    website: "www.dforcecaraudio.com",
    socialHandles: { instagram: "@dforcecaraudio", facebook: "@dforcecaraudio" },
  };

  it("renders every set contact field", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: { templateId: "dforce-classic", logoUrl: null, coverText: null, contact: fullContact },
      sections: [],
    });

    expect(html).toContain("+507 6123-4567");
    expect(html).toContain("+507 6987-6543");
    expect(html).toContain("ventas@dforcecaraudio.com");
    expect(html).toContain("Vía España, Local 12");
    expect(html).toContain("Lunes a sábado · 8:00 a 18:00");
    expect(html).toContain("www.dforcecaraudio.com");
    expect(html).toContain("Dforce Car Audio");
  });

  // spec, verbatim: "A field left unset by the Administrador MUST simply be
  // omitted from the block, never rendered as an empty label."
  it("omits the label entirely for an unset field, never an empty label", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: {
        templateId: "dforce-classic",
        logoUrl: null,
        coverText: null,
        contact: { ...fullContact, whatsapp: null, address: null, website: null, socialHandles: null },
      },
      sections: [],
    });

    expect(html).toContain("+507 6123-4567");
    expect(html).not.toContain("WHATSAPP");
    expect(html).not.toContain("DIRECCIÓN");
    expect(html).not.toContain("SITIO WEB");
    expect(html).not.toContain("SEGUINOS EN REDES");
  });

  it("iterates socialHandles entries generically, never hardcoding a platform name", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: {
        templateId: "dforce-classic",
        logoUrl: null,
        coverText: null,
        contact: { ...fullContact, socialHandles: { unKnownPlatform: "@handle" } },
      },
      sections: [],
    });

    expect(html).toContain("unKnownPlatform");
    expect(html).toContain("@handle");
  });

  /**
   * `workshop_config` is a singleton row that WU1's migration guarantees
   * exists, so `buildWorkshopContact` returns an OBJECT OF NULLS — never
   * `null` — for a workshop that simply has not filled contact info in yet.
   * Guarding on `contact != null` alone therefore appended a blank black page
   * to every catalog from such a workshop.
   */
  it("renders no contact page when every contact field is null, not a blank page", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      sections: [],
      branding: {
        templateId: "dforce-classic",
        logoUrl: null,
        coverText: null,
        contact: {
          name: null,
          phone: null,
          whatsapp: null,
          email: null,
          address: null,
          hours: null,
          website: null,
          socialHandles: null,
        },
      },
    });
    expect(html).not.toContain('aria-label="Contact"');
  });

  it("renders no contact page at all when contact is null, not an empty one", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: { templateId: "dforce-classic", logoUrl: null, coverText: null, contact: null },
      sections: [],
    });

    expect(html).not.toContain("SEGUINOS EN REDES");
    expect(html).not.toContain("TELÉFONO");
  });

  it("renders the cover image when coverImageUrl is set", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: { templateId: "dforce-classic", logoUrl: null, coverText: null, coverImageUrl: "data:image/jpeg;base64,Zm9v" },
      sections: [],
    });

    expect(html).toContain("data:image/jpeg;base64,Zm9v");
  });

  // Hard constraint #4 — a missing cover image degrades to the template's
  // red/black block; never a broken <img>, never an empty page.
  it("renders no <img> for the cover photo when coverImageUrl is null, degrading to the red/black block", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: { templateId: "dforce-classic", logoUrl: null, coverText: null, coverImageUrl: null },
      sections: [],
    });

    expect(html).toContain('aria-label="Cover"');
    expect(html).not.toMatch(/<img[^>]*alt=""/);
  });
});

/**
 * Archive gap #4 of `2026-08-12-catalog-templates-and-workshop-info`.
 *
 * DO NOT "simplify" these back into a structural check. The tests directly
 * above assert the cover `<img>` and its `src` exist — and they PASSED while
 * the photo was completely invisible in the PDF, because the cover image is
 * composited with `mix-blend-mode: multiply` and multiplying anything against
 * a BLACK background is black. Only a live screenshot caught it.
 *
 * "A human can see it" is not unit-testable. The invariant that actually
 * broke is, and it is this: with a cover photo present the cover background
 * MUST NOT be the template's dark colour. The colour is read from the
 * registry rather than hardcoded so a palette change cannot make this test
 * pass by accident.
 */
describe("renderCatalogHtml — nothing on the cover may be painted its own background (archive gap #4)", () => {
  const dark = getTemplate("dforce-classic").primaryColors.secondary;
  const coverTag = (html: string) => html.match(/<section aria-label="Cover"[^>]*>/)?.[0] ?? "";
  /** The diagonal wedge — found by the clip-path only it has. */
  const wedgeTag = (html: string) => html.match(/<div style="[^"]*clip-path:polygon[^"]*"/)?.[0] ?? "";
  const cover = (coverImageUrl: string | null) =>
    renderCatalogHtml({
      title: "C",
      branding: { templateId: "dforce-classic", logoUrl: null, coverText: null, coverImageUrl },
      sections: [],
    });

  /**
   * ONE rule, because the cover has now produced the same bug twice.
   *
   * First (archive gap #4): the cover photo is composited with
   * `mix-blend-mode: multiply`, and multiplying anything against a BLACK
   * background is black — the photo was invisible while the tests asserting
   * the `<img>` and its `src` passed.
   *
   * Then, with no photo, the sheet fell back to the template's dark colour and
   * the diagonal wedge is ALSO that colour: a black page with a red stripe on
   * it, and again nothing structural to catch it.
   *
   * Both are the same defect — a background equal to the colour of the thing
   * that must contrast against it. So the invariant is stated once and checked
   * on both paths. The wedge assertion is not decoration: without it, deleting
   * the wedge entirely would satisfy the contrast check vacuously.
   */
  it.each([
    ["with a cover photo", "data:image/jpeg;base64,Zm9v"],
    ["with no cover photo", null],
  ])("keeps the cover sheet a different colour from the wedge %s", async (_case, coverImageUrl) => {
    const html = await cover(coverImageUrl);

    expect(coverTag(html)).not.toBe("");
    expect(coverTag(html)).not.toContain(`background:${dark}`);
    expect(wedgeTag(html)).toContain(`background:${dark}`);
  });

  it("degrades to the wedge alone when there is no cover photo — never a broken <img>", async () => {
    const html = await cover(null);
    expect(html).not.toMatch(/<img[^>]*alt=""/);
  });
});

describe("renderCatalogHtml — product prices", () => {
  it("prints the prices on the transparent card too, not just the framed one", async () => {
    const html = await renderCatalogHtml({
      title: "C",
      branding: null,
      sections: [],
      defaultImageHandling: "adaptive",
      productPages: [
        [
          {
            id: "1",
            name: "Woofer",
            categoryL1: "AUDIO",
            categoryL2: null,
            imageType: "transparent",
            prices: { venta: 45, taller: null, socio: null },
          },
        ],
      ],
    });

    expect(html).toMatch(/>Venta<\/span><span[^>]*>\$45\.00</);
  });
});
