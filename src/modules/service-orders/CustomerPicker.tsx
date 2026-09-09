"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerForm } from "@/modules/customers/CustomerForm";
import type { ClienteListItem } from "@/modules/customers/queries";
import { FIELD_ERROR } from "@/shared/ui/styles";

const DEBOUNCE_MS = 300;
const SEARCH_FAILED = "No se pudo buscar clientes. Intentalo de nuevo.";
/**
 * One of `parsePageSize`'s allowed options (`inventory-view/queries.ts`), well
 * above its default of 10 — a picker that silently showed the 10 most recently
 * created matches is how a duplicate gets created. Deliberately not paginated:
 * anything past this asks the staff member to narrow the term instead.
 */
const SEARCH_PAGE_SIZE = 50;

/** design.md's identifier precedence: plates → phone → email → registration date fallback. */
function identifierFor(customer: ClienteListItem): string {
  if (customer.plates.length > 0) return customer.plates.join(", ");
  if (customer.phone) return customer.phone;
  if (customer.email) return customer.email;
  return `Registrado el ${new Date(customer.createdAt).toLocaleDateString("es-PA")}`;
}

type ListClientesResponse = { customers: ClienteListItem[]; total: number; relaxedFrom?: string };

/**
 * R19/service-orders — async, debounced customer search+select for the
 * order-creation dialog. Reuses `CustomerFilters.tsx`'s 300ms `debounceRef`
 * idiom, but the debounced effect is a `fetch`, not `router.push` — a URL
 * push here would re-render the page and drop the in-progress parts cart
 * (design.md, "reuse CustomerFilters' debounce, not its URL push").
 *
 * Owns `selectedCustomer` as an object, seeded from the `selectedCustomer`
 * prop and overwritten only by a click — it renders from that state, never
 * from the current result page, so changing the search term cannot blank
 * the selection (design.md decision).
 */
export function CustomerPicker({
  selectedCustomer,
  canCreateCustomer,
  onSelect,
  onDeselect,
}: {
  selectedCustomer: ClienteListItem | null;
  canCreateCustomer: boolean;
  onSelect: (customer: ClienteListItem) => void;
  /**
   * Create mode only. Its presence is what renders the deselect control, so
   * the order-EDIT form simply omits it: `clienteId` is not patchable, and a
   * "quitar" that PATCH would refuse is a promise the API does not keep.
   */
  onDeselect?: () => void;
}) {
  const [term, setTerm] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<ClienteListItem[]>([]);
  const [relaxedFrom, setRelaxedFrom] = useState<string | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<ClienteListItem | null>(selectedCustomer);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Every failure mode lands on the same rendered state: an error the staff
   * member can read, never a blank dialog they mistake for "keep typing".
   * The `AbortController` is the sequencing guard — a slow earlier response
   * cannot overwrite the rows a faster later search already painted.
   */
  async function runSearch(value: string) {
    abortRef.current?.abort();
    if (!value.trim()) {
      setHasSearched(false);
      setResults([]);
      setTotal(0);
      setRelaxedFrom(undefined);
      setError(null);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const url = `/api/customers?search=${encodeURIComponent(value)}&pageSize=${SEARCH_PAGE_SIZE}`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`GET /api/customers failed with ${response.status}`);
      const body: ListClientesResponse = await response.json();
      if (controller.signal.aborted) return;
      setResults(body.customers);
      setTotal(body.total);
      setRelaxedFrom(body.relaxedFrom);
      setError(null);
      setHasSearched(true);
    } catch {
      if (controller.signal.aborted) return;
      setResults([]);
      setTotal(0);
      setRelaxedFrom(undefined);
      setHasSearched(false);
      setError(SEARCH_FAILED);
    }
  }

  function handleSearchChange(value: string) {
    setTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  }

  /**
   * D6 — the pick ends the search. Leaving `term` and the result rows on
   * screen under the "Cliente seleccionado" banner reads as if nothing
   * happened, and the truncation/near-match notices then describe a search
   * the operator has already finished with.
   *
   * The pending debounce and the in-flight request are cancelled for the same
   * reason: a keystroke 300ms before the click would otherwise repaint the
   * very list this just cleared.
   */
  function handleSelect(customer: ClienteListItem) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    setTerm("");
    setResults([]);
    setTotal(0);
    setRelaxedFrom(undefined);
    setHasSearched(false);
    setError(null);
    setSelected(customer);
    onSelect(customer);
  }

  function handleDeselect() {
    setSelected(null);
    onDeselect?.();
  }

  // Zero EXACT matches: either the near-match pass found some (relaxedFrom
  // set — results are near matches, never exact) or both passes found none.
  const zeroExactMatches = hasSearched && (relaxedFrom !== undefined || results.length === 0);

  return (
    <div className="flex flex-col gap-3">
      {selected && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3 text-sm text-foreground">
          <span>
            Cliente seleccionado: <span className="font-medium">{selected.name}</span>
          </span>
          {onDeselect && (
            // `min-h-11 min-w-11` on top of the button's own `h-8`: AGENTS.md's
            // 44x44 floor, whose only waiver is the pointer-only sidebar rail.
            // This dialog is used from a workshop tablet.
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 min-w-11 shrink-0"
              aria-label="Quitar cliente seleccionado"
              onClick={handleDeselect}
            >
              Quitar
            </Button>
          )}
        </div>
      )}

      <Input
        aria-label="Buscar cliente por nombre, teléfono o placa"
        placeholder="Buscar cliente…"
        value={term}
        onChange={(e) => handleSearchChange(e.target.value)}
        // This input lives inside ServiceOrderForm's <form>, and a lone text
        // input in a form with a submit button triggers implicit submission on
        // Enter. Hitting Enter to "run the search" would save the order instead
        // — with whatever customer was picked, or none. The picker introduced
        // the input, so the picker contains the consequence rather than making
        // the form defend against its children.
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />

      {error && (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      )}

      {hasSearched && results.length > 0 && (
        <div className="flex flex-col gap-2">
          {relaxedFrom !== undefined && (
            <p className="text-sm text-muted-foreground">Sin coincidencias exactas. Clientes similares:</p>
          )}
          {total > results.length && (
            <p className="text-sm text-muted-foreground">
              {total} clientes coinciden y se muestran los primeros {results.length}. Refiná la búsqueda.
            </p>
          )}
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Placa / teléfono / email</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {identifierFor(customer)}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Seleccionar ${customer.name}`}
                        onClick={() => handleSelect(customer)}
                      >
                        Seleccionar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Before the create action, and independent of the permission that
          gates it: a reader who cannot create still has to be told the search
          came back empty. Rendering nothing is indistinguishable from "still
          typing", which is the failure the error branch above already fixed. */}
      {hasSearched && results.length === 0 && (
        <p className="text-sm text-muted-foreground">Sin coincidencias para esa búsqueda.</p>
      )}

      {zeroExactMatches && canCreateCustomer && (
        // `onSaved`'s second argument is exactly what this create just wrote
        // (the form's own submitted vehicle collection), not a hardcoded `[]`
        // — the API's 201 response carries only the `cliente` row, no
        // `vehicles`/`plates`, so the form is the only thing that knows what
        // it sent. A hardcoded `[]` here used to be harmless only because the
        // table above still read the flat `vehiclePlate` field instead of
        // `plates` — now that it reads `plates`, this is what keeps a
        // customer created from inside the picker showing its real plate.
        <CustomerForm
          triggerLabel="Crear cliente nuevo"
          onSaved={(cliente, plates) => handleSelect({ ...cliente, plates })}
        />
      )}
    </div>
  );
}
