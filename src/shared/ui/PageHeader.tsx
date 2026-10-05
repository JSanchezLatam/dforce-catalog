import type { ReactNode } from "react";

import { PAGE_HEADING } from "@/shared/ui/styles";

/**
 * The one page header: title on one line at phone size, actions wrapping BELOW
 * it instead of pushing off-screen (audit #1), and the spacing under the whole
 * header owned here so no page re-spells it. A server component on purpose:
 * `actions` is usually a client trigger, which a server parent can pass as
 * children; nothing here needs the browser.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className={PAGE_HEADING}>{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
