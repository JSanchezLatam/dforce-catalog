/**
 * Display strings for one due item (pure; the page renders them as text, so no
 * client component receives anything but ids). Date-only keys are split into
 * parts, never parsed into a `Date` — that reads a day early in Panamá.
 */
import { MONTH_NAMES } from "@/modules/customers/vehicle-options";
import type { BadgeStatus } from "@/shared/ui/StatusBadge";
import type { DueItem } from "./due";

export type DueDescription = { when: string; chipLabel: string; chipStatus: BadgeStatus };

/** `2026-09-28` -> `28/09/2026`. */
function formatDateKey(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

function chipFor(item: DueItem, todayKey: string): Pick<DueDescription, "chipLabel" | "chipStatus"> {
  if (item.state === "overdue") return { chipLabel: "Vencido", chipStatus: "failed" };
  if (item.kind === "placa") {
    return item.periodKey === todayKey.slice(0, 7)
      ? { chipLabel: "Este mes", chipStatus: "in_progress" }
      : { chipLabel: "Próximo mes", chipStatus: "pending" };
  }
  const days = item.daysLeft ?? 0;
  const chipLabel = days === 0 ? "Hoy" : days === 1 ? "En 1 día" : `En ${days} días`;
  return { chipLabel, chipStatus: "in_progress" };
}

export function describeDue(item: DueItem, todayKey: string): DueDescription {
  const when =
    item.kind === "placa"
      ? `Placa — ${MONTH_NAMES[Number(item.periodKey.slice(5, 7)) - 1]}`
      : `Seguro — ${item.state === "overdue" ? "venció" : "vence"} ${formatDateKey(item.periodKey)}`;
  return { when, ...chipFor(item, todayKey) };
}
