"use client";

import { Bug, Lightbulb, Loader2, MessageCircleMore, Monitor, User, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogOverlay, DialogPopup, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { useToast } from "@/shared/ui/ToastProvider";

import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_PLACEHOLDERS,
  type FeedbackCategory,
} from "./categories";
import { routeOf, screenLabelFor } from "./screen-labels";

const ICONS: Record<FeedbackCategory, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  bug: Bug,
  idea: Lightbulb,
  other: MessageCircleMore,
};

const SENT = "Comentario enviado";
const QUEUED = "Comentario guardado. Se va a enviar automáticamente cuando vuelva la conexión.";
const STORE_ERROR = "No se pudo guardar el comentario. Intentá de nuevo.";
const NEAR_LIMIT = 1800;

export function FeedbackDialog({
  open,
  onOpenChange,
  author,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  author: { username: string; roleLabel: string };
}) {
  const router = useRouter();
  const { addToast } = useToast();
  const route = routeOf(usePathname());
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [text, setText] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryMissing = attempted && category === null;
  const textMissing = attempted && text.trim() === "";

  // Every way out goes through here, so the next open starts empty.
  function close() {
    setCategory(null);
    setText("");
    setAttempted(false);
    setError(null);
    onOpenChange(false);
  }

  async function send() {
    setAttempted(true);
    if (category === null || text.trim() === "") return;
    setSending(true);
    setError(null);
    let outcome: "delivered" | "queued";
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, text, route }),
      });
      if (!response.ok) {
        const body = response.status === 400 ? await response.json().catch(() => null) : null;
        setError(body?.errors?.text ?? body?.errors?.category ?? body?.errors?.form ?? STORE_ERROR);
        return;
      }
      // A 2xx means the row is stored; an unreadable body must not read as a failure, or a retry duplicates it.
      const body = await response.json().catch(() => null);
      outcome = body?.outcome === "delivered" ? "delivered" : "queued";
    } catch {
      // `fetch` rejects on a network failure; the LAN server is the only thing reached here.
      setError(CONNECTION_ERROR);
      return;
    } finally {
      setSending(false);
    }

    // ABOVE the refresh, BELOW the try/catch: a refresh that throws must not
    // retract the only confirmation of a comment the server already stored.
    close();
    addToast(outcome === "delivered" ? "success" : "info", outcome === "delivered" ? SENT : QUEUED);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (sending) return;
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPopup className="max-sm:items-end max-sm:p-0">
          <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl bg-popover p-6 text-popover-foreground shadow-2xl max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-3xl max-sm:px-4 max-sm:pt-3 max-sm:pb-6">
            <span aria-hidden="true" className="mx-auto hidden h-1 w-10 rounded-full bg-border max-sm:block" />
            <div className="pr-10">
              <DialogTitle>Enviar comentario</DialogTitle>
              <DialogDescription className="mt-1">Contale al equipo de soporte qué anda mal o qué mejorarías.</DialogDescription>
            </div>
            <DialogClose
              disabled={sending}
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Cerrar"
                  className="absolute top-3 right-3 pointer-coarse:min-h-11 pointer-coarse:min-w-11 max-sm:top-4"
                />
              }
            >
              <X aria-hidden />
            </DialogClose>

            <fieldset className="min-w-0 border-0 p-0">
              <legend className="mb-2 text-sm font-medium">¿Qué querés contarnos?</legend>
              <div className="grid grid-cols-3 gap-2">
                {FEEDBACK_CATEGORIES.map((id) => {
                  const Icon = ICONS[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={category === id}
                      disabled={sending}
                      onClick={() => setCategory(id)}
                      className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-1.5 rounded-xl border border-input bg-background px-1.5 py-2.5 text-center text-sm leading-tight font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:ring-1 aria-pressed:ring-primary"
                    >
                      <Icon aria-hidden className="size-5 text-muted-foreground" />
                      <span>{FEEDBACK_CATEGORY_LABELS[id]}</span>
                    </button>
                  );
                })}
              </div>
              {categoryMissing && <p className="mt-1.5 text-[13px] text-destructive">Elegí qué querés contarnos.</p>}
            </fieldset>

            <div>
              <label htmlFor="feedback-text" className="mb-2 block text-sm font-medium">
                Comentario
              </label>
              <textarea
                id="feedback-text"
                value={text}
                maxLength={FEEDBACK_MAX_LENGTH}
                disabled={sending}
                placeholder={FEEDBACK_PLACEHOLDERS[category ?? "bug"]}
                aria-invalid={textMissing}
                aria-describedby="feedback-meta"
                onChange={(e) => setText(e.target.value)}
                className="min-h-32 w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
              />
              <div id="feedback-meta" className="mt-1.5 flex justify-between gap-3 text-[13px]">
                {textMissing && <p className="text-destructive">Escribí tu comentario antes de enviarlo.</p>}
                <span
                  aria-live="polite"
                  className={`ml-auto whitespace-nowrap tabular-nums ${
                    text.length >= NEAR_LIMIT ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"
                  }`}
                >
                  {text.length} / {FEEDBACK_MAX_LENGTH}
                </span>
              </div>
            </div>

            <div className="grid gap-1.5 rounded-lg bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
              <p className="flex items-start gap-2">
                <Monitor aria-hidden className="mt-px size-3.5 shrink-0" />
                <span>
                  Pantalla: <b className="font-medium text-foreground">{screenLabelFor(route)}</b>
                </span>
              </p>
              <p className="flex items-start gap-2">
                <User aria-hidden className="mt-px size-3.5 shrink-0" />
                <span>
                  Se envía al equipo de soporte como <b className="font-medium text-foreground">{author.username}</b> ({author.roleLabel})
                </span>
              </p>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={sending} onClick={close} className="min-h-11 min-w-11 max-sm:w-full">
                Cancelar
              </Button>
              <Button type="button" disabled={sending} onClick={send} className="min-h-11 min-w-11 max-sm:w-full">
                {sending ? (
                  <>
                    <Loader2 aria-hidden className="animate-spin" />
                    Enviando…
                  </>
                ) : (
                  "Enviar"
                )}
              </Button>
            </div>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
