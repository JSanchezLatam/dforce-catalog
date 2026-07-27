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
  customers,
  products,
  order,
  triggerLabel,
}: {
  customers: ServiceOrderCustomerOption[];
  products: ServiceOrderProductOption[];
  order?: OrdenServicio | null;
  triggerLabel?: ReactNode;
}) {
  const router = useRouter();
  return (
    <ServiceOrderForm
      customers={customers}
      products={products}
      order={order}
      triggerLabel={triggerLabel}
      onSaved={() => router.refresh()}
    />
  );
}
