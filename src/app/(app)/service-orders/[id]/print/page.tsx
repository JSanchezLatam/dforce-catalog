import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { getClienteById } from "@/modules/customers/queries";
import { getWorkshopConfig } from "@/modules/workshop-config/service";
import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";
import { vehicleDescriptiveRows } from "@/modules/service-orders/vehicle-rows";
import { FUEL_LABEL, formatKilometraje } from "@/modules/service-orders/intake";
import { listOrderPhotos } from "@/modules/service-orders/photos";
import { PrintButton } from "@/modules/service-orders/PrintButton";
import { getOrdenServicioById } from "@/modules/service-orders/queries";
import { formatDateTime } from "@/shared/datetime";

const PHOTOS_PER_PAGE = 4;

export const dynamic = "force-dynamic";

/** Blank to a reader: `null`, `""`, and the `"\n"` a tabbed-through textarea
 *  leaves behind. `ServiceOrderForm` trims to `null`, but `PATCH` takes any
 *  string, so the sheet cannot assume the column is already normalised. */
function hasText(value: string | null | undefined): value is string {
  return value != null && value.trim() !== "";
}

/**
 * Always renders, unlike the detail page's `field()` which bails on an empty
 * value: a printed form with a missing row reads as a different form, and the
 * técnico needs to see that the box is empty rather than absent.
 */
function field(label: string, value: unknown) {
  return (
    <div className="border-b border-black/40 py-1">
      {/* Red, not grey. This is the sheet a técnico scans on a bench: the
          labels are the landmarks, and `print:` is deliberately NOT used —
          the colour must be the same on screen and on paper, for the same
          reason `bg-white` is unconditional. `text-red-700` prints as a real
          red on a monochrome-safe ink rather than the theme's `destructive`,
          which is tuned for a dark UI and means "error". */}
      <dt className="text-[10px] uppercase tracking-wide text-red-700">{label}</dt>
      {/* `whitespace-pre-wrap break-words`: several of these rows carry free
          text a técnico typed — `Descripción`, `Observaciones`, and now
          `Hallazgos`/`Recomendaciones`. Without the first, their line breaks
          collapse into one paragraph on paper; without the second, a long
          unbroken token (a part number, a URL) runs off the right edge of the
          sheet instead of wrapping. Harmless on the short rows above. */}
      <dd className="text-sm whitespace-pre-wrap break-words">
        {value == null || String(value).trim() === "" ? "—" : String(value)}
      </dd>
    </div>
  );
}

/**
 * WU3 — the printed work order (design D8/D9, spec §"Printable Work Order").
 *
 * A DEDICATED route rather than `@media print` overrides on the detail page,
 * so it is default-EMPTY: only what is authored here reaches the paper, and
 * every card the detail page grows later cannot land on a técnico's sheet by
 * accident (D8).
 *
 * It reuses `getOrdenServicioById` + `getClienteById` — verified against
 * `[id]/page.tsx`, which makes exactly these two calls and resolves the
 * vehicle the same way. This unit adds no SQL.
 *
 * Everything inside the page styles itself with Tailwind's `print:` variant.
 * The one thing it cannot reach is the `(app)` layout's `AppSidebar`, a
 * sibling — that is hidden by the `@media print` block in `globals.css`, the
 * only global CSS this change adds.
 */
