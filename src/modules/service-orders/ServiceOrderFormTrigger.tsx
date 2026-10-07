"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import type { OrdenServicio } from "@/shared/db/schema";
import { useToast } from "@/shared/ui/ToastProvider";
import type { VehiculoMotor } from "@/modules/customers/vehicle-options";
import { isClosedStatus } from "./edit-policy";
import { ServiceOrderForm, type ServiceOrderCustomerOption } from "./ServiceOrderForm";

/**
 * Thin client wrapper around `ServiceOrderForm` for use from server-component
 * pages (Phase 6, design.md §8) — same `router.refresh()`-on-save pattern as
 * `CustomerFormTrigger.tsx`, for the same RSC function-prop reason.
 */
export function ServiceOrderFormTrigger({
  order,
  selectedCustomer,
  canCreateCustomer,
  triggerLabel,
  motor,
  tecnicos,
}: {
  order?: OrdenServicio | null;
  selectedCustomer?: ServiceOrderCustomerOption | null;
  canCreateCustomer: boolean;
  triggerLabel?: ReactNode;
  /** The order's vehicle's motor (edit mode); decides which intake inputs show. */
  motor?: VehiculoMotor | null;
  /** Create mode: the active roster for the picker (plain data; see `ServiceOrderForm`). */
  tecnicos?: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const { addToast } = useToast();
  // The same prop `ServiceOrderForm` reads for `isEdit` — nothing else here
  // knows which of the two requests it just made, and "Orden creada" over an
  // edit claims a second order now exists.
  const isEdit = Boolean(order);

  return (
    <ServiceOrderForm
      order={order}
      selectedCustomer={selectedCustomer}
      canCreateCustomer={canCreateCustomer}
      triggerLabel={triggerLabel}
      motor={motor}
      tecnicos={tecnicos}
      onSaved={(saved) => {
        // ABOVE the navigation, the ordering `OrderStatusControls` records
        // for the mirror-image case: a refresh or push that throws must not
        // take the only evidence the save happened with it. The dialog has
        // already closed by here, so the toast is all the operator gets.
        addToast("success", isEdit ? (isClosedStatus(order!.status) ? "Orden corregida" : "Orden actualizada") : "Orden creada");
        // A created order lands on its own detail page (server-rendered, so
        // fresh); an edit stays put and repaints. A failed save never reaches
        // here — `ServiceOrderForm` only calls `onSaved` after the server said ok.
        if (isEdit) router.refresh();
        else router.push(`/service-orders/${saved.id}`);
      }}
    />
  );
}
