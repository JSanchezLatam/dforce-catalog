"use client";

import { useEffect, useState } from "react";

import { CatalogTemplate } from "@/shared/template/CatalogTemplate";
import type { TemplateConfig } from "@/shared/db/schema";
import { CARD, FIELD_ERROR, INPUT, PRIMARY_BUTTON, SECTION_HEADING } from "@/shared/ui/styles";

import type { CategoryPair } from "./queries";
import {
  applySelection,
  buildIndexSections,
  CatalogSelectionValidationError,
  deriveCatalogTitle,
  MAX_PRODUCTS_PER_PAGE,
  MIN_PRODUCTS_PER_PAGE,
  validateCatalogSelection,
  type CategoryRef,
  type ProductRef,
} from "./selection";

function categoryKey(categoryL1: string, categoryL2: string): string {
  return `${categoryL1}::${categoryL2}`;
}

/**
 * R5 — category/product multi-select+exclude, 1-20 density, 200-cap, live
 * title/index preview. Selection state is in-memory only (R5 never asks it
 * to survive a reload) until "Continue" validates it and POSTs it to
 * `/api/catalog-builder/generate` (PR9), which enqueues the real
 * `pdf-generate` job via `enqueueCatalogPdf()`.
 *
 * ponytail: no live-updating queue-position poll on this screen — position is
 * reported once at enqueue time; the `/catalogs` listing (R7) is where an
 * in-flight job's status is checked afterward (this app's "Real-time"
 * decision is polling-only, design.md).
 */
