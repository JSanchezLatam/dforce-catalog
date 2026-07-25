"use client";

import type { Catalog } from "@/shared/db/schema";
import { usePollWhileActive } from "@/hooks/usePollWhileActive";

export function CatalogPollProvider({
  initialCatalogs,
  children,
}: {
  initialCatalogs: Catalog[];
  children: React.ReactNode;
}) {
  usePollWhileActive(initialCatalogs);

  return <>{children}</>;
}
