import type { PortalOrder, PortalVehicle } from "../../src/contract";

// Type-only import: contract.ts pulls node:crypto and must never reach the client bundle.
export type Snapshot = { vehicles: PortalVehicle[]; generatedAt: string };

const zone = { timeZone: "America/Panama" } as const;
const dateFmt = new Intl.DateTimeFormat("es-PA", { day: "numeric", month: "long", year: "numeric", ...zone });
const dateTimeFmt = new Intl.DateTimeFormat("es-PA", {
  day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", ...zone,
});
const date = (iso: string) => dateFmt.format(new Date(iso));
const dateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

const newestFirst = (orders: PortalOrder[]) =>
  [...orders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

// `.wrap` lets a long unbroken finding fold instead of scrolling the page sideways.
function Field({ label, children }: { label: string; children: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="wrap">{children}</dd>
    </>
  );
}

function Order({ order }: { order: PortalOrder }) {
  return (
    <li className="order">
      <div className="order-head">
        <span className="chip" data-status={order.status}>{order.status}</span>
        <span className="wrap">{order.categoria}</span>
      </div>
      <p className="muted small wrap">N.º {order.id}</p>
      <dl>
        <Field label="Ingreso">{date(order.createdAt)}</Field>
        {order.appointmentAt && <Field label="Cita">{dateTime(order.appointmentAt)}</Field>}
        {order.completedAt && <Field label="Finalización">{date(order.completedAt)}</Field>}
        {order.description && <Field label="Descripción">{order.description}</Field>}
        {order.hallazgos && <Field label="Hallazgos">{order.hallazgos}</Field>}
        {order.recomendaciones && <Field label="Recomendaciones">{order.recomendaciones}</Field>}
      </dl>
    </li>
  );
}

export function History({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="history">
      <h1 className="title">Historial de servicio</h1>
      <p className="muted small">Actualizado: {dateTime(snapshot.generatedAt)}</p>
      {snapshot.vehicles.length === 0 && <p>Todavía no hay órdenes de servicio para mostrar.</p>}
      {snapshot.vehicles.map((v) => {
        const spec = [[v.make, v.model].filter(Boolean).join(" "), v.year].filter(Boolean).join(" · ");
        return (
          <section key={v.id} aria-labelledby={`veh-${v.id}`} className="vehicle">
            <h2 id={`veh-${v.id}`} className="plate">{v.plate}</h2>
            {spec && <p className="muted">{spec}</p>}
            {v.orders.length === 0 ? (
              <p className="muted">Sin órdenes todavía.</p>
            ) : (
              <ol className="orders">
                {newestFirst(v.orders).map((o) => (
                  <Order key={o.id} order={o} />
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
