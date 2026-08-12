/**
 * Trust-boundary tests for the generate endpoint's body guard.
 *
 * This payload does not get consumed by the request that posts it — it is
 * handed to a pg-boss job and rendered by a Playwright worker minutes later.
 * A bad field here does not produce a 400 the caller can see; it produces a
 * `TypeError` in a decoupled background process with nobody to report it to.
 * That is why element shape is checked and not just `Array.isArray`.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TEMPLATE_ID } from "@/shared/template/registry";
import { isGenerateBody, POST } from "./route";

const VALID = {
  title: "Catálogo",
  sections: [{ categoryL1: "AUDIO", categoryL2: null, productCount: 2 }],
  products: [
    { id: "p1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null, prices: { venta: 45, taller: 38, socio: 32 } },
  ],
  productsPerPage: 10,
  includedCategoryCount: 1,
};

describe("isGenerateBody — the envelope", () => {
  it("accepts a well-formed body", () => {
    expect(isGenerateBody(VALID)).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(isGenerateBody(null)).toBe(false);
    expect(isGenerateBody("nope")).toBe(false);
  });

  it("rejects a missing or mistyped scalar field", () => {
    expect(isGenerateBody({ ...VALID, title: 42 })).toBe(false);
    expect(isGenerateBody({ ...VALID, productsPerPage: "10" })).toBe(false);
    expect(isGenerateBody({ ...VALID, includedCategoryCount: null })).toBe(false);
  });
});

/**
 * design D4 — the highest-value defect target in this whole change: the only
 * guard between a malformed payload and a `TypeError` inside a decoupled
 * pg-boss worker with nobody to report to. Each hostile shape is rejected
 * individually, never collapsed into one loose check.
 */
describe("isGenerateBody — product prices trust boundary (design D4)", () => {
  const withPrices = (prices: unknown) => ({ ...VALID.products[0], prices });

  it("accepts a well-formed three-tier prices object", () => {
    expect(isGenerateBody({ ...VALID, products: [withPrices({ venta: 45, taller: 38, socio: 32 })] })).toBe(true);
  });

  it("accepts null tiers, which mean 'no usable price for this tier'", () => {
    expect(
      isGenerateBody({ ...VALID, products: [withPrices({ venta: null, taller: null, socio: null })] }),
    ).toBe(true);
  });

  it("accepts a null or entirely absent prices object", () => {
    expect(isGenerateBody({ ...VALID, products: [withPrices(null)] })).toBe(true);
    const noPrices: Record<string, unknown> = { ...VALID.products[0] };
    delete noPrices.prices;
    expect(isGenerateBody({ ...VALID, products: [noPrices] })).toBe(true);
  });

  it("rejects a non-object prices value", () => {
    expect(isGenerateBody({ ...VALID, products: [withPrices("45")] })).toBe(false);
    expect(isGenerateBody({ ...VALID, products: [withPrices(45)] })).toBe(false);
  });

  it("rejects an array as prices", () => {
    expect(isGenerateBody({ ...VALID, products: [withPrices([45, 38, 32])] })).toBe(false);
  });

  it("rejects NaN in any single tier, the others being valid", () => {
    expect(isGenerateBody({ ...VALID, products: [withPrices({ venta: Number.NaN, taller: 38, socio: 32 })] })).toBe(false);
    expect(isGenerateBody({ ...VALID, products: [withPrices({ venta: 45, taller: Number.NaN, socio: 32 })] })).toBe(false);
    expect(isGenerateBody({ ...VALID, products: [withPrices({ venta: 45, taller: 38, socio: Number.NaN })] })).toBe(false);
  });

  it("rejects Infinity in any single tier", () => {
    expect(isGenerateBody({ ...VALID, products: [withPrices({ venta: Infinity, taller: 38, socio: 32 })] })).toBe(false);
    expect(isGenerateBody({ ...VALID, products: [withPrices({ venta: 45, taller: -Infinity, socio: 32 })] })).toBe(false);
  });

  it("rejects a string in one tier while the others are valid numbers", () => {
    expect(isGenerateBody({ ...VALID, products: [withPrices({ venta: "45", taller: 38, socio: 32 })] })).toBe(false);
    expect(isGenerateBody({ ...VALID, products: [withPrices({ venta: 45, taller: 38, socio: "32" })] })).toBe(false);
  });
});

