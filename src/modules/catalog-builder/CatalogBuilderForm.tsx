"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, Search } from "lucide-react";

import {
  DEFAULT_PRICE_TIERS,
  PRICE_TIER_LABELS,
  PRICE_TIER_ORDER,
  type PriceTier,
} from "@/shared/template/price-tiers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { FIELD_ERROR, SECTION_HEADING } from "@/shared/ui/styles";
import { Pagination } from "@/shared/ui/Pagination";
import { RETENTION_LIMIT } from "@/modules/catalog-storage/retention-policy";

import type { CategoryPair } from "./queries";
import { resolveAllPrices } from "./price-lists";
import {
  buildIndexSections,
  CatalogSelectionValidationError,
  deriveCatalogTitle,
  DEFAULT_PRODUCTS_PER_PAGE,
  MAX_PRICE_TIERS,
  MAX_PRODUCTS_PER_PAGE,
  MAX_TOTAL_PRODUCTS,
  maxTotalProductsMessage,
  MIN_PRICE_TIERS,
  MIN_PRODUCTS_PER_PAGE,
  toggleBulkFrame,
  validateCatalogSelection,
  type CategoryRef,
  type ProductRef,
} from "./selection";
import { TreeSelect, type TreeItem } from "./TreeSelect";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import { ConfirmGenerateDialog } from "./ConfirmGenerateDialog";
import { ProductLayoutTuner } from "./ProductLayoutTuner";

function makeCategoryTree(l1Options: string[], pairs: CategoryPair[]): TreeItem[] {
  return l1Options.map((l1) => ({
    value: l1,
    label: l1,
    children: pairs
      .filter((p) => p.categoryL1 === l1)
      .map((p) => ({
        value: `${l1}::${p.categoryL2}`,
        label: p.categoryL2,
      })),
  }));
}

function selectedToCategoryRefs(selected: string[]): CategoryRef[] {
  return selected.map((s) => {
    const [l1, l2] = s.split("::");
    return l2 ? { categoryL1: l1, categoryL2: l2 } : { categoryL1: l1 };
  });
}

function uniqueL1s(refs: CategoryRef[]): string[] {
  return [...new Set(refs.map((r) => r.categoryL1))];
}

