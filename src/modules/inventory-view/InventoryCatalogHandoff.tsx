"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { MAX_TOTAL_PRODUCTS, maxTotalProductsMessage } from "@/modules/catalog-builder/selection";
import { useSelection } from "@/shared/ui/selection/SelectionProvider";

/**
 * The action slot `SelectionBar` leaves open, filled for `/inventory`
 * (`catalog-generation` delta, design D10).
 *
 * **Transport only.** It hands the builder a list of ids in the URL and
 * nothing else — the builder resolves each id's current product data itself
 * (spec: "the handoff MUST carry only the selected product ids"). There is no
 * `BulkResultPanel` beside this button, unlike `/customers` and `/users`: this
 * is one navigation, not N row mutations, so there are no per-row outcomes to
 * report and a panel would be an empty promise of one.
 *
 * The 200 cap is refused HERE, before navigating (D10 point 4). The builder
 * would refuse the same selection after the jump, which costs the operator a
 * page load to be told a number this bar already knew.
 */
export function InventoryCatalogHandoff() {
  const { selected } = useSelection();
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  const router = useRouter();

  const overCap = selected.size > MAX_TOTAL_PRODUCTS;

  function send() {
    if (overCap) {
      setRefusedAt(selected.size);
      return;
    }
    setRefusedAt(null);
    // Encoded per id, joined by a literal comma: the ids are free ERP text
    // this app does not mint, and the comma stays unescaped because it is
    // legal in a query string and is what the builder splits on (D10).
    router.push(`/builder?products=${[...selected].map(encodeURIComponent).join(",")}`);
  }

  return (
    <>
      {/* `size="sm"` is `h-7` = 28px (`button.tsx`'s `size` variants);
          `min-h-11 min-w-11` is AGENTS.md's 44x44 floor on top of it, matching
          "Limpiar selección" beside it. */}
      <Button variant="outline" size="sm" className="min-h-11 min-w-11" onClick={send}>
        Enviar al generador
      </Button>

      {/* Gated on the CURRENT size, not only on having been refused: unticking
          back down to a legal selection has to take the refusal with it, or
          the bar keeps quoting a count that is no longer selected. */}
      {refusedAt !== null && overCap && (
        <p role="alert" className="text-sm text-destructive">
          {maxTotalProductsMessage(refusedAt)}
        </p>
      )}
    </>
  );
}
