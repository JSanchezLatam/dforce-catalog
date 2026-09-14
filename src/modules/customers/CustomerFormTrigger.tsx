"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import type { Cliente, Vehiculo } from "@/shared/db/schema";
import { useToast } from "@/shared/ui/ToastProvider";
import { CustomerForm } from "./CustomerForm";

/**
 * Thin client wrapper around `CustomerForm` for use from server-component
 * pages (Phase 6, design.md §8). A Server Component cannot pass a plain
 * function as `onSaved` across the RSC boundary, so this wrapper owns
 * `useRouter()` itself and supplies `onSaved={() => router.refresh()}`,
 * refreshing the server-rendered list/detail data after a successful
 * create/edit without a full page reload.
 */
export function CustomerFormTrigger({
  cliente,
  vehicles,
  canDeleteVehicle,
  triggerLabel,
}: {
  cliente?: Cliente | null;
  /** The customer's whole vehicle collection (active + inactive) — omitted in create mode. */
  vehicles?: Vehiculo[] | null;
  /** `customers.deleteVehicle`, resolved on the server — see `CustomerForm`. */
  canDeleteVehicle?: boolean;
  triggerLabel?: ReactNode;
}) {
  const router = useRouter();
  const { addToast } = useToast();
  return (
    <CustomerForm
      cliente={cliente}
      vehicles={vehicles}
      canDeleteVehicle={canDeleteVehicle}
      triggerLabel={triggerLabel}
      onSaved={() => {
        // `cliente` is what tells edit from create — the same flag
        // `CustomerForm` reads for its own `isEdit`.
        //
        // The toast goes FIRST, above `router.refresh()`, following
        // `OrderStatusControls`: the server has already accepted the save, so
        // a refresh that throws must not be able to swallow the one thing
        // that tells the operator so. `CustomerForm` calls this from OUTSIDE
        // its try/catch, so a throw here propagates rather than printing
        // "no se pudo conectar" over a save that succeeded.
        addToast("success", cliente ? "Cliente actualizado" : "Cliente creado");
        router.refresh();
      }}
    />
  );
}
