"use client";

import { usePathname } from "next/navigation";

// Inline so a test can pin the 44x44 target; jsdom loads no stylesheet.
const TARGET = { minHeight: "2.75rem", minWidth: "2.75rem" };

/** Rendered inside each page's SupportHeader with the count that page read (design D11). */
export function SupportNav({ nuevo }: { nuevo: number }) {
  const uso = usePathname().startsWith("/support/uso");
  return (
    <nav className="snav" aria-label="Secciones de soporte">
      <a href="/support" aria-current={uso ? undefined : "page"} style={TARGET}>
        Comentarios
        {nuevo > 0 && (
          <span className="n" aria-label={`${nuevo} ${nuevo === 1 ? "nuevo" : "nuevos"}`}>
            {nuevo}
          </span>
        )}
      </a>
      <a href="/support/uso" aria-current={uso ? "page" : undefined} style={TARGET}>
        Uso
      </a>
    </nav>
  );
}
