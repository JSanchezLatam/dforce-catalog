"use client";

import { Info, MessageCircleMore } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, statusBadgeClassName } from "@/shared/ui/StatusBadge";

import { FEEDBACK_CATEGORY_LABELS, type FeedbackCategory } from "./categories";
import { useFeedback } from "./FeedbackProvider";

/** Strings and booleans only: built by the Server Component page, so dates arrive already formatted. */
export type MyFeedbackRow = {
  id: string;
  category: FeedbackCategory;
  text: string;
  screenLabel: string;
  createdAt: string;
  delivered: boolean;
};

export function MyFeedbackCard({ rows }: { rows: MyFeedbackRow[] }) {
  const feedback = useFeedback();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mis comentarios</CardTitle>
        <CardDescription>Lo que enviaste al equipo de soporte.</CardDescription>
        <CardAction>
          <Button type="button" variant="outline" onClick={() => feedback?.openFeedback()} className="min-h-11 min-w-11">
            <MessageCircleMore aria-hidden />
            Enviar comentario
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="py-6 text-center">
            <h4 className="font-medium">Todavía no enviaste comentarios</h4>
            <p className="mt-1 text-sm text-muted-foreground">
              Usá «Enviar comentario» en el menú para contarnos qué anda mal o qué mejorarías.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={statusBadgeClassName("pending")}>{FEEDBACK_CATEGORY_LABELS[r.category]}</span>
                  <StatusBadge
                    status={r.delivered ? "completed" : "warning"}
                    label={r.delivered ? "Enviado" : "Pendiente de envío"}
                  />
                </div>
                <p className="truncate text-sm">{r.text.split("\n")[0]}</p>
                <p className="text-[13px] text-muted-foreground">{`${r.createdAt} · ${r.screenLabel}`}</p>
                {!r.delivered && (
                  <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <Info aria-hidden className="size-3.5 shrink-0" />
                    Sin conexión a internet. Se envía solo cuando vuelva.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
