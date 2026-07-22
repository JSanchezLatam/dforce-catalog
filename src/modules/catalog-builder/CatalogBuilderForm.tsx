"use client";

import { useEffect, useState } from "react";

import { CatalogTemplate } from "@/shared/template/CatalogTemplate";
import type { TemplateConfig } from "@/shared/db/schema";

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
 * title/index preview. All state here is in-memory only.
 *
 * ponytail: client-side-only draft state, no persistence yet — R5 never asks
 * this phase to survive a reload, and pdf-generation (PR7) doesn't exist
 * yet to consume a persisted draft. PR7 will decide exactly how this
 * in-memory `draft` shape crosses into a real queued job (e.g. POST it to a
 * new endpoint at "Generate" time) — do not add a `catalogs` table or job
 * enqueue call here before that decision is made.
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

  function handleContinue() {
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
  }

  return (
    <div>
      <section aria-label="Category selection">
        <h2>Categories</h2>
        {categoryL1Options.map((l1) => (
          <div key={l1}>
            <label>
              <input type="checkbox" checked={includedL1.includes(l1)} onChange={() => toggleL1(l1)} />
              {l1}
            </label>
            {includedL1.includes(l1) && (
              <ul>
                {categoryPairs
                  .filter((pair) => pair.categoryL1 === l1)
                  .map((pair) => (
                    <li key={categoryKey(pair.categoryL1, pair.categoryL2)}>
                      <label>
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
        {errors.categories && <p role="alert">{errors.categories}</p>}
      </section>

      {activeCandidates.length > 0 && (
        <section aria-label="Product selection">
          <h2>Products ({finalProducts.length} selected)</h2>
          <ul>
            {activeCandidates.map((product) => (
              <li key={product.id}>
                <label>
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

      <section aria-label="Page density">
        <label>
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
          />
        </label>
        {errors.productsPerPage && <p role="alert">{errors.productsPerPage}</p>}
      </section>

      {errors.total && <p role="alert">{errors.total}</p>}

      <button type="button" onClick={handleContinue}>
        Continue
      </button>

      {confirmed && (
        <p>
          Draft ready — {finalProducts.length} products across {sections.length} section(s), {productsPerPage}/page.
          PDF generation is not available yet.
        </p>
      )}

      <section aria-label="Live preview">
        <h2>Preview</h2>
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
