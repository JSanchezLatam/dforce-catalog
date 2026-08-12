"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, Search } from "lucide-react";

import { CatalogTemplate } from "@/shared/template/CatalogTemplate";
import { getTemplate } from "@/shared/template/registry";
import type { TemplateConfig, WorkshopConfig } from "@/shared/db/schema";
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
import { CARD, FIELD_ERROR, SECTION_HEADING } from "@/shared/ui/styles";
import { Pagination } from "@/shared/ui/Pagination";
import { RETENTION_LIMIT } from "@/modules/catalog-storage/retention-policy";

import type { CategoryPair } from "./queries";
import { resolveAllPrices } from "./price-lists";
import {
  buildIndexSections,
  CatalogSelectionValidationError,
  deriveCatalogTitle,
  MAX_PRODUCTS_PER_PAGE,
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
  templateConfig,
  workshopConfig,
  catalogCount,
}: {
  categoryL1Options: string[];
  categoryPairs: CategoryPair[];
  templateConfig: TemplateConfig | null;
  workshopConfig: WorkshopConfig | null;
  catalogCount: number;
}) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<ProductRef[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [productsPerPage, setProductsPerPage] = useState(10);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [evictionWarning, setEvictionWarning] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const [step, setStep] = useState<"select" | "review">("select");
  const [overrides, setOverrides] = useState<Record<string, "transparent" | "opaque" | "low_res" | null>>({});
  const [bulkFramed, setBulkFramed] = useState(false);
  const overridesBeforeBulkFrameRef = useRef<Record<string, "transparent" | "opaque" | "low_res" | null>>({});
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [queueDepth, setQueueDepth] = useState<number | null>(null);

  const categoryRefs = useMemo(() => selectedToCategoryRefs(selectedCategories), [selectedCategories]);

  // Only the fetch lives here. Clearing the previous selection is not
  // something to observe after the fact — it is what changing the categories
  // MEANS, so it happens in that handler (see `onSelectionChange` below).
  useEffect(() => {
    if (categoryRefs.length === 0) return;

    let cancelled = false;
    fetch("/api/catalog-builder/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories: categoryRefs }),
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
  }, [categoryRefs]);

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
  const title = useMemo(() => deriveCatalogTitle(uniqueL1s(categoryRefs)), [categoryRefs]);

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



  function handleContinue() {
    try {
      validateCatalogSelection({
        includedCategoryCount: categoryRefs.length,
        totalProductCount: finalProducts.length,
        productsPerPage,
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
    try {
      const response = await fetch("/api/catalog-builder/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          sections,
          products: reviewedProducts,
          productsPerPage,
          includedCategoryCount: categoryRefs.length,
        }),
      });

      if (response.status === 409) {
        const body = await response.json();
        setErrors({ total: body.error ?? "Cola llena \u2014 intentá de nuevo cuando termine un trabajo" });
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrors(body?.errors ?? { form: "No se pudo encolar el catálogo. Intentalo de nuevo." });
        return;
      }

      const body = await response.json();
      setQueuePosition(body.queuePosition ?? null);
      setEvictionWarning(body.evictionWarning === true);
      setShowConfirmDialog(false);
      setShowSuccessAlert(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  const buttonDisabled = candidates.length === 0;
  const queueFullBtn = queueDepth !== null && queueDepth >= 2;

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
                <div className="rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
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

      {errors.total && (
        <p role="alert" className={`mb-4 ${FIELD_ERROR}`}>
          {errors.total}
        </p>
      )}

      {step === "select" && (
        <Card size="sm" className="mb-4">
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <section aria-label="Densidad de página">
                <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
                  Productos por página
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
                {errors.productsPerPage && (
                  <p role="alert" className={FIELD_ERROR}>
                    {errors.productsPerPage}
                  </p>
                )}
              </section>
              <Button
                type="button"
                onClick={handleContinue}
                disabled={buttonDisabled || queueFullBtn}
              >
                {buttonLabel}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "review" && (
        <Card size="sm" className="mb-4">
          <CardContent>
            <div className="flex flex-wrap items-center justify-between">
              <Button type="button" variant="outline" onClick={() => setStep("select")}>
                Volver a la selección
              </Button>
              <Button
                type="button"
                disabled={reviewedProducts.length === 0}
                onClick={() => {
                  setErrors({});
                  setShowConfirmDialog(true);
                }}
              >
                Empezar a generar
              </Button>
            </div>
            {reviewedProducts.length === 0 && (
              <p role="alert" className={`mt-2 ${FIELD_ERROR}`}>
                No hay productos seleccionados
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <ConfirmGenerateDialog
        open={showConfirmDialog}
        onOpenChange={(open) => {
          setShowConfirmDialog(open);
          if (!open) setIsSubmitting(false);
        }}
        categories={categoryRefs}
        title={title}
        productCount={reviewedProducts.length}
        catalogCount={catalogCount}
        isSubmitting={isSubmitting}
        onConfirm={handleConfirmGenerate}
      />

      <Card size="sm">
        <CardContent>
            <section aria-label="Vista previa">
            <h2 className={SECTION_HEADING}>Vista previa</h2>
            <div className={CARD}>
              <CatalogTemplate
                title={title}
                sections={sections}
                branding={{
                  templateId: getTemplate(templateConfig?.selectedTemplateId).id,
                  // The logo route is session-authenticated (the browser sends
                  // its cookie) — only supply the URL when a logo actually
                  // exists, so an unset logo renders no <img> instead of a
                  // broken one (matches the worker's per-key null handling).
                  logoUrl: workshopConfig?.logoR2Key ? "/api/workshop-config/logo" : null,
                  coverText: workshopConfig?.coverText ?? null,
                }}
              />
            </div>
          </section>
        </CardContent>
      </Card>

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
