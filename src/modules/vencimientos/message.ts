/**
 * The "Contactar" message (pure, no server imports): the client dialog imports
 * it so the preview updates as the price is typed. Date-only keys are split
 * into parts, never parsed into a `Date` — that reads a day early in Panamá.
 */
import { MONTH_NAMES } from "@/modules/customers/vehicle-options";
import type { VencimientoKind } from "./due";

export type ContactMessageInput = {
  workshop: { name: string | null; phone: string | null; hours: string | null; address: string | null };
  customerName: string;
  /** `label` is "make model", or null when the vehicle has neither. */
  vehicle: { label: string | null; plate: string };
  item: { kind: VencimientoKind; periodKey: string; overdue: boolean };
  /** Balboas; null or NaN leaves the price out of the message. */
  price: number | null;
};

export function formatBalboa(amount: number): string {
  return `B/. ${amount.toFixed(2)}`;
}

/** The price field's text -> a number, or null for empty, non-numeric or negative input. */
export function parsePrice(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text.trim().replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function waMeUrl(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** `2026-11` -> `noviembre de 2026`. */
function monthYear(periodKey: string): string {
  const [year, month] = periodKey.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} de ${year}`;
}

/** `2026-09-01` -> `01/09/2026`. */
function dateKey(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

/** Closes a sentence; text that already ends in a period ("S.A.", "P.M.") does not get a second one. */
function sentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

export function buildContactMessage({ workshop, customerName, vehicle, item, price }: ContactMessageInput): string {
  const hasPrice = price !== null && Number.isFinite(price);
  const vehicleText = `${vehicle.label ?? "vehículo"} (${vehicle.plate})`;
  const due =
    item.kind === "placa"
      ? `La renovación de la placa de su ${vehicleText} ${item.overdue ? "correspondía" : "corresponde"} en ${monthYear(item.periodKey)}.`
      : `La renovación del seguro de su ${vehicleText} ${item.overdue ? "venció" : "vence"} el ${dateKey(item.periodKey)}.`;

  return [
    sentence(workshop.name ? `Hola ${customerName}, le saludamos de ${workshop.name}` : `Hola ${customerName}`),
    due,
    `Le ofrecemos el servicio de renovación${hasPrice ? ` por ${formatBalboa(price)}` : ""}.`,
    workshop.phone
      ? `Si le interesa, responda este mensaje o llámenos al ${workshop.phone}.`
      : "Si le interesa, responda este mensaje.",
    workshop.hours && sentence(`Horario: ${workshop.hours}`),
    workshop.address && sentence(`Dirección: ${workshop.address}`),
  ]
    .filter(Boolean)
    .join(" ");
}
