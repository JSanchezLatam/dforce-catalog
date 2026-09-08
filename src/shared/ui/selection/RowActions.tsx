"use client";

import type { ReactNode } from "react";
import { MoreVertical } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The kebab trigger for one table row. Deliberately dumb: it owns the hit
 * target and the portal, and nothing else. The items are declared by the
 * calling page (design D6) — there is no shared action registry, so a page
 * that grows an action never has to teach this file about it.
 *
 * `label` is the trigger's accessible name and must identify the row
 * ("Acciones de Juan Perez"): a page renders one of these per row, and
 * `getByRole("button", { name })` has to be able to tell them apart.
 *
 * `children` are already-rendered menu items. A Server Component may pass
 * them — JSX children cross the RSC boundary as elements, unlike a render prop
 * or an `onSelect` callback, which Next.js refuses outright. Nothing that
 * crosses into this component is a function.
 *
 * Two styling decisions, both inherited rather than invented:
 *
 * - `min-h-11 min-w-11` is AGENTS.md's 44x44 floor. Its one waiver is the
 *   collapsed sidebar rail, "desktop-and-pointer-only"; a row action on a
 *   workshop tablet is not that, so the floor binds. `size: "icon"` is
 *   `size-8` = 32px on its own, and `min-*` beats `width`/`height` in CSS.
 * - `buttonVariants` on the base-ui trigger, not a `<Button>` wrapping it —
 *   the reason `customers/page.tsx` records for its own row action.
 */
export function RowActions({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className={cn(buttonVariants({ variant: "outline", size: "icon" }), "min-h-11 min-w-11")}
      >
        <MoreVertical aria-hidden="true" />
      </DropdownMenuTrigger>
      {/* `DropdownMenuContent` defaults to `w-(--anchor-width)`, and the anchor
          here is a 44px square — the menu would be 44px wide. Widened to fit
          its items instead, the same override `app-sidebar.tsx` applies. */}
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
