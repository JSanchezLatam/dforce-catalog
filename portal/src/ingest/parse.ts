/**
 * Strict, hand-rolled validation of the ingest body against the wire contract.
 * Every object level is checked for EXACTLY its whitelisted keys: the output is
 * rebuilt field by field, so nothing unvalidated can reach the database.
 */
import type { IngestBody, PortalOrder, PortalVehicle } from "../contract";

export type ParseResult = { ok: true; body: IngestBody } | { ok: false };

type Feedback = Extract<IngestBody, { kind: "feedback" }>;
type Usage = Extract<IngestBody, { kind: "usage" }>;
type Obj = Record<string, unknown>;

const STATUSES: ReadonlySet<unknown> = new Set(["Recibida", "En proceso", "Terminada", "Cancelada"]);

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const hasExactKeys = (o: Obj, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const version = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: ReadonlySet<unknown> = new Set(["tecnico", "jefe_taller", "administrador"]);
const CATEGORIES: ReadonlySet<unknown> = new Set(["bug", "idea", "other"]);
const FEEDBACK_KEYS = ["kind", "id", "username", "role", "category", "text", "route", "screenLabel", "createdAt"];
const short = (v: unknown): v is string => str(v) && v.length <= 200;

const USAGE_KEYS = ["kind", "from", "to", "screens", "counts"];
const GROUPS: ReadonlySet<unknown> = new Set(["gestion", "tecnico"]);
const MAX_USAGE_DAYS = 31;
const DAY_MS = 86_400_000;
const INT4_MAX = 2_147_483_647; // usage_count.views is a Postgres integer
/** A real calendar day as YYYY-MM-DD: the round trip refuses 2026-02-30 and month 13. */
const isoDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

function usage(b: Obj): Usage | null {
  const { from, to, screens, counts } = b;
  if (!isoDay(from) || !isoDay(to) || from > to) return null;
  if ((Date.parse(to) - Date.parse(from)) / DAY_MS + 1 > MAX_USAGE_DAYS) return null;
  if (!Array.isArray(screens) || !Array.isArray(counts)) return null;
  const outScreens: Usage["screens"] = [];
  const patterns = new Set<string>();
  for (const s of screens) {
    if (!isObj(s) || !hasExactKeys(s, ["pattern", "label"]) || !short(s.pattern) || !short(s.label)) return null;
    if (patterns.has(s.pattern)) return null;
    patterns.add(s.pattern);
    outScreens.push({ pattern: s.pattern, label: s.label });
  }
  const outCounts: Usage["counts"] = [];
  const keys = new Set<string>();
  for (const c of counts) {
    if (!isObj(c) || !hasExactKeys(c, ["day", "screen", "group", "views"])) return null;
    const { day, screen, group, views } = c;
    if (!isoDay(day) || day < from || day > to || !short(screen) || !GROUPS.has(group) || !version(views) || views > INT4_MAX) return null;
    // The primary key (day, screen, role_group) would refuse a duplicate mid-transaction.
    const key = JSON.stringify([day, screen, group]);
    if (keys.has(key)) return null;
    keys.add(key);
    outCounts.push({ day, screen, group: group as Usage["counts"][number]["group"], views });
  }
  return { kind: "usage", from, to, screens: outScreens, counts: outCounts };
}

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
  if (b.kind === "feedback" && hasExactKeys(b, FEEDBACK_KEYS)) {
    const { id, username, role, category, text, route, screenLabel, createdAt } = b;
    if (typeof id !== "string" || !UUID.test(id) || !short(username) || !ROLES.has(role) || !CATEGORIES.has(category)) return null;
    if (!str(text) || text.length > 2000) return null;
    if (!str(route) || !route.startsWith("/") || route.length > 300 || !short(screenLabel)) return null;
    if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) return null;
    return {
      kind: "feedback", id, username, text, route, screenLabel, createdAt,
      role: role as Feedback["role"],
      category: category as Feedback["category"],
    };
  }
  if (b.kind === "usage" && hasExactKeys(b, USAGE_KEYS)) return usage(b);
  return null;
}

export function parseIngest(raw: unknown): ParseResult {
  const body = isObj(raw) ? build(raw) : null;
  return body ? { ok: true, body } : { ok: false };
}
