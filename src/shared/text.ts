/** Lower-case with accents folded: "Órdenes" -> "ordenes". Shared by the agenda and nav searches. */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
