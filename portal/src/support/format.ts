// Pure helpers shared by the inbox list (and the detail view that follows).
export const STATUS_LABELS = { nuevo: "Nuevo", leido: "Leído", resuelto: "Resuelto" } as const;
export const CATEGORY_LABELS = { bug: "Algo no funciona", idea: "Idea o mejora", other: "Otra cosa" } as const;
export const ROLE_LABELS = { tecnico: "Técnico", jefe_taller: "Jefe de taller", administrador: "Administrador" } as const;

export type Status = keyof typeof STATUS_LABELS;
export type Category = keyof typeof CATEGORY_LABELS;
export type Role = keyof typeof ROLE_LABELS;

const DELAY_MS = 10 * 60_000;

/** Late only when strictly more than 10 minutes passed between writing and receiving. */
export const isDelayed = (createdAt: Date, receivedAt: Date): boolean => receivedAt.getTime() - createdAt.getTime() > DELAY_MS;

const PANAMA = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Panama",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `dd/MM/yyyy HH:mm` in the workshop's time zone, whatever the server's own. */
export function formatPanama(date: Date): string {
  const p = Object.fromEntries(PANAMA.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
