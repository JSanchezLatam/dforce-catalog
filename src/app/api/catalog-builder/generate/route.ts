import { NextResponse, type NextRequest } from "next/server";

import { CatalogSelectionValidationError, validateCatalogSelection, type ProductRef } from "@/modules/catalog-builder/selection";
import { requireSession } from "@/modules/auth/session";
import { enqueueCatalogPdf, QueueFullError } from "@/modules/pdf-generation/enqueue";
import { getQueuePosition } from "@/modules/pdf-generation/position";
import { getTemplateConfig } from "@/modules/template-config/service";
import type { CatalogIndexSection } from "@/shared/template/CatalogTemplate";

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
  products: ProductRef[];
  productsPerPage: number;
  includedCategoryCount: number;
};

function isGenerateBody(value: unknown): value is GenerateBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Partial<GenerateBody>;
  return (
    typeof body.title === "string" &&
    Array.isArray(body.sections) &&
    Array.isArray(body.products) &&
    typeof body.productsPerPage === "number" &&
    typeof body.includedCategoryCount === "number"
  );
}

export async function POST(request: NextRequest) {
  const user = requireSession(request);
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

  const template = await getTemplateConfig();

  try {
    const { jobId } = await enqueueCatalogPdf({
      catalogId: crypto.randomUUID(),
      userId: user.id,
      title: body.title,
      branding: template
        ? {
            logoUrl: template.logoUrl,
            primaryColors: template.primaryColors,
            font: template.font,
            coverText: template.coverText,
          }
        : null,
      sections: body.sections,
      products: body.products,
      productsPerPage: body.productsPerPage,
    });
    const queuePosition = await getQueuePosition(jobId); // R12.3/12.4 — reported once at enqueue time.
    return NextResponse.json({ jobId, queuePosition });
  } catch (err) {
    if (err instanceof QueueFullError) {
      return NextResponse.json({ error: err.message }, { status: 409 }); // R12.6
    }
    throw err;
  }
}
