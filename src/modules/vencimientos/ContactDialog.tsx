"use client";

import { useId, useState } from "react";
import { Mail, MessageCircle, Phone, XIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ContactadoButton } from "./ContactadoButton";
import { describeDue } from "./display";
import type { VencimientoKind } from "./due";
import { buildContactMessage, parsePrice, waMeUrl } from "./message";

/**
 * The explicit allowlist of design.md "Dialog props". Opt-out is already
 * resolved to `waBlockedReason` and the phone to `waPhone` (wa.me digits) on
 * the server, so neither opt-out flag, the raw stored phone, nor any other
 * `cliente`/`vehiculo`/`workshop_config` column reaches this client component.
 */
export type ContactDialogProps = {
  vehiculoId: string;
  kind: VencimientoKind;
  periodKey: string;
  overdue: boolean;
  customerName: string;
  placa: string;
  /** "make model", or null when the vehicle has neither. */
  vehicleLabel: string | null;
  waPhone: string | null;
  waBlockedReason: string | null;
  workshop: { name: string | null; phone: string | null; hours: string | null; address: string | null };
};

/**
 * "Contactar": the row action of /vencimientos. Opening WhatsApp is a plain link
 * (no request, no toast, nothing marked) — it needs no secure-context API, and
 * the workshop reaches this app over plain HTTP on a LAN. Only "Marcar como
 * contactado" writes, through the same `ContactadoButton` the plain list had.
 */
export function ContactDialog(props: ContactDialogProps) {
  const { vehiculoId, kind, periodKey, overdue, customerName, placa, vehicleLabel, waPhone, waBlockedReason, workshop } = props;
  const [priceText, setPriceText] = useState("");
  const priceId = useId();

  const message = buildContactMessage({
    workshop,
    customerName,
    vehicle: { label: vehicleLabel, plate: placa },
    item: { kind, periodKey, overdue },
    price: parsePrice(priceText),
  });
  const { when } = describeDue({ kind, periodKey, state: overdue ? "overdue" : "due", daysLeft: null }, "");

  return (
    <Dialog>
      {/* 44x44: `size="default"` is h-8, and this is a tablet screen. */}
      <DialogTrigger render={<Button type="button" variant="outline" className="min-h-11 min-w-11" />}>
        <Phone aria-hidden="true" />
        Contactar
      </DialogTrigger>
      <DialogPortal>
        <DialogOverlay />
        {/* Phone: full width, pinned to the bottom (mockup panel 4). */}
        <DialogPopup className="max-sm:items-end max-sm:p-0">
          <div
            data-slot="dialog-content"
            className="relative flex max-h-[85vh] w-full max-w-lg flex-col gap-5 rounded-xl bg-background p-6 shadow-2xl max-sm:max-w-none max-sm:rounded-b-none max-sm:p-4 max-sm:pb-6"
          >
            <DialogHeader className="pr-10">
              <DialogTitle>Contactar a {customerName}</DialogTitle>
              <DialogDescription>
                {when} · {vehicleLabel ?? "vehículo"} ({placa})
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="flex flex-col gap-5">
              <div className="grid gap-2">
                <label htmlFor={priceId} className="text-sm font-medium">
                  Precio (opcional)
                </label>
                <div className="flex min-h-11 items-center rounded-lg border border-input text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                  <span className="flex h-full items-center self-stretch border-r bg-muted px-3 text-muted-foreground">B/.</span>
                  <input
                    id={priceId}
                    inputMode="decimal"
                    autoComplete="off"
                    value={priceText}
                    onChange={(event) => setPriceText(event.target.value)}
                    className="h-full min-h-11 w-full bg-transparent px-3 tabular-nums outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <span className="text-sm font-medium">Mensaje</span>
                <div data-testid="contact-preview" className="rounded-lg border bg-muted/60 p-3 text-sm leading-relaxed">
                  {message}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap max-sm:*:w-full">
                  {waPhone ? (
                    <a
                      href={waMeUrl(waPhone, message)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(buttonVariants(), "min-h-11 min-w-11")}
                    >
                      <MessageCircle aria-hidden="true" />
                      WhatsApp
                    </a>
                  ) : (
                    <Button type="button" disabled className="min-h-11 min-w-11">
                      <MessageCircle aria-hidden="true" />
                      WhatsApp
                    </Button>
                  )}
                  <Button type="button" variant="outline" disabled className="min-h-11 min-w-11">
                    <Mail aria-hidden="true" />
                    Correo
                    <span className="rounded-full border bg-muted px-1.5 text-[10px] text-muted-foreground">Próximamente</span>
                  </Button>
                  <ContactadoButton vehiculoId={vehiculoId} kind={kind} periodKey={periodKey} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {waPhone ? "Abrir WhatsApp no marca el vencimiento como contactado." : waBlockedReason}
                </p>
              </div>
            </DialogBody>

            <DialogClose
              render={<Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2 min-h-11 min-w-11" />}
            >
              <XIcon aria-hidden="true" />
              <span className="sr-only">Cerrar</span>
            </DialogClose>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