describe("isGenerateBody — product element shape", () => {
  it("rejects a product whose id or name is not a string", () => {
    expect(isGenerateBody({ ...VALID, products: [{ ...VALID.products[0], id: 7 }] })).toBe(false);
    expect(isGenerateBody({ ...VALID, products: [{ ...VALID.products[0], name: null }] })).toBe(false);
  });

  it("rejects a non-object product element", () => {
    expect(isGenerateBody({ ...VALID, products: ["woofer"] })).toBe(false);
    expect(isGenerateBody({ ...VALID, products: [null] })).toBe(false);
  });

  it("accepts an empty product list — the emptiness rule belongs to validateCatalogSelection", () => {
    expect(isGenerateBody({ ...VALID, products: [] })).toBe(true);
  });
});

describe("isGenerateBody — section element shape", () => {
  it("rejects a section with a non-string categoryL1", () => {
    expect(isGenerateBody({ ...VALID, sections: [{ categoryL1: 1, categoryL2: null, productCount: 2 }] })).toBe(false);
  });

  it("rejects a section whose productCount is not a number", () => {
    expect(
      isGenerateBody({ ...VALID, sections: [{ categoryL1: "AUDIO", categoryL2: null, productCount: "2" }] }),
    ).toBe(false);
  });

  it("accepts a null categoryL2, which is the L1-only case", () => {
    expect(isGenerateBody({ ...VALID, sections: [{ categoryL1: "AUDIO", categoryL2: null, productCount: 2 }] })).toBe(
      true,
    );
  });
});

/**
 * The remaining `ProductPrintRef` fields. None of these crash the worker the
 * way a string `price` does — a junk `image` renders a broken `<img>`, a junk
 * `imageType` silently picks the wrong card. A degraded PDF that nobody
 * notices is still a failure, and the guard's comment promised element shape,
 * not three fields of it.
 */
describe("isGenerateBody — the rest of the product shape", () => {
  it("rejects a non-string category", () => {
    expect(isGenerateBody({ ...VALID, products: [{ ...VALID.products[0], categoryL1: 7 }] })).toBe(false);
    expect(isGenerateBody({ ...VALID, products: [{ ...VALID.products[0], categoryL2: {} }] })).toBe(false);
  });

  it("rejects a non-string image", () => {
    expect(isGenerateBody({ ...VALID, products: [{ ...VALID.products[0], image: 12 }] })).toBe(false);
  });

  it("rejects an imageType outside the known set", () => {
    expect(isGenerateBody({ ...VALID, products: [{ ...VALID.products[0], imageType: "blurry" }] })).toBe(false);
  });

  it("accepts the known imageTypes and a null one", () => {
    for (const imageType of ["transparent", "opaque", "low_res", null]) {
      expect(isGenerateBody({ ...VALID, products: [{ ...VALID.products[0], imageType }] })).toBe(true);
    }
  });

  it("rejects a section whose categoryL2 is neither string nor null", () => {
    expect(
      isGenerateBody({ ...VALID, sections: [{ categoryL1: "AUDIO", categoryL2: 3, productCount: 1 }] }),
    ).toBe(false);
  });
});

/**
 * design D2/D3 — branding assembly builds `PdfBranding` from
 * `getWorkshopConfig()` (`logoR2Key`/`logoContentType`/`coverText`, the
 * workshop-owned fields) + `getTemplateConfig()` (`selectedTemplateId`, the
 * template-fixed choice), not the old four-field `templateConfig` object.
 */
const { mockEnqueue, mockGetTemplateConfig, mockGetWorkshopConfig, mockGetQueuePosition, mockCountUploaded } =
  vi.hoisted(() => ({
    mockEnqueue: vi.fn(),
    mockGetTemplateConfig: vi.fn(),
    mockGetWorkshopConfig: vi.fn(),
    mockGetQueuePosition: vi.fn(),
    mockCountUploaded: vi.fn(),
  }));

