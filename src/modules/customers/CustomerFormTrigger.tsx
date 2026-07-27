"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import type { Cliente } from "@/shared/db/schema";
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
  triggerLabel,
}: {
  cliente?: Cliente | null;
  triggerLabel?: ReactNode;
}) {
  const router = useRouter();
  return <CustomerForm cliente={cliente} triggerLabel={triggerLabel} onSaved={() => router.refresh()} />;
}
