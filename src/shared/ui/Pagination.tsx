"use client";

import Link from "next/link";

type PaginationProps = {
  currentPage: number;
  pageCount: number;
} & (
  | { buildHref: (page: number) => string; onPageChange?: undefined; hrefPattern?: undefined }
  | { buildHref?: undefined; onPageChange: (page: number) => void; hrefPattern?: undefined }
  | { buildHref?: undefined; onPageChange?: undefined; hrefPattern: string }
);

function buildWindow(current: number, total: number): (number | "ellipsis")[] {
  const pages: (number | "ellipsis")[] = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    const windowStart = Math.max(2, current - 2);
    const windowEnd = Math.min(total - 1, current + 2);
    if (windowStart > 2) pages.push("ellipsis");
    for (let i = windowStart; i <= windowEnd; i++) pages.push(i);
    if (windowEnd < total - 1) pages.push("ellipsis");
    pages.push(total);
  }
  return pages;
}

/**
 * `py-1`, matching `pageClassName` exactly. At `py-1.5` these were 32px tall
 * against the 28px page numbers sitting beside them in the same row — the same
 * control, two heights, four pixels apart.
 *
 * SHARED: this row also renders on /inventory, /service-orders and inside
 * `CatalogBuilderForm`. Prev/Next shrink by 4px on all four.
 *
 * Waived into the customers PR by the owner rather than split out. AGENTS.md
 * sends a tempting related improvement to `tasks.md`, but this is not one:
 * the mismatch was one of the three defects reported ON the customers screen,
 * and it is not fixable from inside that module. Splitting it would have
 * merged the customers PR with the reported defect still visible.
 */
const navClassName = "rounded-lg px-3 py-1 text-primary hover:bg-muted transition-colors";

function pageClassName(isActive: boolean): string {
  return `rounded-lg px-3 py-1 text-sm ${
    isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
  }`;
}

export function Pagination(props: PaginationProps) {
  const { currentPage, pageCount } = props;
  if (pageCount <= 1) return null;
  const pages = buildWindow(currentPage, pageCount);
  const isHrefPattern = "hrefPattern" in props;

  const pageHref = (page: number) =>
    isHrefPattern ? props.hrefPattern!.replace("{page}", String(page)) : props.buildHref!(page);

  const renderNav = (page: number, label: string) =>
    props.onPageChange ? (
      <button type="button" onClick={() => props.onPageChange(page)} className={navClassName}>
        {label}
      </button>
    ) : (
      <Link href={pageHref(page)} className={navClassName}>
        {label}
      </Link>
    );

  const renderPage = (page: number) =>
    props.onPageChange ? (
      <button
        key={page}
        type="button"
        onClick={() => props.onPageChange(page)}
        className={pageClassName(page === currentPage)}
      >
        {page}
      </button>
    ) : (
      <Link key={page} href={pageHref(page)} className={pageClassName(page === currentPage)}>
        {page}
      </Link>
    );

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground">
      {currentPage > 1 && renderNav(currentPage - 1, "Anterior")}
      {pages.map((p, idx) =>
        p === "ellipsis" ? (
          <span key={`e-${idx}`} className="px-2 text-muted-foreground">
            …
          </span>
        ) : (
          renderPage(p)
        ),
      )}
      {currentPage < pageCount && renderNav(currentPage + 1, "Siguiente")}
      <span className="ml-4 text-muted-foreground">
        Página {currentPage} de {pageCount}
      </span>
    </nav>
  );
}
