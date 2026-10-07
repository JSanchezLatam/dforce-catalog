/**
 * Strict, hand-rolled validation of the ingest body against the wire contract.
 * Every object level is checked for EXACTLY its whitelisted keys: the output is
 * rebuilt field by field, so nothing unvalidated can reach the database.
 */
import type { IngestBody, PortalOrder, PortalVehicle } from "../contract";

export type ParseResult = { ok: true; body: IngestBody } | { ok: false };

type Obj = Record<string, unknown>;

const STATUSES: ReadonlySet<unknown> = new Set(["Recibida", "En proceso", "Terminada", "Cancelada"]);

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const hasExactKeys = (o: Obj, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const version = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

const ORDER_KEYS = [
  "id", "status", "categoria", "createdAt", "appointmentAt", "completedAt",
  "description", "hallazgos", "recomendaciones",
];
const VEHICLE_KEYS = ["id", "plate", "make", "model", "year", "orders"];

function order(o: unknown): PortalOrder | null {
  if (!isObj(o) || !hasExactKeys(o, ORDER_KEYS)) return null;
  if (!str(o.id) || !STATUSES.has(o.status) || !str(o.categoria) || !str(o.createdAt)) return null;
  if (!strOrNull(o.appointmentAt) || !strOrNull(o.completedAt)) return null;
  if (!strOrNull(o.description) || !strOrNull(o.hallazgos) || !strOrNull(o.recomendaciones)) return null;
  return {
    id: o.id,
    status: o.status as PortalOrder["status"],
    categoria: o.categoria,
    createdAt: o.createdAt,
    appointmentAt: o.appointmentAt,
    completedAt: o.completedAt,
    description: o.description,
    hallazgos: o.hallazgos,
    recomendaciones: o.recomendaciones,
  };
}

function vehicle(v: unknown): PortalVehicle | null {
  if (!isObj(v) || !hasExactKeys(v, VEHICLE_KEYS)) return null;
  if (!str(v.id) || !str(v.plate) || !strOrNull(v.make) || !strOrNull(v.model)) return null;
  if (v.year !== null && !(typeof v.year === "number" && Number.isInteger(v.year))) return null;
  if (!Array.isArray(v.orders)) return null;
  const orders = v.orders.map(order);
  if (orders.some((o) => o === null)) return null;
  return { id: v.id, plate: v.plate, make: v.make, model: v.model, year: v.year, orders: orders as PortalOrder[] };
}

function build(b: Obj): IngestBody | null {
  if (b.kind === "upsert" && hasExactKeys(b, ["kind", "clienteId", "version", "tokenHash", "generatedAt", "vehicles"])) {
    if (!str(b.clienteId) || !version(b.version) || !str(b.tokenHash) || !str(b.generatedAt)) return null;
    if (!Array.isArray(b.vehicles)) return null;
    const vehicles = b.vehicles.map(vehicle);
    if (vehicles.some((v) => v === null)) return null;
    return {
      kind: "upsert",
      clienteId: b.clienteId,
      version: b.version,
      tokenHash: b.tokenHash,
      generatedAt: b.generatedAt,
      vehicles: vehicles as PortalVehicle[],
    };
  }
  if (b.kind === "delete" && hasExactKeys(b, ["kind", "clienteId", "version"])) {
    if (!str(b.clienteId) || !version(b.version)) return null;
    return { kind: "delete", clienteId: b.clienteId, version: b.version };
  }
  if (b.kind === "reconcile" && hasExactKeys(b, ["kind", "liveClienteIds", "maxVersion"])) {
    if (!Array.isArray(b.liveClienteIds) || !b.liveClienteIds.every(str) || !version(b.maxVersion)) return null;
    return { kind: "reconcile", liveClienteIds: b.liveClienteIds, maxVersion: b.maxVersion };
  }
  return null;
}

export function parseIngest(raw: unknown): ParseResult {
  const body = isObj(raw) ? build(raw) : null;
  return body ? { ok: true, body } : { ok: false };
}
