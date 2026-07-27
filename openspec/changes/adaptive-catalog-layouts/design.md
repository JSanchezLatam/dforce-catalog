# Design: adaptive-catalog-layouts

## Architecture Decisions

1. **Image classification**: Heuristic in `mapper.ts` based on image URL patterns from raw `Images` array. No pixel analysis. Three classes: `transparent` (`.png` / `transparent` / `alpha` in URL), `low_res` (empty/missing `Images`), `opaque` (default).
2. **Multi-step UI**: Same `CatalogBuilderForm` component, step flag state (`"select" | "review" | "generate"`). No route change. Step transitions: select products → review + tune layouts → confirm generate.
3. **Data pipeline**: `ProductRef` extended with optional `image` + `imageType`. Flows through `PdfGeneratePayload` → pg-boss → worker → `renderCatalogHtml` with zero new data fetches.
4. **PDF CSS**: Inline ALL card CSS in `render.ts` `<style>` block. Tailwind v4 is NOT available in Playwright's `page.setContent()` — the shared component renders card variants based on `imageType`, but only inline styles survive to PDF.
5. **Storage**: `image_type` persisted in DB so re-syncs don't re-classify. `default_image_handling` persisted in `template_config` so admin preference survives restarts.

## Data Flow

```
Interfuerza API → client.ts → mapper.ts (classifyImageType) → DB upsert (producto.image_type)
                                                                          ↓
CatalogBuilderForm → POST /api/catalog-builder/products → SELECT image_type, image from raw
                    → ProductRef[] with imageType → user reviews in ProductLayoutTuner
                    → POST /api/catalog-builder/generate → PdfGeneratePayload (products[] with image+imageType)
                    → pg-boss queue → worker → renderPdfBuffer() → renderCatalogHtml()
                    → inline CSS + conditional cards → Playwright page.pdf()
```

## File Changes

| File | Action |
|------|--------|
| `shared/db/schema.ts` | Modify: `+image_type` column on `producto`, `+default_image_handling` column on `template_config` |
| `modules/inventory-sync/mapper.ts` | Modify: add `classifyImageType()` heuristic, `Producto` +`imageType` |
| `modules/inventory-sync/job.ts` | Modify: upsert includes `image_type` |
| `modules/catalog-builder/selection.ts` | Modify: `ProductRef` +`imageType`, `CategoryRef` unaffected |
| `modules/catalog-builder/queries.ts` | Modify: `SELECT` includes `image_type` from raw `Images` |
| `modules/catalog-builder/CatalogBuilderForm.tsx` | Modify: multi-step with `step` state, add `ProductLayoutTuner` in review step |
| `modules/catalog-builder/ProductLayoutTuner.tsx` | New: review grid, per-product override, bulk rule dropdown |
| `shared/template/CatalogTemplate.tsx` | Modify: `ProductPrintRef` +`image` +`imageType`, conditional card rendering |
| `shared/template/AdaptiveCards.tsx` | New: `TransparentProductCard` + `OpaqueProductCard` |
| `modules/pdf-generation/enqueue.ts` | Modify: `PdfGeneratePayload.products` includes `image` + `imageType` |
| `modules/pdf-generation/render.ts` | Modify: inline card CSS in `<style>` block |
| `modules/template-config/service.ts` | Modify: validate + persist `default_image_handling` |
| `modules/template-config/TemplateConfigForm.tsx` | Modify: `+Select` for `default_image_handling` |

## Interfaces

```typescript
// Added to schema.ts
imageType: text("image_type")       // 'transparent' | 'opaque' | 'low_res' | null
defaultImageHandling: text("default_image_handling")  // 'strict' | 'adaptive'

// Extended ProductRef (selection.ts)
type ProductRef = {
  id: string; name: string;
  categoryL1: string | null; categoryL2: string | null;
  image?: string | null;
  imageType?: string | null;  // NEW
};

// Extended ProductPrintRef (CatalogTemplate.tsx)
type ProductPrintRef = {
  id: string; name: string;
  categoryL1: string | null; categoryL2: string | null;
  image?: string | null;      // NEW
  imageType?: string | null;  // NEW
};
```

## Key Technical Details

- **Heuristic** (`mapper.ts`): (1) no `Images` array or empty → `low_res`; (2) URL includes `.png`, `transparent`, or `alpha` → `transparent`; (3) default → `opaque`.
- **TransparentProductCard**: full-bleed image, `object-fit: cover`, no border/shadow, no background.
- **OpaqueProductCard**: white border + `border-radius`, `object-fit: contain`, `box-shadow` polaroid effect, white background.
- **Print layout**: CSS Grid with `break-inside: avoid` per card, `@page { margin: 20mm }` from existing render.ts.
- **Default fallback**: if `default_image_handling` is NULL (pre-migration rows) → treat as `'adaptive'`.
- **Strict mode**: when `default_image_handling = 'strict'`, ignore `imageType` — all cards render as opaque/polaroid (backward-compatible behavior).
- **ProductLayoutTuner**: shows product grid with imageType indicator badge; per-product dropdown to override; bulk "set all X to Y" rule.
