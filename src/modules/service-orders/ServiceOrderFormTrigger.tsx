"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import type { OrdenServicio } from "@/shared/db/schema";
import { useToast } from "@/shared/ui/ToastProvider";
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
}: {
  order?: OrdenServicio | null;
  selectedCustomer?: ServiceOrderCustomerOption | null;
  canCreateCustomer: boolean;
  triggerLabel?: ReactNode;
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
      onSaved={() => {
        // ABOVE `router.refresh()`, the ordering `OrderStatusControls` records
        // for the mirror-image case: a refresh that throws must not take the
        // only evidence the save happened with it. The dialog has already
        // closed by here, so the toast is all the operator gets.
        addToast("success", isEdit ? "Orden actualizada" : "Orden creada");
        router.refresh();
      }}
    />
  );
}