export default async function ServiceOrderPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSessionFromHeaders();
  if (!can(user, "service-orders.read")) {
    return <div className="p-8"><p className="text-sm text-foreground">No tenés permiso para ver esta página.</p></div>;
  }

  const detail = await getOrdenServicioById(id);
  if (!detail) notFound();

  const { orden } = detail;
  const clienteDetail = await getClienteById(orden.clienteId);
  // C4 — `getClienteById` reads vehicles with `includeInactive: true`, so a
  // DEACTIVATED vehicle is still found here and its identity still prints.
  // Same resolution as `[id]/page.tsx`.
  const vehiculo = clienteDetail?.vehicles.find((v) => v.id === orden.vehiculoId);
  // A third read, and the first this route adds. The catalog PDF already
  // consumes the same singleton, so the sheet says whose workshop it is
  // without a new table, a new route, or a new upload path.
  const workshop = await getWorkshopConfig();
  // Either column counts: one filled and one empty still means the order was
  // worked, and the block below prints both rows rather than half a form.
  const photos = await listOrderPhotos(orden.id);
  // Explicit chunks of 4, one sheet each: a single CSS grid fragments
  // unpredictably across pages in Chrome.
  const photoPages = Array.from({ length: Math.ceil(photos.length / PHOTOS_PER_PAGE) }, (_, i) =>
    photos.slice(i * PHOTOS_PER_PAGE, (i + 1) * PHOTOS_PER_PAGE),
  );
  const recorded = hasText(orden.hallazgos) || hasText(orden.recomendaciones);

  // `bg-white`/`text-black` below are unconditional rather than `print:`-scoped,
  // and that is deliberate on screen too: this route is reachable before anyone
  // hits Imprimir, and a sheet that changes color between preview and paper is
  // worse than one that always looks like paper. Checked in the browser in dark
  // mode — it reads as a white page inside the dark shell, which is the intent.
  // AGENTS.md says read `globals.css` before changing a color; this steps
  // outside the theme on purpose rather than extending it.
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-black print:w-full print:max-w-full print:p-0">
      <div className="mb-6 flex items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div className="flex items-center gap-3">
          {/* The same singleton the catalog PDF reads, through the same route
              that serves it. Both columns are nullable — the Administrador may
              set a name with no logo or neither — so each renders only when it
              is there, and a missing logo leaves no broken image. */}
          {workshop?.logoR2Key ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src="/api/workshop-config/logo"
              alt={workshop.name ?? "Logo del taller"}
              className="h-12 w-auto object-contain"
            />
          ) : null}
          <div>
            {workshop?.name ? <p className="text-sm font-semibold">{workshop.name}</p> : null}
            <h1 className="text-xl font-bold">Orden de servicio</h1>
            <p className="text-xs text-black/60">N.º {orden.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* A sheet with no way back was a dead end: the only control on it
              was Imprimir. `print:hidden` for the same reason PrintButton
              carries it — on paper it is noise. */}
          <Link
            href={`/service-orders/${orden.id}`}
            className="min-h-11 min-w-11 inline-flex items-center rounded-md border border-black/30 px-3 text-sm print:hidden"
          >
            Volver
          </Link>
          <PrintButton />
          {/* Reserved for a future QR code: blank, no border, no text. In flow
              on paper only (~25 mm); the buttons above stay screen-only. */}
          <div aria-hidden="true" className="hidden print:block size-[25mm]" />
        </div>
      </div>

      {/* Four columns, not two: the vehicle details added five rows, and at two
          columns they cost ~200 characters of Hallazgos before the signature
          jumped to page 2. Four keeps the block at its old four-row height —
          measured in the print preview, 2026-10-04 (900 chars still fit). */}
      <dl className="mb-6 grid grid-cols-4 gap-x-5">
        {field("Cliente", clienteDetail?.cliente.name ?? orden.clienteId)}
        {field("Teléfono", clienteDetail?.cliente.phone)}
        {hasText(clienteDetail?.cliente.documentoIdentidad) && field("Cédula / RUC", clienteDetail?.cliente.documentoIdentidad)}
        {field("Placa", vehiculo?.plate ?? orden.vehiculoId)}
        {field("Marca", vehiculo?.make)}
        {field("Modelo", vehiculo?.model)}
        {field("Año", vehiculo?.year)}
        {/* Same grid, same always-render rule as the rows above: an unset
            field prints "—". Only the unit number is conditional. */}
        {vehiculo && vehicleDescriptiveRows(vehiculo).map((r) => (
          <Fragment key={r.label}>{field(r.label, r.value)}</Fragment>
        ))}
        {field("Categoría", CATEGORIA_LABEL[orden.categoria])}
        {field("Fecha y hora de inicio", formatDateTime(orden.appointmentAt))}
        {field("Kilometraje", orden.kilometraje == null ? null : formatKilometraje(orden.kilometraje))}
        {orden.nivelCombustible != null && field("Combustible", FUEL_LABEL[orden.nivelCombustible])}
        {orden.bateriaPct != null && field("Batería", `${orden.bateriaPct} %`)}
      </dl>

      <dl className="mb-6">
        {field("Descripción", orden.description)}
        {field("Observaciones", orden.observaciones)}
      </dl>

      {/* D9, revised twice, and this is what the owner actually asked for after
          printing a worked order: what was recorded prints AND ruled lines
          follow it. Not one or the other. He wants somewhere to write on the
          sheet after it comes out of the printer, whatever is already on it.

          The two earlier positions are both dead, and are recorded here only
          so neither gets re-derived. D9 kept the block unconditionally blank
          so a reprint could never arrive pre-filled; on 2026-09-12 the owner
          reversed that, and the implementation then swung to the other
          extreme, dropping the lines wherever content printed on the theory
          that ruled lines under findings "invite a second handwritten set
          nobody transcribes". That theory was ours, not the owner's, who has used the
          sheet and wants the pen space regardless.

          So both columns print under their own labels — `hallazgos` is what
          was found, `recomendaciones` is what the customer should do next, and
          merging them loses that — with the absent one keeping its row and its
          "—", for `field`'s own reason a hundred lines up: a printed form with
          a MISSING row reads as a different form.

          FOUR lines after content, eight when nothing was recorded. The page
          decides that, not taste. Letter at `@page { margin: 12mm }` leaves
          roughly 965px of printable height; everything on this sheet other
          than the block's inner content is about 530px, and the two printed
          rows take ~86px more at one line each. Four `h-7` rows (112px) leave
          ~240px of slack — around eleven more wrapped lines of findings before
          the signature line is pushed onto a second sheet. Eight rows would
          leave ~125px, about six, and a técnico's hallazgos run long. A
          two-page work order is the regression this number exists to avoid.
          Nothing in jsdom measures any of this: it is a print-preview check. */}
      <section className="border border-black p-3">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">Trabajo realizado / Hallazgos</h2>
        {recorded ? (
          <dl className="mb-2">
            {field("Hallazgos", orden.hallazgos)}
            {field("Recomendaciones", orden.recomendaciones)}
          </dl>
        ) : null}
        <div aria-hidden="true">
          {Array.from({ length: recorded ? 4 : 8 }, (_, i) => (
            <div key={i} className="h-7 border-b border-black/30" />
          ))}
        </div>
      </section>

      <div className="mt-12 flex justify-end">
        <div className="w-72 border-t border-black pt-1 text-center text-xs">Firma del técnico</div>
      </div>

      {/* Page 2+: after the signature, so page 1 is untouched. Each chunk is its
          own sheet; `h-[105mm]` x 2 rows plus the heading fits Letter at 12mm
          margins (print preview owns the real measurement). `object-contain`
          lets a portrait and a landscape photo both fit the same cell. */}
      {photoPages.map((page, pageIndex) => (
        <section key={pageIndex} className="break-before-page">
          <h2 className="mb-4 border-b-2 border-black pb-2 text-lg font-bold">
            Fotos de recepción — Orden N.º {orden.id}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {page.map((photo, i) => {
              const number = pageIndex * PHOTOS_PER_PAGE + i + 1;
              return (
                <figure key={photo.id} className="flex flex-col gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/service-orders/${orden.id}/photos/${photo.id}`}
                    alt={`Foto de recepción ${number}`}
                    loading="eager"
                    className="h-[105mm] w-full object-contain"
                  />
                  <figcaption className="text-[10px]">Foto {number}</figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
