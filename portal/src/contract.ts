/**
 * Wire contract between the workshop (sender) and portal/ (receiver).
 * Imports ONLY `node:crypto`: the workshop loads this file through the
 * `@portal/contract` alias and Vercel builds portal/ alone, so it can lean on
 * nothing from either app. Server-only: never import it from a "use client"
 * file.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type PortalOrder = {
  id: string;
  status: "Recibida" | "En proceso" | "Terminada" | "Cancelada";
  /** Spanish label, mapped in the workshop. */
  categoria: string;
  createdAt: string;
  appointmentAt: string | null;
  completedAt: string | null;
  description: string | null;
  hallazgos: string | null;
  recomendaciones: string | null;
};

export type PortalVehicle = {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  orders: PortalOrder[];
};

export type IngestBody =
  | {
      kind: "upsert";
      clienteId: string;
      version: number;
      tokenHash: string;
      generatedAt: string;
      vehicles: PortalVehicle[];
    }
  | { kind: "delete"; clienteId: string; version: number }
  | { kind: "reconcile"; liveClienteIds: string[]; maxVersion: number };

export const TIMESTAMP_HEADER = "x-portal-timestamp";
export const SIGNATURE_HEADER = "x-portal-signature";
export const MAX_SKEW_SECONDS = 300;

const mac = (secret: string, timestamp: string, rawBody: string) =>
  createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

/** Headers for a request carrying `rawBody` (the exact bytes that are sent). */
export function sign(
  rawBody: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Record<typeof TIMESTAMP_HEADER | typeof SIGNATURE_HEADER, string> {
  const timestamp = String(nowSeconds);
  return { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: mac(secret, timestamp, rawBody) };
}

/** True only for a fresh (within MAX_SKEW_SECONDS) request signed with `secret`. */
export function verify(
  rawBody: string,
  headers: { get(name: string): string | null },
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const timestamp = headers.get(TIMESTAMP_HEADER);
  const signature = headers.get(SIGNATURE_HEADER);
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(mac(secret, timestamp, rawBody), "hex");
  const given = Buffer.from(signature, "hex");
  // timingSafeEqual throws on unequal lengths.
  return given.length === expected.length && timingSafeEqual(given, expected);
}
