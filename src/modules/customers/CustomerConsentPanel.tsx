"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/shared/ui/ToastProvider";
import { CONSENT_CLAUSE_BANNER, CONSENT_CLAUSE_PARAGRAPHS } from "./consent-clause";

export type ConsentView = {
  granted: boolean;
  recordedByName: string | null;
  /** Formatted on the server in the workshop's time zone, so the client never re-renders a date. */
  recordedAtLabel: string;
};

const FAILURE = "No se pudo registrar el consentimiento.";

/**
 * Ley 81 consent for the customer portal (customer-portal WU1). The checkbox is
 * a DRAFT: nothing is recorded until "Guardar consentimiento", and an unchanged
 * draft cannot be saved, so touching the screen never appends a row.
 *
 * No controls at all without `customers.consent` (a button that always 403s is
 * worse than none), and none for a deactivated customer, whose consent is
 * frozen like the rest of the record (R20). Same wrapper shape as
 * `CustomerActivationButton`: a Server Component cannot hand a function across
 * the RSC boundary, so this owns `useRouter()`.
 */
export function CustomerConsentPanel({
  clienteId,
  canRecord,
  deactivated = false,
  consent,
}: {
  clienteId: string;
  canRecord: boolean;
  deactivated?: boolean;
  consent: ConsentView | null;
}) {
  const router = useRouter();
  const { addToast } = useToast();
  const current = consent?.granted ?? false;
  const [draft, setDraft] = useState(current);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setIsSubmitting(true);
    setError(null);
    let changed = true;
    try {
      const response = await fetch(`/api/customers/${clienteId}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ granted: draft }),
      });
      if (!response.ok) {
        setError(
          response.status === 409
            ? "El cliente está desactivado; no se puede cambiar el consentimiento."
            : FAILURE,
        );
        return;
      }
      // A body we cannot read still means the server accepted it: only an
      // explicit `changed: false` (someone else got there first) changes the copy.
      const body = (await response.json().catch(() => null)) as { changed?: boolean } | null;
      changed = body?.changed !== false;
    } catch {
      setError(FAILURE);
      return;
    } finally {
      setIsSubmitting(false);
    }

    // BELOW the try/catch, toast above the refresh: see `CustomerActivationButton`.
    addToast(
      "success",
      changed
        ? draft
          ? "Consentimiento registrado"
          : "Consentimiento revocado"
        : draft
          ? "El consentimiento ya estaba registrado"
          : "El consentimiento ya estaba revocado",
    );
    router.refresh();
  }

  const by = consent?.recordedByName ? ` por ${consent.recordedByName}` : "";
  const status = !consent
    ? "Sin consentimiento registrado."
    : `Consentimiento ${consent.granted ? "otorgado" : "revocado"}${by} el ${consent.recordedAtLabel}`;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Portal del cliente</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-foreground">{status}</p>

        <div data-testid="consent-clause" className="flex max-w-prose flex-col gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">{CONSENT_CLAUSE_BANNER}</p>
          {CONSENT_CLAUSE_PARAGRAPHS.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        {deactivated && (
          <p className="text-sm text-muted-foreground">
            El consentimiento no se puede cambiar mientras el cliente está desactivado.
          </p>
        )}

        {canRecord && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-foreground">
              <Checkbox checked={draft} onCheckedChange={(checked) => setDraft(checked === true)} />
              Consentimiento de datos (Ley 81)
            </label>
            <Button
              type="button"
              size="default"
              className="min-h-11 min-w-11"
              disabled={isSubmitting || draft === current}
              onClick={save}
            >
              Guardar consentimiento
            </Button>
          </div>
        )}

        {error && (
          <Alert role="alert" variant="destructive">
            <TriangleAlert aria-hidden="true" />
            {error}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