vi.mock("@/modules/pdf-generation/enqueue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/pdf-generation/enqueue")>();
  return { ...actual, enqueueCatalogPdf: (...args: unknown[]) => mockEnqueue(...args) };
});
vi.mock("@/modules/template-config/service", () => ({
  getTemplateConfig: (...args: unknown[]) => mockGetTemplateConfig(...args),
}));
vi.mock("@/modules/workshop-config/service", () => ({
  getWorkshopConfig: (...args: unknown[]) => mockGetWorkshopConfig(...args),
}));
vi.mock("@/modules/pdf-generation/position", () => ({
  getQueuePosition: (...args: unknown[]) => mockGetQueuePosition(...args),
}));
vi.mock("@/modules/catalog-storage/queries", () => ({
  countUploadedCatalogsForUser: (...args: unknown[]) => mockCountUploaded(...args),
}));

function generateRequest() {
  return new NextRequest("http://localhost/api/catalog-builder/generate", {
    method: "POST",
    body: JSON.stringify(VALID),
    headers: { "x-user-id": "user-1", "x-user-role": "administrador", "content-type": "application/json" },
  });
}

describe("POST — branding assembly (design D2/D3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueue.mockResolvedValue({ jobId: "job-1" });
    mockGetQueuePosition.mockResolvedValue(0);
    mockCountUploaded.mockResolvedValue(0);
  });

  it("builds PdfBranding from workshop config (logo/coverText) + template config (selectedTemplateId)", async () => {
    mockGetTemplateConfig.mockResolvedValue({ selectedTemplateId: "dforce-classic" });
    mockGetWorkshopConfig.mockResolvedValue({
      logoR2Key: "logos/1.png",
      logoContentType: "image/png",
      coverText: "Bienvenido",
    });

    await POST(generateRequest());

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        branding: {
          templateId: "dforce-classic",
          logoR2Key: "logos/1.png",
          logoContentType: "image/png",
          coverText: "Bienvenido",
          coverImageR2Key: null,
          coverImageContentType: null,
          contact: {
            name: null, phone: null, whatsapp: null, email: null, address: null, hours: null, website: null, socialHandles: null,
          },
        },
      }),
    );
  });

  it("falls back to the default template id and null fields when neither config is set", async () => {
    mockGetTemplateConfig.mockResolvedValue(null);
    mockGetWorkshopConfig.mockResolvedValue(null);

    await POST(generateRequest());

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        branding: {
          templateId: DEFAULT_TEMPLATE_ID,
          logoR2Key: null,
          logoContentType: null,
          coverText: null,
          coverImageR2Key: null,
          coverImageContentType: null,
          contact: null,
        },
      }),
    );
  });

  // getWorkshopConfig() can return a non-null, all-null-fields row (migration
  // 0008's ON CONFLICT DO NOTHING seed) — don't treat that as "unconfigured"
  // and don't crash reading its fields.
  it("handles a non-null workshop config row with every field null", async () => {
    mockGetTemplateConfig.mockResolvedValue(null);
    mockGetWorkshopConfig.mockResolvedValue({ id: "singleton", logoR2Key: null, logoContentType: null, coverText: null });

    const res = await POST(generateRequest());

    expect(res.status).toBe(200);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        branding: expect.objectContaining({ templateId: DEFAULT_TEMPLATE_ID, logoR2Key: null, logoContentType: null, coverText: null }),
      }),
    );
  });

  // WU5 (design D6, task 6.12) — the cover-image fields and the contact
  // block travel in PdfBranding the same way logo/coverText already do.
  it("carries the cover-image fields and every contact column from getWorkshopConfig()", async () => {
    mockGetTemplateConfig.mockResolvedValue({ selectedTemplateId: "dforce-classic" });
    mockGetWorkshopConfig.mockResolvedValue({
      name: "Dforce Car Audio",
      logoR2Key: null,
      logoContentType: null,
      coverText: null,
      coverImageR2Key: "covers/1.jpg",
      coverImageContentType: "image/jpeg",
      phone: "555-1234",
      whatsapp: null,
      email: "taller@ejemplo.com",
      address: null,
      hours: null,
      website: null,
      socialHandles: { instagram: "@taller" },
    });

    await POST(generateRequest());

    const branding = mockEnqueue.mock.calls[0][0].branding;
    expect(branding.coverImageR2Key).toBe("covers/1.jpg");
    expect(branding.coverImageContentType).toBe("image/jpeg");
    expect(branding.contact).toEqual({
      name: "Dforce Car Audio",
      phone: "555-1234",
      whatsapp: null,
      email: "taller@ejemplo.com",
      address: null,
      hours: null,
      website: null,
      socialHandles: { instagram: "@taller" },
    });
  });
});