export function CatalogBuilderForm({
  categoryL1Options,
  categoryPairs,
  catalogCount,
  seedProductIds,
}: {
  categoryL1Options: string[];
  categoryPairs: CategoryPair[];
  catalogCount: number;
  /**
   * D10 — the product ids `/inventory` handed over in the URL, already capped
   * by `parseSeedProductIds` on the server. A plain `string[]` and nothing
   * else: this is a Server Component boundary, so no function and no `Date`
   * can cross it, and the builder resolves each id's CURRENT product data
   * itself rather than trusting anything carried from the list view.
   */
  seedProductIds?: string[];
}) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<ProductRef[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [productsPerPage, setProductsPerPage] = useState(DEFAULT_PRODUCTS_PER_PAGE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [evictionWarning, setEvictionWarning] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const [step, setStep] = useState<"select" | "review">("select");
  const [overrides, setOverrides] = useState<Record<string, "transparent" | "opaque" | "low_res" | null>>({});
  const [bulkFramed, setBulkFramed] = useState(false);
  const overridesBeforeBulkFrameRef = useRef<Record<string, "transparent" | "opaque" | "low_res" | null>>({});
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  /**
   * Separate from `errors` on purpose. A field error still belongs in `errors`
   * so the review card shows it once the operator closes the dialog to fix the
   * field — this is the copy they read WITHOUT closing it, which is the only
   * way they learn the click did anything at all.
   */
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [queueDepth, setQueueDepth] = useState<number | null>(null);
  /**
   * R13 — which price lists this catalog PRINTS. Held in canonical order, not
   * click order, so the POST body and the printed page cannot disagree about
   * which row comes first.
   */
  const [tiers, setTiers] = useState<readonly PriceTier[]>(DEFAULT_PRICE_TIERS);

  const categoryRefs = useMemo(() => selectedToCategoryRefs(selectedCategories), [selectedCategories]);
  /**
   * Memoized because the prop's default would otherwise be a NEW `[]` on every
   * render, and this feeds the fetch effect's dependency — an unstable empty
   * array there is an unbounded request loop.
   */
  const seedIds = useMemo(() => seedProductIds ?? [], [seedProductIds]);

  /**
   * D10 — the two selection modes, as ONE request body.
   *
   * The category tree wins when anything is ticked: the seed is where the
   * operator STARTED, not a mode they are locked into, so picking a category
   * has to mean what it has always meant. With nothing ticked and no seed
   * there is nothing to ask for.
   */
  const productsRequestBody = useMemo(
    () =>
      categoryRefs.length > 0
        ? { categories: categoryRefs }
        : seedIds.length > 0
          ? { productIds: seedIds }
          : null,
    [categoryRefs, seedIds],
  );

  // Only the fetch lives here. Clearing the previous selection is not
  // something to observe after the fact — it is what changing the categories
  // MEANS, so it happens in that handler (see `onSelectionChange` below).
  useEffect(() => {
    if (!productsRequestBody) return;

    let cancelled = false;
    fetch("/api/catalog-builder/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productsRequestBody),
    })
      .then((res) => {
        // A 403 from this route is valid JSON, so `res.json()` would RESOLVE
        // and `body.products ?? []` would render the same silent empty table
        // the catch below exists to prevent. The status has to be checked.
        if (!res.ok) throw new Error(`products request failed: ${res.status}`);
        return res.json();
      })
      .then((body) => {
        if (!cancelled) {
          const products: ProductRef[] = body.products ?? [];
          setCandidates(products);
          /**
           * Everything the fetch returns arrives SELECTED, in both modes.
           *
           * PR F2 made the category mode start empty, reasoning that "pick 12
           * of 188" is easier than "discard 176". That was theory. The owner
           * then used it against the real catalog and reported the opposite
           * workflow: the whole fetch arrives ticked and they remove what does
           * not want, which is what "Quitar sin imagen" is for — one click
           * that takes out the products that have no business being printed.
           * Starting empty meant re-ticking by hand the rows they were going to
           * keep anyway.
           *
           * F2's real defect was never the default; it was that the default
           * was unREVERSIBLE in one gesture and that the only action on the
           * page sat 188 rows down. Both of those are fixed and stay fixed —
           * "Limpiar selección", "Quitar sin imagen" with its undo, the count,
           * the cap surfaced on arrival, and the sticky bar carrying all of
           * them. This line is the one thing that goes back.
           */
          setSelectedProductIds(new Set(products.map((p) => p.id)));
          setPage(1);
        }
      })
      .catch(() => {
        // Without this the rejection escaped the effect and the user sat in
        // front of an empty product table with no idea whether the categories
        // were empty or the request never landed. The neighbouring
        // queue-depth effect already swallowed its errors; this one silently
        // broke the main flow.
        if (!cancelled) {
          setErrors({ categories: "No se pudieron cargar los productos. Revisá tu conexión e intentá de nuevo." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [productsRequestBody]);

  useEffect(() => {
    fetch("/api/catalog-builder/queue-depth")
      .then((res) => res.json())
      .then((data) => setQueueDepth(data.depth))
      .catch(() => {});
  }, []);

  const filteredCandidates = useMemo(() => {
    if (!searchQuery) return candidates;
    const q = searchQuery.toLowerCase();
    return candidates.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
    );
  }, [candidates, searchQuery]);

  const pageCount = Math.max(1, Math.ceil(filteredCandidates.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paginatedProducts = filteredCandidates.slice((safePage - 1) * pageSize, safePage * pageSize);

  const finalProducts = useMemo(
    () => candidates.filter((p) => selectedProductIds.has(p.id)),
    [candidates, selectedProductIds],
  );
  const sections = useMemo(() => buildIndexSections(finalProducts), [finalProducts]);
  // `priceLists` is destructured OFF deliberately: it is the raw ERP map,
  // never the print payload's shape. R13 — every reviewed product now
  // carries all three resolved tiers instead of one admin-chosen price.
  const reviewedProducts = useMemo(
    () =>
      finalProducts.map(({ priceLists, ...p }) => ({
        ...p,
        imageType: overrides[p.id] ?? p.imageType,
        prices: resolveAllPrices(priceLists),
      })),
    [finalProducts, overrides],
  );
  /**
   * D10 point 3 — what counts as "the included categories".
   *
   * In category mode these ARE the ticked refs, identically. In product-id
   * mode nothing is ticked, so they are the distinct L1s the resolved rows
   * carry: without that fallback every seeded catalog would print the bare
   * "Catalog" AND dead-end on `validateCatalogSelection`'s "Elegí al menos
   * una categoría", with no category control on screen to go satisfy it.
   */
  const includedCategoryRefs = useMemo<CategoryRef[]>(
    () =>
      categoryRefs.length > 0
        ? categoryRefs
        : [...new Set(finalProducts.map((p) => p.categoryL1))]
            .filter((l1): l1 is string => l1 !== null)
            .map((categoryL1) => ({ categoryL1 })),
    [categoryRefs, finalProducts],
  );
  const title = useMemo(() => deriveCatalogTitle(uniqueL1s(includedCategoryRefs)), [includedCategoryRefs]);

  const allVisibleSelected = paginatedProducts.length > 0 && paginatedProducts.every((p) => selectedProductIds.has(p.id));
  const someVisibleSelected = paginatedProducts.some((p) => selectedProductIds.has(p.id));

  function toggleAllVisible() {
    if (allVisibleSelected) {
      const next = new Set(selectedProductIds);
      for (const p of paginatedProducts) next.delete(p.id);
      setSelectedProductIds(next);
    } else {
      const next = new Set(selectedProductIds);
      for (const p of paginatedProducts) next.add(p.id);
      setSelectedProductIds(next);
    }
  }

  function toggleProduct(id: string) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * PR F2 — "quitar los que no tienen imagen", across the WHOLE selection and
   * not only the visible page: the operator means "no image-less product goes
   * in this catalog", and a version that silently spared the rows they had
   * scrolled past would leave exactly the products they asked to be rid of in a
   * catalog they believe is clean.
   *
   * This is the button that makes the preselected default work at all — the
   * owner said as much when asking for the default back. It is the one gesture
   * that turns 188 ticked rows into the ones worth printing, so it has to mean
   * all 188 and not the ten on screen.
   *
   * The signal is `product.image` (`queries.ts:46`) and it has to be.
   * `imageType` looks like the answer and is not — a product with NO images
   * maps to `low_res`, the same value a real low-resolution photo gets
   * (`mapper.ts:35-44`), so filtering on it would also delete every product
   * whose photo is merely poor.
   */
  const imagelessSelectedIds = useMemo(
    () => candidates.filter((p) => selectedProductIds.has(p.id) && !p.image).map((p) => p.id),
    [candidates, selectedProductIds],
  );

  /**
   * The undo for that one bulk action. A select-all that is easy to hit and
   * hard to reverse is exactly how the original defect felt from the inside,
   * so the bulk removal ships with its own way back.
   *
   * `after === selectedProductIds` is identity on purpose, not a deep compare:
   * every setter in this component builds a FRESH `Set`, so the offer survives
   * exactly as long as the selection is still what the removal left behind.
   * One tick later, "Deshacer" would be restoring a set the operator has since
   * edited — which is a different action wearing the same word.
   */
  const [imagelessUndo, setImagelessUndo] = useState<{
    before: Set<string>;
    after: Set<string>;
    removed: number;
  } | null>(null);
  const undoAvailable = imagelessUndo?.after === selectedProductIds ? imagelessUndo : null;

  function deselectImageless() {
    const before = selectedProductIds;
    const after = new Set(before);
    for (const id of imagelessSelectedIds) after.delete(id);
    setSelectedProductIds(after);
    setImagelessUndo({ before, after, removed: imagelessSelectedIds.length });
  }

  /**
   * The cap is enforced by DISABLING the boxes that would break it, so this
   * only ever runs on a legal transition — an error message shown after the
   * fact is a worse answer than a control that cannot express the invalid
   * state. `validateCatalogSelection` still re-checks it on both sides.
   */
  function toggleTier(tier: PriceTier) {
    setTiers((prev) =>
      PRICE_TIER_ORDER.filter((t) => (t === tier ? !prev.includes(t) : prev.includes(t))),
    );
  }

  function handleContinue() {
    try {
      validateCatalogSelection({
        includedCategoryCount: includedCategoryRefs.length,
        totalProductCount: finalProducts.length,
        productsPerPage,
        tiers,
      });
      setErrors({});
      setStep("review");
    } catch (err) {
      if (err instanceof CatalogSelectionValidationError) {
        setErrors(err.errors);
        return;
      }
      throw err;
    }
  }

  async function handleConfirmGenerate() {
    setIsSubmitting(true);
    setConfirmError(null);

    // Two `try` blocks, the shape `UserForm` already uses. The first wraps ONLY
    // the request, so the connection message can never be printed over a
    // catalog the server already accepted: here that lie is worse than on any
    // other surface, because the dialog stays OPEN with Generar live, and the
    // retry it invites enqueues a DUPLICATE that evicts a real catalog under
    // the retention limit.
    let response: Response;
    try {
      response = await fetch("/api/catalog-builder/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          sections,
          products: reviewedProducts,
          productsPerPage,
          includedCategoryCount: includedCategoryRefs.length,
          tiers,
        }),
      });
    } catch {
      setConfirmError(CONNECTION_ERROR);
      setIsSubmitting(false);
      return;
    }

    try {
      if (response.status === 409) {
        const body = await response.json().catch(() => null);
        const message = body?.error ?? "Cola llena \u2014 intentá de nuevo cuando termine un trabajo";
        setErrors({ total: message });
        setConfirmError(message);
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const returned: Record<string, string> | undefined = body?.errors;
        // `form` is dropped on both paths. It is the route's sentinel for a
        // body it could not parse at all (`generate/route.ts` answers
        // `{ errors: { form: "Invalid request body" } }`) — English, and not a
        // field the operator can go correct. It survived unnoticed only
        // because nothing in this module ever rendered `errors.form`; giving
        // the channel a surface would have published it straight to the
        // operator's screen, in the wrong language.
        const fields = returned && Object.fromEntries(Object.entries(returned).filter(([k]) => k !== "form"));
        // Only real field errors go into `errors`, for when the operator goes
        // BACK to fix them. Not all of them have a surface at this point:
        // `productsPerPage` renders inside the `step === "select"` block, so on
        // a confirm failure it is invisible until they click "Volver a la
        // selección". The dialog surface below is what covers that gap.
        if (fields && Object.keys(fields).length > 0) setErrors(fields);
        // Joined rather than generic: the operator has to know WHICH field, or
        // "cancel and look around" is the only instruction the dialog gives.
        // `validateCatalogSelection` sets its keys in independent `if` blocks,
        // so several arrive at once. Joined with the same separator the printed
        // catalog uses for its price lists — a plain space runs two sentences
        // together into one unreadable line.
        const messages = fields ? Object.values(fields) : [];
        setConfirmError(
          messages.length > 0 ? messages.join(" · ") : "No se pudo encolar el catálogo. Intentalo de nuevo.",
        );
        return;
      }

      // A 2xx means the job IS queued. This body only carries decoration — the
      // queue position and the eviction warning — so a malformed one must not
      // cost the operator a success they already have, and must never surface
      // as a failure that invites the duplicate-creating retry above.
      const body = await response
        .json()
        .catch(() => ({}) as { queuePosition?: number; evictionWarning?: boolean });
      setQueuePosition(body.queuePosition ?? null);
      setEvictionWarning(body.evictionWarning === true);
      setShowConfirmDialog(false);
      setShowSuccessAlert(true);
      // A retry that SUCCEEDS leaves nothing to fix, so the field error this
      // design sends the operator back to the review card for is now a lie
      // sitting behind the success dialog. Pre-existing, and cheap here.
      setErrors({});
    } finally {
      setIsSubmitting(false);
    }
  }

  const buttonDisabled = candidates.length === 0;
  const queueFullBtn = queueDepth !== null && queueDepth >= 2;
  /**
   * PR F2 — the cap, said out loud while it can still be acted on.
   *
   * NOT a relocation: `validateCatalogSelection` still refuses the same
   * selection, the `/inventory` bar still refuses it before navigating, and
   * `productsByIdsQuery` still slices at the database. Three places on
   * purpose (`selection.ts:66-77`). This is a fourth SURFACE for a number the
   * operator previously only met after clicking — which is how 188
   * auto-selected products sat just under it invisibly.
   */
  const overCap = finalProducts.length > MAX_TOTAL_PRODUCTS;

  let buttonLabel = "Empezar a generar";
  if (queueFullBtn) buttonLabel = `${queueDepth} en cola — esperar`;

  const categoryTree = useMemo(
    () => makeCategoryTree(categoryL1Options, categoryPairs),
    [categoryL1Options, categoryPairs],
  );

  return (
    <>
      <Card size="sm" className="mb-4 overflow-visible">
        <CardContent>
          <section aria-label="Selección de categorías">
            <h2 className={SECTION_HEADING}>Categorías</h2>
            <TreeSelect
              items={categoryTree}
              selected={selectedCategories}
              onSelectionChange={(v) => {
                setSelectedCategories(v);
                // The candidate list belongs to the categories that produced
                // it; clear it here so nothing stale is ever on screen while
                // the new fetch is in flight.
                setCandidates([]);
                setSelectedProductIds(new Set());
                setPage(1);
                setErrors({});
              }}
            />
            {errors.categories && (
              <p role="alert" className={`mt-1 ${FIELD_ERROR}`}>
                {errors.categories}
              </p>
            )}
          </section>
        </CardContent>
      </Card>

      {candidates.length > 0 && step === "select" && (
        <>
          <Card size="sm" className="mb-4">
            <CardContent>
              <section aria-label="Selección de productos">
                <h2 className={SECTION_HEADING}>
                  Productos ({finalProducts.length} de {candidates.length} seleccionados)
                </h2>
                <div className="mb-3 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                    <Input
                      type="search"
                      placeholder="Buscar productos..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setPage(1);
                      }}
                      className="pl-9"
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                    <Label>Filas por página</Label>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => {
                        setPageSize(Number(v));
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value={String(candidates.length)}>Todos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          {/* Named, because a bare box in a header cell is
                              "checkbox" to a screen reader and to every test
                              that has to tell it from the 188 below it. */}
                          <Checkbox
                            aria-label="Seleccionar todos los visibles"
                            checked={allVisibleSelected || someVisibleSelected}
                            onCheckedChange={toggleAllVisible}
                          />
                        </TableHead>
                        <TableHead>Nombre</TableHead>
                        <TableHead>ID</TableHead>
                        <TableHead className="hidden sm:table-cell">Categoría N1</TableHead>
                        <TableHead className="hidden md:table-cell">Categoría N2</TableHead>
                        <TableHead className="w-24">Imagen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedProducts.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                            Ningún producto coincide con tu búsqueda
                          </TableCell>
                        </TableRow>
                      )}
                      {paginatedProducts.map((product) => (
                        <TableRow
                          key={product.id}
                          data-selected={selectedProductIds.has(product.id) || undefined}
                          className="cursor-pointer data-selected:bg-muted/50"
                          onClick={() => toggleProduct(product.id)}
                        >
                          <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              aria-label={`Seleccionar ${product.name}`}
                              checked={selectedProductIds.has(product.id)}
                              onCheckedChange={() => toggleProduct(product.id)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell className="text-muted-foreground">{product.id}</TableCell>
                          <TableCell className="hidden sm:table-cell text-muted-foreground">{product.categoryL1}</TableCell>
                          <TableCell className="hidden md:table-cell text-muted-foreground">{product.categoryL2}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {product.image ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setPreviewImage({ src: product.image!, alt: product.name })
                                }
                              >
                                Ver imagen
                              </Button>
                            ) : (
                              <Button type="button" variant="destructive" size="sm" disabled>
                                Sin imagen
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            </CardContent>
          </Card>

          <Card size="sm" className="mb-4">
            <CardContent>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Mostrando {filteredCandidates.length > 0 ? (safePage - 1) * pageSize + 1 : 0}
                  {"\u2013"}
                  {Math.min(safePage * pageSize, filteredCandidates.length)} de{" "}
                  {filteredCandidates.length} productos
                </span>
                <Pagination currentPage={safePage} pageCount={pageCount} onPageChange={setPage} />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {candidates.length > 0 && step === "review" && (
        <ProductLayoutTuner
          products={finalProducts}
          overrides={overrides}
          bulkFramed={bulkFramed}
          onOverride={(id, value) =>
            setOverrides((prev) => ({ ...prev, [id]: value }))
          }
          onBulkFrame={() => {
            // The transition itself is a pure function in selection.ts so the
            // restore-on-toggle-off rule can be tested without mounting this
            // form; here we only project the result onto React state.
            const next = toggleBulkFrame(
              { overrides, bulkFramed, snapshot: overridesBeforeBulkFrameRef.current },
              finalProducts,
            );
            overridesBeforeBulkFrameRef.current = next.snapshot;
            setOverrides(next.overrides);
            setBulkFramed(next.bulkFramed);
          }}
        />
      )}

      {/* `errors.total` has no copy here any more, in EITHER step. It used to
          be a bare paragraph above the image list — i.e. above the 103 rows,
          off screen at the moment the route sets it. Each step's action bar
          carries its own, which is the one surface guaranteed to be in view,
          and printing it in both places would say the same sentence twice. */}

      {step === "select" && (
        <Card size="sm" className="mb-4">
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <section aria-label="Densidad de página">
                <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
                  Máximo de productos por página
                  <Input
                    type="number"
                    min={MIN_PRODUCTS_PER_PAGE}
                    max={MAX_PRODUCTS_PER_PAGE}
                    value={productsPerPage}
                    onChange={(e) => {
                      setProductsPerPage(Number(e.target.value));
                    }}
                    className="w-24"
                  />
                </label>
                {/* The PDF fits as many products per page as physically fit and
                    never more than this number, so an admin who types 10 and
                    gets 4 is seeing the feature work, not a bug. */}
                <p className="mt-1 text-xs text-muted-foreground">
                  Pueden salir menos si las tarjetas no entran en la hoja.
                </p>
                {errors.productsPerPage && (
                  <p role="alert" className={FIELD_ERROR}>
                    {errors.productsPerPage}
                  </p>
                )}
              </section>
            </div>
          </CardContent>
        </Card>
      )}

      {/**
       * PR F2 — the action bar.
       *
       * It used to be the third card, below a table the operator had set to
       * show every one of its 188 rows, so reaching the only button on the
       * page meant scrolling past all of them. Sticky, it is one thumb away
       * from any scroll position — and the count travels with it, because
       * "12 seleccionados" answers half the question: the operator needs to
       * know what they are choosing FROM. With the fetch pre-ticked again,
       * "176 de 188" is also the only place the removals already made are
       * visible without scrolling back through the rows.
       *
       * The 44x44 rule applies in full here (AGENTS.md). These are action
       * controls on a tablet surface, NOT the filter-strip exception — that
       * waiver is for controls sitting against `h-8` inputs and reading as one
       * control, and this bar sits against nothing.
       */}
      {candidates.length > 0 && step === "select" && (
        <Card size="sm" className="sticky bottom-0 z-10 mb-4 shadow-lg">
          <CardContent>
            <section aria-label="Acciones de selección">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-sm font-medium text-foreground">
                    {finalProducts.length} de {candidates.length} seleccionados
                  </span>
                  {/* Counted in the label: the operator decides whether to run
                      a destructive bulk action by knowing what it will take,
                      not by running it and comparing totals. */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 min-w-11"
                    disabled={imagelessSelectedIds.length === 0}
                    onClick={deselectImageless}
                  >
                    Quitar sin imagen ({imagelessSelectedIds.length})
                  </Button>
                  {undoAvailable && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 min-w-11"
                      onClick={() => setSelectedProductIds(undoAvailable.before)}
                    >
                      Deshacer ({undoAvailable.removed})
                    </Button>
                  )}
                  {finalProducts.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 min-w-11"
                      onClick={() => setSelectedProductIds(new Set())}
                    >
                      Limpiar selección
                    </Button>
                  )}
                </div>
                <Button
                  type="button"
                  className="min-h-11 min-w-11"
                  onClick={handleContinue}
                  disabled={buttonDisabled || queueFullBtn || overCap}
                >
                  {buttonLabel}
                </Button>
              </div>
              {/* Over-cap DISABLES and explains; an empty selection does not.
                  Over-cap IS the arrival state of any category holding more
                  than 200 products, which is the case this surface exists for.
                  An empty selection is something the operator did on purpose
                  (Limpiar, or unticking the lot), so it is reported when they
                  click rather than shouted at them while they work. */}
              {(overCap || errors.total) && (
                <p role="alert" className={`mt-2 ${FIELD_ERROR}`}>
                  {overCap ? maxTotalProductsMessage(finalProducts.length) : errors.total}
                </p>
              )}
            </section>
          </CardContent>
        </Card>
      )}

      {step === "review" && (
        <Card size="sm" className="mb-4">
          <CardContent>
            <fieldset>
              <legend className="text-sm font-medium">Listas de precios</legend>
              <p className="mt-1 mb-3 text-sm text-muted-foreground">
                Elegí 1 o 2 de las 3. Cada una es una fila de precio en la ficha del producto.
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                {PRICE_TIER_ORDER.map((tier) => {
                  const checked = tiers.includes(tier);
                  return (
                    <div key={tier} className="flex items-center gap-2">
                      <Checkbox
                        id={`tier-${tier}`}
                        checked={checked}
                        // Unticking the last one leaves a card with no price
                        // row; ticking a third breaks the cap. Both are made
                        // unreachable rather than reported afterwards.
                        disabled={checked ? tiers.length === MIN_PRICE_TIERS : tiers.length === MAX_PRICE_TIERS}
                        onCheckedChange={() => toggleTier(tier)}
                      />
                      <Label htmlFor={`tier-${tier}`}>{PRICE_TIER_LABELS[tier]}</Label>
                    </div>
                  );
                })}
              </div>
              {/* Only reachable from a non-UI client or a drifted client/server
                  rule — the group cannot tick three or untick the last. Rendered
                  anyway: an error set into state and shown nowhere is a dead
                  Generar button with no explanation. */}
              {errors.tiers && (
                <p role="alert" className={`mt-3 ${FIELD_ERROR}`}>
                  {errors.tiers}
                </p>
              )}
            </fieldset>
          </CardContent>
        </Card>
      )}

      {/**
       * The review step's action bar.
       *
       * F2 gave the select step one and gated it on `step === "select"`, which
       * left this step with the very complaint F2 was opened to fix: the only
       * action sat in a card BELOW the whole image list, 103 rows down.
       *
       * Not the same controls, because it is not the same task. Nothing is
       * being chosen here — the selection is frozen and the operator is
       * checking how each photo will be framed — so there is no bulk
       * select/deselect and no "N de M". What travels is the count of what is
       * about to be printed (otherwise stated only in the tuner heading, at
       * the top of a list already scrolled past) and the two exits. The one
       * bulk action this step does have, "Enmarcar todos", deliberately stays
       * where it is: it rewrites the rows, so it belongs beside them.
       *
       * Both exits carry the 44x44 minimum (AGENTS.md). Same reasoning F2
       * wrote for the other bar: these are action controls on a tablet
       * surface, not the filter-strip waiver, which is for controls sitting
       * against `h-8` inputs and reading as one control.
       */}
      {step === "review" && (
        <Card size="sm" className="sticky bottom-0 z-10 mb-4 shadow-lg">
          <CardContent>
            <section aria-label="Acciones de revisión">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 min-w-11"
                  onClick={() => setStep("select")}
                >
                  Volver a la selección
                </Button>
                <span className="text-sm font-medium text-foreground">
                  {reviewedProducts.length} {reviewedProducts.length === 1 ? "producto" : "productos"} en el catálogo
                </span>
                <Button
                  type="button"
                  className="min-h-11 min-w-11"
                  disabled={reviewedProducts.length === 0}
                  onClick={() => {
                    setErrors({});
                    setShowConfirmDialog(true);
                  }}
                >
                  Empezar a generar
                </Button>
              </div>
              {/* One alert, never two. A refusal the route just sent is news;
                  "no hay productos" is the static explanation for the disabled
                  button, so the route's message wins when both apply. */}
              {(errors.total || reviewedProducts.length === 0) && (
                <p role="alert" className={`mt-2 ${FIELD_ERROR}`}>
                  {errors.total || "No hay productos seleccionados"}
                </p>
              )}
            </section>
          </CardContent>
        </Card>
      )}

      <ConfirmGenerateDialog
        open={showConfirmDialog}
        onOpenChange={(open) => {
          setShowConfirmDialog(open);
          // Only the CLOSING edge reaches here — this dialog has no trigger, so
          // the parent opens it by setting `open` directly and `onOpenChange`
          // never fires for that. Clearing here stops a stale refusal waiting
          // inside next time; the fresh-attempt clear is at the top of
          // `handleConfirmGenerate`.
          setConfirmError(null);
          if (!open) setIsSubmitting(false);
        }}
        categories={includedCategoryRefs}
        title={title}
        productCount={reviewedProducts.length}
        catalogCount={catalogCount}
        isSubmitting={isSubmitting}
        error={confirmError}
        onConfirm={handleConfirmGenerate}
      />

      {previewImage && (
        <ImagePreviewDialog
          src={previewImage.src}
          alt={previewImage.alt}
          onClose={() => setPreviewImage(null)}
        />
      )}

      <Dialog open={showSuccessAlert} onOpenChange={(o) => { if (!o) setShowSuccessAlert(false); }}>
        <DialogContent showCloseButton={false} className="max-w-sm items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-green-100">
            <CheckIcon className="size-6 text-green-600" />
          </div>
          <DialogHeader className="items-center text-center">
            <DialogTitle>Catálogo en proceso</DialogTitle>
            <DialogDescription>
              El catálogo empezó a generarse{queuePosition != null ? ` (posición ${queuePosition} en la cola)` : ""}.
              {evictionWarning ? ` Ya tenés ${RETENTION_LIMIT} catálogos guardados: el más antiguo se eliminará cuando este esté listo.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-center gap-3 sm:justify-center">
            <DialogClose render={<Button variant="outline" />}>
              Cerrar
            </DialogClose>
            <DialogClose
              render={
                <Button
                  onClick={() => { window.location.href = "/catalogs"; }}
                />
              }
            >
              Ver catálogos
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
