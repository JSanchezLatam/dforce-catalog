"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OTHER, VEHICLE_MAKES, modelsForMake } from "./vehicle-catalog";

/**
 * The two `marca`/`modelo` selects shared by both vehicle write paths
 * (`VehicleQuickForm.tsx`, `CustomerForm.tsx`'s vehicle collection — design.md
 * D17). Owns the "Otro" escape and the make→model reset; owns nothing else —
 * no `fetch`, no payload shape, no validation, no `year` (D18).
 *
 * **The sentinel.** `OTHER` ("__otro__") is what the select holds while in
 * escape mode; the literal string "Otro" is a LABEL only and is never stored
 * (D14). What IS stored is whatever staff typed into the revealed input.
 *
 * **The never-blank rule (D15).** Escape mode is DERIVED from the stored
 * value at mount, via a LAZY `useState(() => …)` initialiser — lazy on
 * purpose, so the initialiser runs once and never re-seeds mid-typing off a
 * prop object the parent rebuilds every render (the same lesson WU1's D3
 * teaches about `useUrlFilters`'s `initialText`). A stored `make = "Hino"`
 * that the catalog does not list opens in escape mode showing "Hino" — the
 * make removed from the catalog last week behaves identically to the make
 * that was never in it.
 *
 * **The reset (D16).** Changing the make clears the model, but ONLY inside
 * the make SELECT's change handler — never a `useEffect` on `make`, which
 * would fire on mount and blank a legitimately stored model the first time an
 * existing vehicle is opened for editing. Typing inside the free-text make
 * input does NOT clear the model: in escape mode the model is free text too,
 * so there is no list for it to have fallen off, and a per-keystroke clear
 * would be hostile.
 */
export function VehicleMakeModelFields({
  idPrefix,
  make,
  model,
  onChange,
  className,
}: {
  /** "vehiculo-rapido" in the quick form; the vehicle row's `key` in `CustomerForm`. */
  idPrefix: string;
  make: string;
  model: string;
  /** Emitted as ONE update — a make change carries `model: ""` with it (D16). */
  onChange: (next: { make: string; model: string }) => void;
  className?: string;
}) {
  const [makeIsOther, setMakeIsOther] = useState(() => make !== "" && !VEHICLE_MAKES.includes(make));
  const [modelIsOther, setModelIsOther] = useState(() => model !== "" && !modelsForMake(make).includes(model));

  const models = modelsForMake(make);
  const makeId = `${idPrefix}-make`;
  const modelId = `${idPrefix}-model`;

  // `items` is what lets `SelectValue` render the human label "Otro" instead
  // of the raw sentinel it is bound to — the same reason `UserForm.tsx`'s
  // role select passes `items={ROLE_LABELS}`. Every catalog make is its own
  // label, so only the sentinel needs mapping.
  const makeItems: Record<string, string> = Object.fromEntries(VEHICLE_MAKES.map((m) => [m, m]));
  makeItems[OTHER] = "Otro";
  const modelItems: Record<string, string> = Object.fromEntries(models.map((m) => [m, m]));
  modelItems[OTHER] = "Otro";

  function handleMakeSelect(value: string) {
    const nextIsOther = value === OTHER;
    setMakeIsOther(nextIsOther);
    // Every discrete make CHANGE clears the model, regardless of which
    // direction it moves (catalog→catalog, catalog→Otro, Otro→catalog) — a
    // model belonging to the previous make can never remain selected (D16).
    setModelIsOther(false);
    onChange({ make: nextIsOther ? "" : value, model: "" });
  }

  function handleMakeText(value: string) {
    // A keystroke inside the free-text make input is NOT a make CHANGE — the
    // model is left exactly as it is (D16).
    onChange({ make: value, model });
  }

  function handleModelSelect(value: string) {
    const nextIsOther = value === OTHER;
    setModelIsOther(nextIsOther);
    onChange({ make, model: nextIsOther ? "" : value });
  }

  function handleModelText(value: string) {
    onChange({ make, model: value });
  }

  return (
    <div className={cn("contents", className)}>
      <div className="grid gap-2">
        <Label htmlFor={makeId}>Marca</Label>
        <Select
          items={makeItems}
          value={makeIsOther ? OTHER : make || null}
          onValueChange={(value) => handleMakeSelect(value as string)}
        >
          <SelectTrigger id={makeId} className="w-full">
            <SelectValue placeholder="Seleccioná una marca" />
          </SelectTrigger>
          <SelectContent>
            {VEHICLE_MAKES.map((makeOption) => (
              <SelectItem key={makeOption} value={makeOption}>
                {makeOption}
              </SelectItem>
            ))}
            <SelectItem value={OTHER}>Otro</SelectItem>
          </SelectContent>
        </Select>
        {makeIsOther && (
          <div className="grid gap-2">
            <Label htmlFor={`${makeId}-other`}>Especificá la marca</Label>
            <Input id={`${makeId}-other`} value={make} onChange={(e) => handleMakeText(e.target.value)} />
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={modelId}>Modelo</Label>
        {makeIsOther ? (
          // No make selected from the catalog ⇒ no model list to offer. A
          // one-item dropdown holding only "Otro" is a worse control than the
          // plain text box it would replace (D14).
          <Input id={modelId} value={model} onChange={(e) => handleModelText(e.target.value)} />
        ) : (
          <>
            <Select
              items={modelItems}
              value={modelIsOther ? OTHER : model || null}
              onValueChange={(value) => handleModelSelect(value as string)}
            >
              <SelectTrigger id={modelId} className="w-full">
                <SelectValue placeholder="Seleccioná un modelo" />
              </SelectTrigger>
              <SelectContent>
                {models.map((modelOption) => (
                  <SelectItem key={modelOption} value={modelOption}>
                    {modelOption}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>Otro</SelectItem>
              </SelectContent>
            </Select>
            {modelIsOther && (
              <div className="grid gap-2">
                <Label htmlFor={`${modelId}-other`}>Especificá el modelo</Label>
                <Input id={`${modelId}-other`} value={model} onChange={(e) => handleModelText(e.target.value)} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
