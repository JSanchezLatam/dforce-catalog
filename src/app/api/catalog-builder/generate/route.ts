import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { CatalogSelectionValidationError, validateCatalogSelection } from "@/modules/catalog-builder/selection";
import { requireSession } from "@/modules/auth/session";
import { countUploadedCatalogsForUser } from "@/modules/catalog-storage/queries";
import { shouldWarnOfEviction } from "@/modules/catalog-storage/retention";
import { enqueueCatalogPdf, QueueFullError } from "@/modules/pdf-generation/enqueue";
import { getQueuePosition } from "@/modules/pdf-generation/position";
import { getTemplateConfig } from "@/modules/template-config/service";
import { getWorkshopConfig } from "@/modules/workshop-config/service";
import { getTemplate } from "@/shared/template/registry";
import type { CatalogIndexSection, ProductPrices, ProductPrintRef } from "@/shared/template/CatalogTemplate";

/**
 * R5/R6/R12 — the missing link flagged since PR8: `CatalogBuilderForm`'s
 * "Continue" button previously only showed a draft summary; this is the
 * route it now calls to actually enqueue a `pdf-generate` job (Risk-2's
 * `enqueueCatalogPdf`, the ONLY function allowed to call `boss.send()` for
 * that queue). Any authenticated user may build/generate a catalog (not
 * admin-gated — same as `/api/catalog-builder/products`), so `proxy.ts`'s
 * blanket session guard plus `requireSession()` here is the full auth check.
 *
 * Re-validates with the SAME pure `validateCatalogSelection` the client
 * already ran (defense in depth — never trust a client-computed "this
 * selection is valid" claim for what becomes a real queued job).
 */
type GenerateBody = {
  title: string;
  sections: CatalogIndexSection[];
  // Print-ready, not selection-shaped: every product carries all three
  // resolved price tiers (R13 — no admin-chosen collapse before generation).
  products: ProductPrintRef[];
  productsPerPage: number;
  includedCategoryCount: number;
};

const IMAGE_TYPES = ["transparent", "opaque", "low_res"];

/** `undefined` and `null` are both legitimate for the optional fields — only a wrong TYPE is rejected. */
function isNullableString(value: unknown): boolean {
  return value == null || typeof value === "string";
}

/** One tier is valid when absent (no usable price) or a finite number. */
const isTier = (v: unknown): boolean => v == null || (typeof v === "number" && Number.isFinite(v));

/**
 * design D4 — the only guard between a malformed payload and a `TypeError`
 * inside a decoupled pg-boss worker with nobody to report to. Each tier is
 * validated individually: a non-object `prices`, an array `prices`, or a
 * single bad tier (`NaN`, `Infinity`, wrong type) is rejected on its own,
 * never folded into one loose check.
 */
function isValidPrices(value: unknown): value is Partial<ProductPrices> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const t = value as Partial<ProductPrices>;
  return isTier(t.venta) && isTier(t.taller) && isTier(t.socio);
}

/**
 * Every field of `ProductPrintRef`, not just the crashing one.
 *
 * `prices` is the field that throws (`.toFixed(2)` in `AdaptiveCards`), but a
 * junk `image` renders a broken `<img>` and a junk `imageType` silently picks
 * the wrong card — a degraded PDF nobody notices is its own failure.
 * Validating three fields under a comment promising "element shape" was a
 * contract wider than the code.
 */
function isPrintProduct(value: unknown): value is ProductPrintRef {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Partial<ProductPrintRef>;
  if (p.prices != null && !isValidPrices(p.prices)) return false;
  if (p.imageType != null && !IMAGE_TYPES.includes(p.imageType)) return false;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    isNullableString(p.categoryL1) &&
    isNullableString(p.categoryL2) &&
    isNullableString(p.image)
  );
}

function isIndexSection(value: unknown): value is CatalogIndexSection {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<CatalogIndexSection>;
  return (
    typeof s.categoryL1 === "string" && isNullableString(s.categoryL2) && typeof s.productCount === "number"
  );
}

/**
 * Element shape is checked, not just `Array.isArray`. This body does not get
 * consumed by the request that posts it — it becomes a pg-boss payload that a
 * Playwright worker renders minutes later, so a bad field surfaces as a crash
 * in a decoupled job instead of a 400 anyone sees. Exported for its test.
 */
export function isGenerateBody(value: unknown): value is GenerateBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Partial<GenerateBody>;
  return (
    typeof body.title === "string" &&
    Array.isArray(body.sections) &&
    body.sections.every(isIndexSection) &&
    Array.isArray(body.products) &&
    body.products.every(isPrintProduct) &&
    typeof body.productsPerPage === "number" &&
    typeof body.includedCategoryCount === "number"
  );
}

export async function POST(request: NextRequest) {
  const user = requireSession(request);
  if (!can(user, "catalogs.generate")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!isGenerateBody(body)) {
    return NextResponse.json({ errors: { form: "Invalid request body" } }, { status: 400 });
  }

  try {
    validateCatalogSelection({
      includedCategoryCount: body.includedCategoryCount,
      totalProductCount: body.products.length,
      productsPerPage: body.productsPerPage,
    });
  } catch (err) {
    if (err instanceof CatalogSelectionValidationError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 });
    }
    throw err;
  }

  // design D2 — the two branding halves live in separate tables: `template`
  // owns the fixed/selectable template id, `workshop` owns the logo/cover
  // text content. `getWorkshopConfig()` can return a non-null row with every
  // field null (migration 0008 seeds a singleton row) — read fields
  // individually rather than branching on either config being `null`.
  const [template, workshop] = await Promise.all([getTemplateConfig(), getWorkshopConfig()]);

  try {
    const { jobId } = await enqueueCatalogPdf({
      catalogId: crypto.randomUUID(),
      userId: user.id,
      title: body.title,
      branding: {
        templateId: getTemplate(template?.selectedTemplateId).id,
        logoR2Key: workshop?.logoR2Key ?? null,
        logoContentType: workshop?.logoContentType ?? null,
        coverText: workshop?.coverText ?? null,
      },
      sections: body.sections,
      products: body.products,
      productsPerPage: body.productsPerPage,
      defaultImageHandling: (template?.defaultImageHandling ?? null) as "strict" | "adaptive" | null,
    });
    // R12.3/12.4 (queuePosition) and R11.3 (uploadedCount, for the eviction
    // warning below) are independent reads — batch them instead of awaiting
    // sequentially. R11.3 — CRITICAL fix (sdd-verify): the actual eviction
    // happens later, asynchronously, inside the decoupled pdf-upload worker
    // (retention.ts), where there is no request/response to attach a warning
    // to and this app has no push/email channel (design.md's Real-time
    // decision is polling-only). This response — to the action that
    // confirms generation — is the earliest point a warning can be
    // surfaced, so it is computed from the count BEFORE this job's own
    // upload can complete.
    const [queuePosition, uploadedCount] = await Promise.all([
      getQueuePosition(jobId),
      countUploadedCatalogsForUser(user.id),
    ]);
    // A boolean, not a sentence. The route owns the RULE (does this user have
    // enough saved catalogs that one will be evicted); the client owns the
    // wording, in the app's language. Returning English prose from an API the
    // Spanish UI then ignored is how the two drifted apart.
    const evictionWarning = shouldWarnOfEviction(uploadedCount);

    return NextResponse.json({ jobId, queuePosition, evictionWarning });
  } catch (err) {
    if (err instanceof QueueFullError) {
      return NextResponse.json({ error: err.message }, { status: 409 }); // R12.6
    }
    throw err;
  }
}
