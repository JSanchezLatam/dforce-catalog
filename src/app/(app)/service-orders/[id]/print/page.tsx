import Link from "next/link";
import { notFound } from "next/navigation";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { getClienteById } from "@/modules/customers/queries";
import { getWorkshopConfig } from "@/modules/workshop-config/service";
import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";
import { PrintButton } from "@/modules/service-orders/PrintButton";
import { getOrdenServicioById } from "@/modules/service-orders/queries";
import { formatDateTime } from "@/shared/datetime";

export const dynamic = "force-dynamic";

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
      <dd className="text-sm">{value == null || value === "" ? "—" : String(value)}</dd>
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

  // `bg-white`/`text-black` below are unconditional rather than `print:`-scoped,
  // and that is deliberate on screen too: this route is reachable before anyone
  // hits Imprimir, and a sheet that changes color between preview and paper is
  // worse than one that always looks like paper. Checked in the browser in dark
  // mode — it reads as a white page inside the dark shell, which is the intent.
  // AGENTS.md says read `globals.css` before changing a color; this steps
  // outside the theme on purpose rather than extending it.
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-black print:max-w-none print:p-0">
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
        </div>
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-x-8">
        {field("Cliente", clienteDetail?.cliente.name ?? orden.clienteId)}
        {field("Teléfono", clienteDetail?.cliente.phone)}
        {field("Placa", vehiculo?.plate ?? orden.vehiculoId)}
        {field("Marca", vehiculo?.make)}
        {field("Modelo", vehiculo?.model)}
        {field("Año", vehiculo?.year)}
        {field("Categoría", CATEGORIA_LABEL[orden.categoria])}
        {field("Fecha y hora de inicio", formatDateTime(orden.appointmentAt))}
      </dl>

      <dl className="mb-6">
        {field("Descripción", orden.description)}
        {field("Observaciones", orden.observaciones)}
      </dl>

      {/* D9 — space for a pen. No column, no field, no state behind it, and
          deliberately NOT filled from `hallazgos`/`recomendaciones`: doing so
          would fill the block on a reprint of a worked order, and the block
          being unconditionally empty is the whole point. Transcribing the
          handwriting back into `hallazgos` is a proposal follow-up. */}
      <section className="border border-black p-3">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">Trabajo realizado / Hallazgos</h2>
        <div aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-7 border-b border-black/30" />
          ))}
        </div>
      </section>

      <div className="mt-12 flex justify-end">
        <div className="w-72 border-t border-black pt-1 text-center text-xs">Firma del técnico</div>
      </div>
    </div>
  );
}