export function CatalogBuilderForm({
  categoryL1Options,
  categoryPairs,
  templateConfig,
}: {
  categoryL1Options: string[];
  categoryPairs: CategoryPair[];
  templateConfig: TemplateConfig | null;
}) {
  const [includedL1, setIncludedL1] = useState<string[]>([]);
  const [excludedCategoryKeys, setExcludedCategoryKeys] = useState<Set<string>>(new Set());
  const [excludedProductIds, setExcludedProductIds] = useState<Set<string>>(new Set());
  const [productsPerPage, setProductsPerPage] = useState(10);
  const [candidates, setCandidates] = useState<ProductRef[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<"idle" | "submitting" | "queued">("idle");
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [evictionWarning, setEvictionWarning] = useState<string | null>(null); // R11.3

  // R5.1/5.5 — refetch candidate products whenever the included L1 set changes.
  // (`candidates` is only ever set from the fetch callback below, never
  // synchronously in the effect body itself, per react-hooks/set-state-in-effect.)
  useEffect(() => {
    if (includedL1.length === 0) return;
    const categories: CategoryRef[] = includedL1.map((categoryL1) => ({ categoryL1 }));
    let cancelled = false;
    fetch("/api/catalog-builder/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories }),
    })
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setCandidates(body.products ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [includedL1]);

  // Derived, not stored: avoids a redundant setState when the selection is cleared.
  const activeCandidates = includedL1.length === 0 ? [] : candidates;

  const excludedCategories: CategoryRef[] = [...excludedCategoryKeys].map((key) => {
    const [categoryL1, categoryL2] = key.split("::");
    return { categoryL1, categoryL2 };
  });
  const finalProducts = applySelection(activeCandidates, excludedCategories, [...excludedProductIds]);
  const sections = buildIndexSections(finalProducts);
  const title = deriveCatalogTitle(includedL1);

  function toggleL1(categoryL1: string) {
    setIncludedL1((prev) => (prev.includes(categoryL1) ? prev.filter((v) => v !== categoryL1) : [...prev, categoryL1]));
    setErrors({});
    setConfirmed(false);
  }

  function toggleExcludedCategory(categoryL1: string, categoryL2: string) {
    const key = categoryKey(categoryL1, categoryL2);
    setExcludedCategoryKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setConfirmed(false);
  }

  function toggleExcludedProduct(id: string) {
    setExcludedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmed(false);
  }

  async function handleContinue() {
    try {
      validateCatalogSelection({
        includedCategoryCount: includedL1.length,
        totalProductCount: finalProducts.length,
        productsPerPage,
      });
      setErrors({});
      setConfirmed(true);
    } catch (err) {
      if (err instanceof CatalogSelectionValidationError) {
        setErrors(err.errors);
        setConfirmed(false);
        return;
      }
      throw err;
    }

    // R6/R12 — hands the validated selection to the ONE function allowed to
    // enqueue a pdf-generate job (pdf-generation/enqueue.ts's Risk-2 guard),
    // via the server route so the queue-depth check + advisory lock run
    // where the DB transaction lives, not in the browser.
    setGenerateStatus("submitting");
    const response = await fetch("/api/catalog-builder/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        sections,
        products: finalProducts,
        productsPerPage,
        includedCategoryCount: includedL1.length,
      }),
    });

    if (response.status === 409) {
      const body = await response.json();
      setErrors({ total: body.error ?? "Queue is full — try again once a job finishes" });
      setGenerateStatus("idle");
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setErrors(body?.errors ?? { form: "Could not queue this catalog. Try again." });
      setGenerateStatus("idle");
      return;
    }

    const body = await response.json();
    setQueuePosition(body.queuePosition ?? null);
    setEvictionWarning(body.evictionWarning ?? null); // R11.3
    setGenerateStatus("queued");
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Category selection" className={CARD}>
        <h2 className={SECTION_HEADING}>Categories</h2>
        {categoryL1Options.map((l1) => (
          <div key={l1} className="mb-2">
            <label className="flex items-center gap-2 text-sm text-dragon-fg">
              <input type="checkbox" checked={includedL1.includes(l1)} onChange={() => toggleL1(l1)} />
              {l1}
            </label>
            {includedL1.includes(l1) && (
              <ul className="ml-6 flex flex-col gap-1 pt-1">
                {categoryPairs
                  .filter((pair) => pair.categoryL1 === l1)
                  .map((pair) => (
                    <li key={categoryKey(pair.categoryL1, pair.categoryL2)}>
                      <label className="flex items-center gap-2 text-sm text-dragon-fg">
                        <input
                          type="checkbox"
                          checked={!excludedCategoryKeys.has(categoryKey(pair.categoryL1, pair.categoryL2))}
                          onChange={() => toggleExcludedCategory(pair.categoryL1, pair.categoryL2)}
                        />
                        {pair.categoryL2}
                      </label>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ))}
        {errors.categories && (
          <p role="alert" className={FIELD_ERROR}>
            {errors.categories}
          </p>
        )}
      </section>

      {activeCandidates.length > 0 && (
        <section aria-label="Product selection" className={CARD}>
          <h2 className={SECTION_HEADING}>Products ({finalProducts.length} selected)</h2>
          <ul className="flex flex-col gap-1">
            {activeCandidates.map((product) => (
              <li key={product.id}>
                <label className="flex items-center gap-2 text-sm text-dragon-fg">
                  <input
                    type="checkbox"
                    checked={!excludedProductIds.has(product.id)}
                    onChange={() => toggleExcludedProduct(product.id)}
                  />
                  {product.name}
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Page density" className={CARD}>
        <label className="text-sm font-medium text-dragon-fg">
          Products per page
          <input
            type="number"
            min={MIN_PRODUCTS_PER_PAGE}
            max={MAX_PRODUCTS_PER_PAGE}
            value={productsPerPage}
            onChange={(e) => {
              setProductsPerPage(Number(e.target.value));
              setConfirmed(false);
            }}
            className={`mt-1 w-24 ${INPUT}`}
          />
        </label>
        {errors.productsPerPage && (
          <p role="alert" className={FIELD_ERROR}>
            {errors.productsPerPage}
          </p>
        )}
      </section>

      {errors.total && (
        <p role="alert" className={FIELD_ERROR}>
          {errors.total}
        </p>
      )}

      <button
        type="button"
        onClick={handleContinue}
        disabled={generateStatus === "submitting"}
        className={`self-start ${PRIMARY_BUTTON}`}
      >
        {generateStatus === "submitting" ? "Queuing…" : "Continue"}
      </button>

      {confirmed && generateStatus === "queued" && (
        // R12.3/12.4 — position is reported once at enqueue time; this app's
        // "Real-time" decision (design.md) is polling-only, so live updates
        // happen on the /catalogs listing page (R7), not here.
        // ponytail: no live-updating position poll on this page — the
        // /catalogs listing already shows "Processing…" for pending/uploading
        // rows; add a poll here only if a requirement asks for in-place
        // progress on the builder screen itself.
        <p className="text-sm text-dragon-green">
          Queued{queuePosition != null ? ` at position ${queuePosition}` : ""} — {finalProducts.length} products
          across {sections.length} section(s), {productsPerPage}/page.{" "}
          <a href="/catalogs" className="text-dragon-blue hover:underline">
            View your catalogs
          </a>
          .
        </p>
      )}

      {confirmed && generateStatus === "queued" && evictionWarning && (
        <p role="alert" className={FIELD_ERROR}>
          {evictionWarning}
        </p>
      )}

      <section aria-label="Live preview" className={CARD}>
        <h2 className={SECTION_HEADING}>Preview</h2>
        <CatalogTemplate
          title={title}
          sections={sections}
          branding={
            templateConfig
              ? {
                  logoUrl: templateConfig.logoUrl,
                  primaryColors: templateConfig.primaryColors,
                  font: templateConfig.font,
                  coverText: templateConfig.coverText,
                }
              : null
          }
        />
      </section>
    </div>
  );
}
