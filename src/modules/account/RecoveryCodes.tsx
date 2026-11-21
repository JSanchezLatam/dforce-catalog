"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Blob plus `a[download]`: works over plain HTTP, unlike the clipboard (AGENTS.md). */
function downloadCodes(codes: string[]) {
  const text = `Códigos de recuperación. Cada uno sirve una sola vez.\n\n${codes.join("\n")}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "codigos-de-recuperacion.txt";
  link.click();
  // Revoked in a later task: revoking in the click's own task can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The 10 recovery codes, shown once (S4, mockup `s4` "recién activado"), with
 * Imprimir, Descargar .txt and "Ya los guardé". Shared by Mi cuenta (T8a) and
 * the mandatory setup (T8b). `buttonClassName` lets the login-styled setup
 * screen keep its 44px controls.
 */
export function RecoveryCodes({
  codes,
  onDone,
  buttonClassName,
}: {
  codes: string[];
  onDone: () => void;
  buttonClassName?: string;
}) {
  return (
    <>
      <Alert>
        <p>
          <b className="text-foreground">Guardá tus códigos de recuperación.</b> Cada uno sirve una sola vez, si perdés el
          teléfono. Es la única vez que los verás.
        </p>
      </Alert>
      <ul aria-label="Códigos de recuperación" className="grid grid-cols-2 gap-2 font-mono text-sm sm:max-w-md">
        {codes.map((c) => (
          <li key={c} className="rounded-md border bg-muted px-3 py-2 text-center text-foreground">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className={buttonClassName} onClick={() => window.print()}>
          Imprimir
        </Button>
        <Button type="button" variant="outline" className={buttonClassName} onClick={() => downloadCodes(codes)}>
          Descargar .txt
        </Button>
        <Button type="button" className={buttonClassName} onClick={onDone}>
          Ya los guardé
        </Button>
      </div>
    </>
  );
}
