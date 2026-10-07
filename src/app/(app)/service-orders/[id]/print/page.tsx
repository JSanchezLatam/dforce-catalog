import { Fragment } from "react";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import Link from "next/link";
import { notFound } from "next/navigation";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { orderScope } from "@/modules/service-orders/scope";
import { currentConsent } from "@/modules/customers/consent";
import { CONSENT_CLAUSE_BANNER, CONSENT_CLAUSE_PARAGRAPHS, SHOW_CONSENT_CLAUSE } from "@/modules/customers/consent-clause";
import { getClienteById } from "@/modules/customers/queries";
import { getWorkshopConfig } from "@/modules/workshop-config/service";
import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";
import { vehicleDescriptiveRows } from "@/modules/service-orders/vehicle-rows";
import { FUEL_LABEL, formatKilometraje } from "@/modules/service-orders/intake";
import { listOrderPhotos } from "@/modules/service-orders/photos";
import { PrintButton } from "@/modules/service-orders/PrintButton";
import { renderQrSvg } from "@/modules/service-orders/qr";
import { getOrdenServicioById } from "@/modules/service-orders/queries";
import { env } from "@/shared/config/env";
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

/** The Ley 81 clause, small enough to ride beside the signature lines instead of costing the findings block its room. */
function ConsentClause() {
  return (
    <div data-testid="consent-clause" className="flex-1 text-[9px] leading-tight text-black/80">
      <p className="font-semibold">{CONSENT_CLAUSE_BANNER}</p>
      {CONSENT_CLAUSE_PARAGRAPHS.map((paragraph) => (
        <p key={paragraph} className="mt-0.5">
          {paragraph}
        </p>
      ))}
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ copia?: string | string[] }>;
}) {
  const { id } = await params;
  const user = await requireSessionFromHeaders();
  const scope = orderScope(user);
  if (!can(user, "service-orders.read")) {
    return <PermissionDenied title="Orden de servicio" />;
  }

  const detail = await getOrdenServicioById(id, scope);
  if (!detail) notFound();

  const { orden } = detail;
  const clienteDetail = await getClienteById(orden.clienteId, scope);
  // C4 — `getClienteById` reads vehicles with `includeInactive: true`, so a
  // DEACTIVATED vehicle is still found here and its identity still prints.
  // Same resolution as `[id]/page.tsx`.
  const vehiculo = clienteDetail?.vehicles.find((v) => v.id === orden.vehiculoId);
  // A third read, and the first this route adds. The catalog PDF already
  // consumes the same singleton, so the sheet says whose workshop it is
  // without a new table, a new route, or a new upload path.
  const workshop = await getWorkshopConfig();
  // customer-portal WU2: `?copia=cliente` is the sheet the customer takes home.
  // Anything else (including a repeated key's later values) is the workshop copy.
  const copia = (await searchParams)?.copia;
  const isClientCopy = (Array.isArray(copia) ? copia[0] : copia) === "cliente";
  const consented = (await currentConsent(orden.clienteId))?.granted === true;
  // The QR prints only when ALL four hold (spec "Customer Copy With Portal QR").
  // The token is read from the server-side row and leaves this function only as
  // the modules of an SVG: never as text, an attribute or a client prop.
  const portalToken = clienteDetail?.cliente.portalToken;
  const portalBase = env.PORTAL_BASE_URL?.trim().replace(/\/+$/, "");
  // No QR while the sync is off: nothing would reach the portal, so a scan
  // could only ever open the "Este enlace no es válido" page.
  const syncConfigured = Boolean(env.PORTAL_INGEST_URL && env.PORTAL_INGEST_SECRET);
  const portalUrl =
    consented && portalToken && portalBase && syncConfigured && !clienteDetail?.cliente.deactivatedAt
      ? `${portalBase}/c#${portalToken}`
      : null;
  const qrSvg = isClientCopy && portalUrl ? await renderQrSvg(portalUrl) : null;
  // Either column counts: one filled and one empty still means the order was
  // worked, and the block below prints both rows rather than half a form.
  const photos = isClientCopy ? [] : await listOrderPhotos(orden.id, scope);
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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div className="flex items-center gap-3">
          {/* The same singleton the catalog PDF reads, through the same route
              that serves it. Both columns are nullable — the Administrador may
              set a name with no logo or neither — so each renders only when it
              is there, and a missing logo leaves no broken image. */}
          {workshop?.logoR2Key ? (
            <>
              {/* ponytail: the logo is a JPEG on solid black, which on paper is
                  a black box, and the catalog's `mixBlendMode: "screen"` only
                  works on a dark page. This maps luminance to alpha
                  (a = 15(r+g+b) - 0.6): only near-black goes transparent, so the
                  car and lettering stay solid (a gentler 2x slope washed the
                  dark artwork out on paper, 2026-10-07). It ASSUMES a logo on a dark background — dark
                  artwork on a light or transparent one would fade out. Upgrade
                  path: process the uploaded image server-side. A CSS filter is
                  an effect, not a background, so print keeps it regardless of
                  the "background graphics" setting. */}
              <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
                <filter id="logo-knockout" colorInterpolationFilters="sRGB">
                  <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  15 15 15 0 -0.6" />
                </filter>
              </svg>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/api/workshop-config/logo"
                alt={workshop.name ?? "Logo del taller"}
                className="h-12 w-auto object-contain"
                style={{ filter: "url(#logo-knockout)" }}
              />
            </>
          ) : null}
          <div>
            {workshop?.name ? <p className="text-sm font-semibold">{workshop.name}</p> : null}
            <h1 className="text-xl font-bold">{isClientCopy ? "Copia del cliente" : "Orden de servicio"}</h1>
            <p className="text-xs text-black/60">N.º {orden.id}</p>
          </div>
        </div>
        {/* `flex-wrap`: at a phone width Volver + Imprimir + Copia del cliente (+ the
            notice and QR on the customer copy) overflow one row. Paper never
            wraps: the buttons are `print:hidden` and the rest fits Letter. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          {/* Offered only when the customer copy would actually carry a QR, so
              the control never leads to a sheet with nothing to scan. */}
          {portalUrl && !isClientCopy ? (
            <Link
              href={`/service-orders/${orden.id}/print?copia=cliente`}
              className="min-h-11 min-w-11 inline-flex items-center rounded-md border border-black/30 px-3 text-sm print:hidden"
            >
              Copia del cliente
            </Link>
          ) : null}
          {qrSvg ? (
            <>
              <p className="max-w-[45mm] text-right text-[10px] leading-tight">
                Este código da acceso a tu historial. No lo compartas.
              </p>
              {/* The 25 mm slot, filled. `qrSvg` is the qrcode library's own
                  output: path data only, no text and no token. */}
              <div
                role="img"
                aria-label="Código QR del portal del cliente"
                className="size-[25mm] [&>svg]:size-full"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            </>
          ) : (
            /* Blank, no border, no text: in flow on paper only (~25 mm). The
               workshop copy never prints the QR, and neither does a customer
               copy whose QR is withheld; the buttons above stay screen-only. */
            <div aria-hidden="true" className="hidden print:block size-[25mm]" />
          )}
        </div>
      </div>

      {/* Four columns, not two: the vehicle details added five rows, and at two
          columns they cost ~200 characters of Hallazgos before the signature
          jumped to page 2. Four keeps the block at its old four-row height —
          measured in the print preview, 2026-10-04 (900 chars still fit). */}
      {isClientCopy ? (
        /* The customer's paper: who, which car, what for and when. No phone,
           no cédula, no unit internals: a customer-facing sheet that is
           handed out and may be lost carries the least that identifies the job. */
        <dl className="mb-6 grid grid-cols-4 gap-x-5">
          {field("Cliente", clienteDetail?.cliente.name ?? orden.clienteId)}
          {field("Placa", vehiculo?.plate ?? orden.vehiculoId)}
          {field("Marca", vehiculo?.make)}
          {field("Modelo", vehiculo?.model)}
          {field("Año", vehiculo?.year)}
          {field("Categoría", CATEGORIA_LABEL[orden.categoria])}
          {field("Fecha y hora de inicio", formatDateTime(orden.appointmentAt))}
        </dl>
      ) : (
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
      )}

      <dl className="mb-6">
        {field("Descripción", orden.description)}
        {!isClientCopy && field("Observaciones", orden.observaciones)}
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
      {!isClientCopy && (
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
      )}

      {/* Customer copy: no signature block at all (the workshop keeps the signed
          sheet). Workshop copy of a consented customer: the clause rides BESIDE
          the two signature lines rather than above them, so page 1 pays for one
          extra line, not for the clause's height as well. */}
      {isClientCopy ? (
        consented && SHOW_CONSENT_CLAUSE && (
          <div className="mt-6 flex">
            <ConsentClause />
          </div>
        )
      ) : (
        <div className={consented && SHOW_CONSENT_CLAUSE ? "mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6" : "mt-12 flex justify-end"}>
          {consented && SHOW_CONSENT_CLAUSE && <ConsentClause />}
          <div className="w-72 max-w-full shrink-0">
            {consented && <div className="mb-8 border-t border-black pt-1 text-center text-xs">Firma del cliente</div>}
            <div className="border-t border-black pt-1 text-center text-xs">Firma del técnico</div>
          </div>
        </div>
      )}

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
