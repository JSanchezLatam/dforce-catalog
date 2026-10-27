/** board/alerts.ts - the one amber strip a card may show, and only for a concrete reason. Pure: `now` is the snapshot's ISO `generatedAt`. */
import type { BoardRow } from "./shape";

export type CardAlert = { kind: "overdue" | "hold" | "missing"; text: string };

const MIN = 60_000;

/** "1 h 10 min", "6 h", "25 min", "3 días": whole units, never negative. */
function agoText(fromIso: string, nowIso: string): string {
  const minutes = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(fromIso)) / MIN));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 día" : `${days} días`;
}

/**
 * Priority when several reasons hold: missing data (it blocks reception), then an overdue
 * appointment, then the hold reason. `missing` is the kanban-only field; the TV boards omit it.
 */
export function cardAlert(row: BoardRow, now: string, missing: ("vehiculo" | "categoria")[] = []): CardAlert | null {
  if (missing.length > 0) {
    const what = missing.map((m) => (m === "vehiculo" ? "vehículo" : "categoría")).join(" y ");
    return { kind: "missing", text: `Falta ${what}` };
  }
  if (row.status === "booked" && row.appointmentAt && Date.parse(row.appointmentAt) < Date.parse(now)) {
    return { kind: "overdue", text: `Cita vencida · hace ${agoText(row.appointmentAt, now)}` };
  }
  if (row.status === "on_hold") {
    return { kind: "hold", text: `${row.holdReason ?? "En espera"} · hace ${agoText(row.statusSince, now)}` };
  }
  return null;
}
