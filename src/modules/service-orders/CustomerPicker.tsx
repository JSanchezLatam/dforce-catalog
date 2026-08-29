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

/** design.md's identifier precedence: plates → phone → email → registration date fallback. */
function identifierFor(customer: ClienteListItem, plates: string[]): string {
  if (plates.length > 0) return plates.join(", ");
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
}: {
  selectedCustomer: ClienteListItem | null;
  canCreateCustomer: boolean;
  onSelect: (customer: ClienteListItem) => void;
}) {
  const [term, setTerm] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<ClienteListItem[]>([]);
  const [relaxedFrom, setRelaxedFrom] = useState<string | undefined>(undefined);
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
      setRelaxedFrom(undefined);
      setError(null);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/customers?search=${encodeURIComponent(value)}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`GET /api/customers failed with ${response.status}`);
      const body: ListClientesResponse = await response.json();
      if (controller.signal.aborted) return;
      setResults(body.customers);
      setRelaxedFrom(body.relaxedFrom);
      setError(null);
      setHasSearched(true);
    } catch {
      if (controller.signal.aborted) return;
      setResults([]);
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

  function handleSelect(customer: ClienteListItem) {
    setSelected(customer);
    onSelect(customer);
  }

  // Zero EXACT matches: either the near-match pass found some (relaxedFrom
  // set — results are near matches, never exact) or both passes found none.
  const zeroExactMatches = hasSearched && (relaxedFrom !== undefined || results.length === 0);

  return (
    <div className="flex flex-col gap-3">
      {selected && (
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-foreground">
          Cliente seleccionado: <span className="font-medium">{selected.name}</span>
        </div>
      )}

      <Input
        aria-label="Buscar cliente por nombre, teléfono o placa"
        placeholder="Buscar cliente…"
        value={term}
        onChange={(e) => handleSearchChange(e.target.value)}
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
                {results.map((customer) => {
                  const plates = customer.vehiclePlate ? [customer.vehiclePlate] : [];
                  return (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell className="text-muted-foreground">{identifierFor(customer, plates)}</TableCell>
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
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {zeroExactMatches && canCreateCustomer && (
        <CustomerForm triggerLabel="Crear cliente nuevo" onSaved={(cliente) => handleSelect(cliente)} />
      )}
    </div>
  );
}
