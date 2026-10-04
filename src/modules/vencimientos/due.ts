/**
 * Pure due rules for vehicle renewals (vehicle-details-and-renewals D-due).
 *
 * `todayKey` is the workshop's `YYYY-MM-DD` (`toWorkshopDateKey`), injected so
 * the rules never read a clock. Date-only strings are split into numbers here,
 * never handed to `new Date(...)`: that parses as UTC midnight and reads a day
 * early in Panamá.
 */
export type VencimientoKind = "placa" | "seguro";
export type VencimientoState = "due" | "overdue";

export type DueItem = {
  kind: VencimientoKind;
  /** Plate: `YYYY-MM` of the occurrence. Insurance: the expiry date `YYYY-MM-DD`. */
  periodKey: string;
  state: VencimientoState;
  /** Insurance only (negative once expired); `null` for a plate, which is month-granular. */
  daysLeft: number | null;
};

export type DueVehicleFields = {
  placaRenovacionMes: number | null;
  seguroVence: string | null;
};

const INSURANCE_WINDOW_DAYS = 30;
/** A plate stays listed (overdue) this many months after its renewal month. */
const PLATE_OVERDUE_MONTHS = 2;
const MS_PER_DAY = 86_400_000;

/** Identity of one contactable item, for the "already contacted" set. */
export function contactKey(kind: VencimientoKind, periodKey: string): string {
  return `${kind}:${periodKey}`;
}

function plateItem(month: number, todayKey: string): DueItem | null {
  const [year, todayMonth] = todayKey.split("-").map(Number);
  // Month index: one integer per calendar month, so December -> January is plain arithmetic.
  const today = year * 12 + todayMonth - 1;
  const upper = today + 1;
  // The latest occurrence of `month` at or before next month.
  const occurrence = upper - ((((upper - (month - 1)) % 12) + 12) % 12);
  if (occurrence < today - PLATE_OVERDUE_MONTHS) return null;

  const periodKey = `${Math.floor(occurrence / 12)}-${String((occurrence % 12) + 1).padStart(2, "0")}`;
  return { kind: "placa", periodKey, state: occurrence >= today ? "due" : "overdue", daysLeft: null };
}

function utcDay(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

function insuranceItem(expiry: string, todayKey: string): DueItem | null {
  const daysLeft = utcDay(expiry) - utcDay(todayKey);
  if (daysLeft > INSURANCE_WINDOW_DAYS) return null;
  return { kind: "seguro", periodKey: expiry, state: daysLeft < 0 ? "overdue" : "due", daysLeft };
}

/** Items of one vehicle that are due or overdue today and not already contacted. */
export function computeDueItems(
  vehicle: DueVehicleFields,
  todayKey: string,
  contacted: ReadonlySet<string> = new Set(),
): DueItem[] {
  const items: (DueItem | null)[] = [
    vehicle.placaRenovacionMes === null ? null : plateItem(vehicle.placaRenovacionMes, todayKey),
    vehicle.seguroVence === null ? null : insuranceItem(vehicle.seguroVence, todayKey),
  ];
  return items.filter((item): item is DueItem => item !== null && !contacted.has(contactKey(item.kind, item.periodKey)));
}
