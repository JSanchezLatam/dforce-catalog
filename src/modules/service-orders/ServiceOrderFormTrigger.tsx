"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import type { OrdenServicio } from "@/shared/db/schema";
import {
  ServiceOrderForm,
  type ServiceOrderCustomerOption,
  type ServiceOrderProductOption,
} from "./ServiceOrderForm";

/**
 * Thin client wrapper around `ServiceOrderForm` for use from server-component
 * pages (Phase 6, design.md §8) — same `router.refresh()`-on-save pattern as
 * `CustomerFormTrigger.tsx`, for the same RSC function-prop reason.
 */
export function ServiceOrderFormTrigger({
  products,
  order,
  selectedCustomer,
  canCreateCustomer,
  triggerLabel,
}: {
  products: ServiceOrderProductOption[];
  order?: OrdenServicio | null;
  selectedCustomer?: ServiceOrderCustomerOption | null;
  canCreateCustomer: boolean;
  triggerLabel?: ReactNode;
}) {
  const router = useRouter();
  return (
    <ServiceOrderForm
      products={products}
      order={order}
      selectedCustomer={selectedCustomer}
      canCreateCustomer={canCreateCustomer}
      triggerLabel={triggerLabel}
      onSaved={() => router.refresh()}
    />
  );
}
