import { House, Lock } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { cn } from "@/lib/utils";

/**
 * The one refusal screen (audit #18): a técnico opening a page they cannot
 * use sees the page's own title, a sentence, and a way out, instead of a bare
 * line of text. A server component, like `PageHeader`. Pages keep their
 * `can(user, "<action>")` call (`route-guards.test.ts` reads it) and only
 * render this in the refused branch — status and redirects are unchanged.
 */
export function PermissionDenied({ title }: { title: string }) {
  return (
    <div className="p-4 sm:p-8">
      <PageHeader title={title} />
      <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center text-card-foreground">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Lock className="size-7" aria-hidden="true" />
        </span>
        <h2 className="text-base font-semibold">No tenés permiso para ver esta página</h2>
        <p className="text-sm text-muted-foreground">Pedile acceso a un administrador.</p>
        <Link href="/" className={cn(buttonVariants(), "mt-2 min-h-11 gap-1.5 px-4")}>
          <House aria-hidden="true" />
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
