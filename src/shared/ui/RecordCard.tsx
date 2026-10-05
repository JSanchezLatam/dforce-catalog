import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Phone layout of a list row (mobile-responsive-pass design: one server render,
 * the table is `hidden md:block`, this list is `md:hidden`, both mapped from the
 * same array). Cards carry no checkbox: selection is tablet-plus only.
 */
export function RecordCardList({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <ul className="flex flex-col gap-3 md:hidden" data-testid={testId}>
      {children}
    </ul>
  );
}

/**
 * With `href` the WHOLE card is one link (one tap target, one accessible name
 * built from its content). `action` sits OUTSIDE the link: a control nested in
 * an anchor is invalid and swallows the card's tap.
 */
export function RecordCard({ href, action, children }: { href?: string; action?: ReactNode; children: ReactNode }) {
  const body = href ? (
    <Link href={href} className="flex min-h-11 items-center gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  ) : (
    <div className="flex flex-col gap-2">{children}</div>
  );

  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      {body}
      {action}
    </li>
  );
}
